import { Injectable } from '@nestjs/common';
import { AiUsage, AiUsageStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Porta de `backend/src/_modules/_features/ai-credits/repositories/ai-usage.repository.ts`.
 *
 * O consumo do motor vai para a MESMA tabela que o consumo feito pelo painel:
 * o cliente vê um histórico só, e é nele que ele descobre que o gasto veio do
 * agente atendendo um contato, não de alguém testando na tela.
 */
@Injectable()
export class AiUsageRepository {
  constructor(private readonly prisma: PrismaService) {}

  abrir(input: {
    tenantId: string;
    provider: string;
    model: string;
    feature: string;
    creditosReservados: number;
    requestId: string;
    agenteId?: string | null;
    contatoId?: string | null;
    workflowExecutionId?: string | null;
    metadata?: Prisma.InputJsonValue;
  }): Promise<AiUsage> {
    return this.prisma.aiUsage.create({
      data: {
        tenantId: input.tenantId,
        usuarioId: null,
        provider: input.provider,
        model: input.model,
        feature: input.feature,
        status: AiUsageStatus.RESERVADO,
        creditosReservados: input.creditosReservados,
        requestId: input.requestId,
        agenteId: input.agenteId ?? null,
        contatoId: input.contatoId ?? null,
        workflowExecutionId: input.workflowExecutionId ?? null,
        metadata: input.metadata,
      },
    });
  }

  concluir(input: {
    id: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    creditosConsumidos: number;
  }): Promise<AiUsage> {
    return this.prisma.aiUsage.update({
      where: { id: input.id },
      data: {
        status: AiUsageStatus.CONSUMIDO,
        model: input.model,
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
        totalTokens: input.totalTokens,
        creditosConsumidos: input.creditosConsumidos,
        finalizadoEm: new Date(),
      },
    });
  }

  /** `creditosConsumidos` fica em 0: o cliente não pagou por uma resposta que não saiu. */
  estornar(id: string, motivo: string): Promise<AiUsage> {
    return this.prisma.aiUsage.update({
      where: { id },
      data: {
        status: AiUsageStatus.ESTORNADO,
        creditosConsumidos: 0,
        erro: motivo.slice(0, 500),
        finalizadoEm: new Date(),
      },
    });
  }
}
