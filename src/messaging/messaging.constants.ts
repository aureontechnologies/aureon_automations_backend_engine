/**
 * Espelha `backend/src/_modules/messaging/messaging.constants.ts` — os
 * valores (não o arquivo) precisam ficar idênticos nos dois apps, já que
 * cada um declara sua própria topologia RabbitMQ sobre o mesmo broker. Ao
 * alterar uma routing key/fila aqui, altere também lá.
 */
export const AUREON_EXCHANGE = 'aureon.events';

export const RoutingKeys = {
  AUTOMATION_TRIGGER: 'automation.trigger',
  CONTATO_RESPONDEU: 'contato.respondeu',
  CHANNEL_MESSAGE_SEND: 'channel.message.send',
} as const;

export const Queues = {
  ENGINE_TRIGGERS: 'aureon.engine.triggers',
} as const;

/** Intervalo do poller que resolve esperas (`WorkflowExecutionWait`) vencidas por timeout. */
export const WAIT_TIMEOUT_POLL_INTERVAL_MS = 15_000;
export const WAIT_TIMEOUT_POLL_BATCH_SIZE = 50;
