import { Injectable, Logger } from '@nestjs/common';
import { WorkflowExecutionWait } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WAIT_TIMEOUT_POLL_BATCH_SIZE } from '../messaging/messaging.constants';

/**
 * Resolve `WorkflowExecutionWait` de duas formas que competem pela MESMA
 * linha: resposta do contato (chamado pelo consumer de `contato.respondeu`)
 * e timeout (chamado pelo poller interno). `FOR UPDATE SKIP LOCKED` +
 * `"resolvedAt" IS NULL` garante que só uma das duas vence a corrida — igual
 * ao worker de referência.
 */
@Injectable()
export class WaitResolverService {
  private readonly logger = new Logger(WaitResolverService.name);

  constructor(private readonly prisma: PrismaService) {}

  async claimByContato(contatoId: string): Promise<WorkflowExecutionWait | null> {
    const rows = await this.prisma.$queryRaw<WorkflowExecutionWait[]>`
      UPDATE workflow_execution_waits
      SET "resolvedAt" = now(), "resolvedReason" = 'REPLY'
      WHERE id = (
        SELECT w.id
        FROM workflow_execution_waits w
        JOIN workflow_executions e ON e.id = w."executionId"
        WHERE e."contatoId" = ${contatoId}::uuid AND w."resolvedAt" IS NULL
        ORDER BY w."criadoEm" DESC
        LIMIT 1
        FOR UPDATE OF w SKIP LOCKED
      )
      RETURNING *;
    `.catch((error: unknown) => {
      this.logger.error('Falha ao reivindicar espera por resposta.', error as Error);
      return [];
    });
    return rows[0] ?? null;
  }

  async claimDue(limit = WAIT_TIMEOUT_POLL_BATCH_SIZE): Promise<WorkflowExecutionWait[]> {
    return this.prisma.$queryRaw<WorkflowExecutionWait[]>`
      UPDATE workflow_execution_waits
      SET "resolvedAt" = now(), "resolvedReason" = 'TIMEOUT'
      WHERE id IN (
        SELECT id FROM workflow_execution_waits
        WHERE "resolvedAt" IS NULL AND "resumeAt" <= now()
        ORDER BY "resumeAt"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *;
    `.catch((error: unknown) => {
      this.logger.error('Falha ao reivindicar esperas vencidas por timeout.', error as Error);
      return [];
    });
  }
}
