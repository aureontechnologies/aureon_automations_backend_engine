import { Canal } from '@prisma/client';

/** Espelha `backend/src/_modules/messaging/dtos/channel-message-send.event.ts` — mesmo contrato dos dois lados do RabbitMQ. */
export type ChannelMessageKind = 'texto' | 'botoes' | 'midia';

export interface ChannelMessageButton {
  id: string;
  label: string;
}

export interface ChannelMessageSendEvent {
  eventId: string;
  tenantId: string;
  contatoId: string;
  canal: Canal;
  connectionId: string;
  to: string;
  kind: ChannelMessageKind;
  texto?: string;
  botoes?: ChannelMessageButton[];
  midia?: { tipo: 'imagem' | 'video' | 'documento'; url: string; legenda?: string };
  correlationId: string;
  attempts?: number;
}
