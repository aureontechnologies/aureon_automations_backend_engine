import { Canal } from '@prisma/client';

/** Espelha `backend/src/_modules/messaging/dtos/channel-message-send.event.ts` — mesmo contrato dos dois lados do RabbitMQ. */
export type ChannelMessageKind = 'texto' | 'botoes' | 'midia' | 'template';

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
  /**
   * `kind: 'template'`: o `configJson` do nó "Modelo de mensagem" como está no
   * snapshot (id do modelo + mapeamento das variáveis). Quem resolve os
   * valores e confere a aprovação é o dispatcher, no backend — o motor não
   * conhece modelos.
   */
  template?: Record<string, unknown>;
  correlationId: string;
  attempts?: number;
}
