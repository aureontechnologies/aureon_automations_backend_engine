import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AiChatMessage } from '../ai/ai-provider.interface';
import { AI_MAX_TOKENS_RESPOSTA } from '../ai/ai.constants';
import { AiService } from '../ai/ai.service';
import { AiCreditConfig } from './ai-credit.config';
import { AiCreditWalletRepository } from './ai-credit-wallet.repository';
import { AiUsageRepository } from './ai-usage.repository';

export interface AiExecucaoInput {
  tenantId: string;
  feature: string;
  model: string;
  messages: AiChatMessage[];
  maxTokens?: number;
  agenteId?: string | null;
  contatoId?: string | null;
  workflowExecutionId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * O que o CLIENTE lê quando o provedor falha.
 *
 * O motivo real (mensagem crua da OpenAI) nunca sai daqui, e isso não é
 * excesso de zelo: desde que a chave passou a ser da PLATAFORMA, as mensagens
 * dela falam da NOSSA conta — "Incorrect API key provided: sk-…", "You
 * exceeded your current quota". O motor entrega esse texto ao `motivo`, que o
 * handler transforma no erro exibido na tela de Execuções do tenant; repassá-lo
 * contaria ao cliente que existe uma conta compartilhada, em que estado de
 * cobrança ela está e um pedaço do formato da chave.
 *
 * É a mesma regra que o `OpenAiProvider` do backend já documenta e que o
 * `AllExceptionsFilter` faz cumprir lá. Aqui não há filtro nenhum entre o erro
 * e o cliente — por isso a limpeza acontece neste ponto.
 */
const MOTIVO_GENERICO =
  'O serviço de IA não conseguiu responder agora. Tente novamente em instantes.';

export type AiExecucaoResultado =
  | {
      status: 'ok';
      texto: string;
      creditosConsumidos: number;
      saldoDepois: number;
    }
  /** Sem saldo: a chamada NÃO foi feita. */
  | { status: 'sem_creditos'; saldo: number; necessario: number }
  /** Sem chave da plataforma configurada — problema nosso, não do cliente. */
  | { status: 'sem_provedor' }
  | { status: 'falha_provedor'; motivo: string };

/**
 * **A única porta por onde este serviço fala com uma IA.**
 *
 * Porta de `backend/src/_modules/_features/ai-credits/services/ai-usage.service.ts`,
 * com uma diferença de forma que não é acidental: aqui o resultado é um UNION
 * em vez de exceção. O motor roda dentro de um consumidor de fila, e a decisão
 * "isto vira execução FALHADA na tela ou é só um aviso" é do handler — devolver
 * o estado deixa essa escolha com quem tem contexto para fazê-la.
 *
 * As garantias são as mesmas do backend: ninguém usa IA sem saldo, ninguém paga
 * por resposta que não recebeu, e todo consumo aparece no histórico.
 */
@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);

  constructor(
    private readonly aiService: AiService,
    private readonly walletRepository: AiCreditWalletRepository,
    private readonly usageRepository: AiUsageRepository,
    private readonly config: AiCreditConfig,
  ) {}

  async executar(input: AiExecucaoInput): Promise<AiExecucaoResultado> {
    const maxTokens = input.maxTokens ?? AI_MAX_TOKENS_RESPOSTA;
    const credencial = this.aiService.resolverCredencial(input.tenantId);
    if (!credencial) return { status: 'sem_provedor' };

    await this.walletRepository.ensure(input.tenantId);

    const caracteres = input.messages.reduce(
      (total, mensagem) => total + mensagem.content.length,
      0,
    );
    const estimativa = this.config.estimarCreditos(caracteres, maxTokens);

    // BYOK: o cliente paga o provedor direto. Não reserva nada, mas o consumo
    // continua registrado — a métrica não depende de quem paga a conta.
    const reserva = credencial.cobraCreditos
      ? await this.walletRepository.reservar({
          tenantId: input.tenantId,
          creditos: estimativa,
          descricao: `Consumo de IA — ${input.feature}`,
          metadata: { feature: input.feature, model: input.model },
        })
      : { doPlano: 0, doComprado: 0 };

    if (!reserva) {
      const saldo = await this.walletRepository.saldo(input.tenantId);
      this.logger.log(
        `Tenant ${input.tenantId} sem créditos para "${input.feature}": saldo ${saldo}, ` +
          `necessário ${estimativa}. Chamada não feita.`,
      );
      return { status: 'sem_creditos', saldo, necessario: estimativa };
    }

    const uso = await this.usageRepository.abrir({
      tenantId: input.tenantId,
      provider: credencial.provider,
      model: input.model,
      feature: input.feature,
      creditosReservados: credencial.cobraCreditos ? estimativa : 0,
      requestId: randomUUID(),
      agenteId: input.agenteId,
      contatoId: input.contatoId,
      workflowExecutionId: input.workflowExecutionId,
      metadata: input.metadata,
    });

    let resposta: Awaited<ReturnType<AiService['chat']>>;
    try {
      resposta = await this.aiService.chat(
        { tenantId: input.tenantId, model: input.model, messages: input.messages, maxTokens },
        credencial,
      );
    } catch (error) {
      const motivoReal = error instanceof Error ? error.message : String(error);
      if (credencial.cobraCreditos) {
        await this.walletRepository.estornar({
          tenantId: input.tenantId,
          reserva,
          descricao: `Estorno — falha na chamada de IA (${input.feature})`,
          referenciaId: uso.id,
        });
      }
      // O motivo REAL fica no log e no registro de uso, que são superfícies
      // internas — e não no `motivo` devolvido.
      await this.usageRepository.estornar(uso.id, motivoReal);
      this.logger.error(
        `Chamada de IA falhou para o tenant ${input.tenantId} (${input.feature}): ${motivoReal}. ` +
          `${credencial.cobraCreditos ? `${estimativa} créditos estornados.` : 'Nada a estornar (BYOK).'}`,
      );
      return { status: 'falha_provedor', motivo: MOTIVO_GENERICO };
    }

    // Sem `usage` do provedor, cobra a estimativa: é o que foi reservado, e não
    // inventa um consumo que ninguém mediu.
    const tokensReais = resposta.usage.totalTokens;
    const creditosReais =
      tokensReais > 0 ? this.config.creditosPorTokens(tokensReais) : estimativa;

    const liquidacao = credencial.cobraCreditos
      ? await this.walletRepository.liquidar({
          tenantId: input.tenantId,
          reserva,
          creditosReais,
          descricao: `Consumo de IA — ${input.feature}`,
          referenciaId: uso.id,
        })
      : {
          creditosDebitados: 0,
          saldoDepois: await this.walletRepository.saldo(input.tenantId),
        };

    await this.usageRepository.concluir({
      id: uso.id,
      model: resposta.model,
      promptTokens: resposta.usage.promptTokens,
      completionTokens: resposta.usage.completionTokens,
      totalTokens: tokensReais,
      creditosConsumidos: liquidacao.creditosDebitados,
    });

    return {
      status: 'ok',
      texto: resposta.texto,
      creditosConsumidos: liquidacao.creditosDebitados,
      saldoDepois: liquidacao.saldoDepois,
    };
  }
}
