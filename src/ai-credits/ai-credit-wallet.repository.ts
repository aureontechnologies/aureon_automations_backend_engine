import { Injectable, Logger } from '@nestjs/common';
import {
  AiCreditOrigem,
  AiCreditTransactionType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface ReservaSplit {
  doPlano: number;
  doComprado: number;
}

export interface LiquidacaoResultado {
  creditosDebitados: number;
  saldoDepois: number;
}

/**
 * O que os três ramos de `liquidar` compartilham. Mesmo tipo (e mesmo nome) do
 * gêmeo no backend — manter a forma idêntica é o que faz uma divergência de
 * COMPORTAMENTO entre os dois saltar aos olhos num diff.
 */
interface ContextoDeLiquidacao {
  input: MovimentoInput & { reserva: ReservaSplit; creditosReais: number };
  reservado: number;
  saldoAntes: number;
}

interface LinhaCarteira {
  saldoPlano: number;
  saldoComprado: number;
  reservado: number;
}

interface MovimentoInput {
  tenantId: string;
  descricao: string;
  referenciaId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Porta de `backend/src/_modules/_features/ai-credits/repositories/ai-credit-wallet.repository.ts`
 * — só a parte que este serviço precisa.
 *
 * O motor CONSOME crédito; ele nunca concede, nunca vende e nunca ajusta. As
 * operações de entrada de crédito ficam fora daqui de propósito: um serviço que
 * não tem porta HTTP nem recebe webhook de pagamento não tem motivo para poder
 * creditar ninguém, e não poder é a melhor garantia de que não vai.
 *
 * As duas invariantes do backend valem aqui iguais:
 *
 * 1. nenhum saldo muda sem uma linha em `ai_credit_transactions`;
 * 2. a verificação e o débito acontecem com a linha da carteira TRAVADA
 *    (`SELECT … FOR UPDATE`), o que faz duas conversas simultâneas do mesmo
 *    tenant serem decididas em sequência — e não as duas sobre o mesmo saldo.
 */
@Injectable()
export class AiCreditWalletRepository {
  private readonly logger = new Logger(AiCreditWalletRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Garante a carteira. Nasce com saldo zero: criar a linha nunca é, por si,
   * uma liberação.
   */
  async ensure(tenantId: string): Promise<void> {
    try {
      await this.prisma.aiCreditWallet.upsert({
        where: { tenantId },
        create: { tenantId },
        update: {},
      });
    } catch (error) {
      // `upsert` do Prisma consulta antes de inserir, então duas primeiras
      // chamadas simultâneas do MESMO tenant colidem na unique de `tenantId`.
      // A colisão significa que a outra ganhou — a carteira existe, que é tudo
      // o que este método promete. Mesma decisão do gêmeo no backend.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return;
      }
      throw error;
    }
  }

  async saldo(tenantId: string): Promise<number> {
    const carteira = await this.prisma.aiCreditWallet.findUnique({
      where: { tenantId },
      select: { saldoPlano: true, saldoComprado: true },
    });
    return carteira ? carteira.saldoPlano + carteira.saldoComprado : 0;
  }

  /** Debita e reserva, ou devolve `null` quando falta saldo. */
  async reservar(
    input: MovimentoInput & { creditos: number },
  ): Promise<ReservaSplit | null> {
    return this.prisma.$transaction(async (tx) => {
      const carteira = await this.travar(tx, input.tenantId);
      const disponivel = carteira.saldoPlano + carteira.saldoComprado;
      if (disponivel < input.creditos) return null;

      // Gasta primeiro o crédito do PLANO, que expira na virada do ciclo; o
      // comprado não expira, então queimar o perecível antes evita que o
      // cliente perca crédito pago.
      const doPlano = Math.min(carteira.saldoPlano, input.creditos);
      const doComprado = input.creditos - doPlano;

      await tx.aiCreditWallet.update({
        where: { tenantId: input.tenantId },
        data: {
          saldoPlano: { decrement: doPlano },
          saldoComprado: { decrement: doComprado },
          reservado: { increment: input.creditos },
        },
      });
      await this.registrar(tx, {
        ...input,
        tipo: AiCreditTransactionType.CONSUMO,
        origem: origemDe(doPlano, doComprado),
        quantidade: -input.creditos,
        saldoAntes: disponivel,
        saldoDepois: disponivel - input.creditos,
      });

      return { doPlano, doComprado };
    });
  }

  /** Fecha a reserva contra o consumo real. Ver o backend para o porquê de cada ramo. */
  async liquidar(
    input: MovimentoInput & { reserva: ReservaSplit; creditosReais: number },
  ): Promise<LiquidacaoResultado> {
    const reservado = input.reserva.doPlano + input.reserva.doComprado;

    return this.prisma.$transaction(async (tx) => {
      const carteira = await this.travar(tx, input.tenantId);
      const saldoAntes = carteira.saldoPlano + carteira.saldoComprado;
      const delta = reservado - input.creditosReais;

      const contexto = { input, reservado, saldoAntes };
      if (delta > 0) return this.devolverSobra(tx, contexto, delta);
      if (delta < 0) return this.cobrarExcedente(tx, contexto, carteira, -delta);

      // Consumiu exatamente o que reservou: o saldo não muda, só a reserva é
      // liberada — e sem mudança de saldo não há movimentação a registrar.
      await tx.aiCreditWallet.update({
        where: { tenantId: input.tenantId },
        data: {
          reservado: { decrement: reservado },
          totalConsumido: { increment: input.creditosReais },
        },
      });
      return {
        creditosDebitados: input.creditosReais,
        saldoDepois: saldoAntes,
      };
    });
  }

  /**
   * Consumiu MENOS que reservou: devolve a diferença, repondo primeiro o pote
   * COMPRADO (o que não expira na virada do ciclo).
   */
  private async devolverSobra(
    tx: Prisma.TransactionClient,
    { input, reservado, saldoAntes }: ContextoDeLiquidacao,
    sobra: number,
  ): Promise<LiquidacaoResultado> {
    const paraComprado = Math.min(input.reserva.doComprado, sobra);
    const paraPlano = sobra - paraComprado;

    await tx.aiCreditWallet.update({
      where: { tenantId: input.tenantId },
      data: {
        saldoPlano: { increment: paraPlano },
        saldoComprado: { increment: paraComprado },
        reservado: { decrement: reservado },
        totalConsumido: { increment: input.creditosReais },
      },
    });
    await this.registrar(tx, {
      ...input,
      tipo: AiCreditTransactionType.ESTORNO,
      origem: origemDe(paraPlano, paraComprado),
      quantidade: sobra,
      saldoAntes,
      saldoDepois: saldoAntes + sobra,
      descricao: `${input.descricao} — devolução do reservado e não consumido`,
    });

    return {
      creditosDebitados: input.creditosReais,
      saldoDepois: saldoAntes + sobra,
    };
  }

  /**
   * Consumiu MAIS que reservou: cobra o excedente do saldo que ainda houver e
   * deixa a PLATAFORMA absorver o que não couber. Saldo negativo seria dívida
   * sem contrato, criada por um erro de estimativa nosso.
   */
  private async cobrarExcedente(
    tx: Prisma.TransactionClient,
    { input, reservado, saldoAntes }: ContextoDeLiquidacao,
    carteira: LinhaCarteira,
    excedente: number,
  ): Promise<LiquidacaoResultado> {
    const doPlano = Math.min(carteira.saldoPlano, excedente);
    const doComprado = Math.min(carteira.saldoComprado, excedente - doPlano);
    const cobrado = doPlano + doComprado;

    await tx.aiCreditWallet.update({
      where: { tenantId: input.tenantId },
      data: {
        saldoPlano: { decrement: doPlano },
        saldoComprado: { decrement: doComprado },
        reservado: { decrement: reservado },
        totalConsumido: { increment: reservado + cobrado },
      },
    });
    if (cobrado > 0) {
      await this.registrar(tx, {
        ...input,
        tipo: AiCreditTransactionType.AJUSTE,
        origem: origemDe(doPlano, doComprado),
        quantidade: -cobrado,
        saldoAntes,
        saldoDepois: saldoAntes - cobrado,
        descricao: `${input.descricao} — consumo acima da reserva`,
      });
    }
    if (cobrado < excedente) {
      this.logger.warn(
        `Tenant ${input.tenantId}: consumo passou ${excedente} créditos da reserva e só ` +
          `havia saldo para ${cobrado}. Considere aumentar AI_CREDIT_RESERVA_MINIMA.`,
      );
    }

    return {
      creditosDebitados: reservado + cobrado,
      saldoDepois: saldoAntes - cobrado,
    };
  }

  /**
   * Devolve a reserva inteira — a chamada não produziu resposta. O contato não
   * foi atendido, então o cliente não paga.
   */
  async estornar(input: MovimentoInput & { reserva: ReservaSplit }): Promise<void> {
    const reservado = input.reserva.doPlano + input.reserva.doComprado;
    if (reservado <= 0) return;

    await this.prisma.$transaction(async (tx) => {
      const carteira = await this.travar(tx, input.tenantId);
      const saldoAntes = carteira.saldoPlano + carteira.saldoComprado;

      await tx.aiCreditWallet.update({
        where: { tenantId: input.tenantId },
        data: {
          saldoPlano: { increment: input.reserva.doPlano },
          saldoComprado: { increment: input.reserva.doComprado },
          reservado: { decrement: reservado },
        },
      });
      await this.registrar(tx, {
        ...input,
        tipo: AiCreditTransactionType.ESTORNO,
        origem: origemDe(input.reserva.doPlano, input.reserva.doComprado),
        quantidade: reservado,
        saldoAntes,
        saldoDepois: saldoAntes + reservado,
      });
    });
  }

  private async travar(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<LinhaCarteira> {
    const linhas = await tx.$queryRaw<LinhaCarteira[]>`
      SELECT "saldoPlano", "saldoComprado", "reservado"
        FROM "ai_credit_wallets"
       WHERE "tenantId" = ${tenantId}::uuid
       FOR UPDATE
    `;
    const carteira = linhas[0];
    if (!carteira) {
      throw new Error(
        `Carteira de créditos de IA do tenant ${tenantId} não encontrada.`,
      );
    }
    return carteira;
  }

  private registrar(
    tx: Prisma.TransactionClient,
    input: MovimentoInput & {
      tipo: AiCreditTransactionType;
      origem: AiCreditOrigem | null;
      quantidade: number;
      saldoAntes: number;
      saldoDepois: number;
    },
  ) {
    return tx.aiCreditTransaction.create({
      data: {
        tenantId: input.tenantId,
        // Consumo do motor não tem usuário: quem gastou foi um contato
        // conversando com o agente, não uma pessoa numa tela.
        usuarioId: null,
        tipo: input.tipo,
        origem: input.origem,
        quantidade: input.quantidade,
        saldoAntes: input.saldoAntes,
        saldoDepois: input.saldoDepois,
        descricao: input.descricao,
        referenciaId: input.referenciaId ?? null,
        metadata: input.metadata,
      },
    });
  }
}

function origemDe(plano: number, comprado: number): AiCreditOrigem | null {
  if (plano > 0 && comprado > 0) return null;
  return comprado > 0 ? AiCreditOrigem.COMPRADO : AiCreditOrigem.PLANO;
}
