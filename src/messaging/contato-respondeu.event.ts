import { Canal } from '@prisma/client';
import type {
  InboundAttachment,
  InboundContactCard,
  InboundLocation,
  InboundMessageTipo,
  InboundReaction,
  InboundReplyContext,
} from './inbound-message';

/** Espelha `backend/src/_modules/messaging/dtos/contato-respondeu.event.ts`. */
export interface ContatoRespondeuEvent {
  event: 'contato.respondeu';
  tenantId: string;
  contatoId: string;
  canal: Canal;
  connectionId: string;
  conteudo: string | null;
  /** Só o texto escrito pelo contato (null quando a mensagem não tem texto). */
  texto?: string | null;
  tipo: InboundMessageTipo;
  interactiveReplyId?: string | null;
  anexos?: InboundAttachment[];
  localizacao?: InboundLocation;
  contatoCompartilhado?: InboundContactCard;
  reacao?: InboundReaction;
  respostaA?: InboundReplyContext;
  messageId: string;
  occurredAt: string;
}
