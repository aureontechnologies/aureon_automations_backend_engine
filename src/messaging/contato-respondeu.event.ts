import { Canal } from '@prisma/client';

/** Espelha `backend/src/_modules/messaging/dtos/contato-respondeu.event.ts`. */
export interface ContatoRespondeuEvent {
  event: 'contato.respondeu';
  tenantId: string;
  contatoId: string;
  canal: Canal;
  connectionId: string;
  conteudo: string | null;
  tipo: 'TEXTO' | 'BOTOES' | 'MIDIA';
  interactiveReplyId?: string | null;
  messageId: string;
  occurredAt: string;
}
