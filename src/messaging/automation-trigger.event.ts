import { Canal } from '@prisma/client';

/** Espelha `backend/src/_modules/messaging/dtos/automation-trigger.event.ts`. */
export interface AutomationTriggerEvent {
  event: 'automation.trigger';
  tenantId: string;
  contatoId: string;
  canal: Canal;
  connectionId: string;
  workflowId: string;
  workflowVersion: number;
  executionId: string;
  triggerNodeId: string;
  conteudo: string | null;
  tipo: 'TEXTO' | 'BOTOES' | 'MIDIA';
  interactiveReplyId?: string | null;
  occurredAt: string;
}
