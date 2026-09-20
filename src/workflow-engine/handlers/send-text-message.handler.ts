import { Injectable } from '@nestjs/common';
import { ChannelMessageSendEvent } from '../../messaging/channel-message-send.event';
import { RoutingKeys } from '../../messaging/messaging.constants';
import { MessagingService } from '../../messaging/messaging.service';
import { NodeExecutorRegistry } from '../node-executor.registry';
import { renderTemplate } from '../template.util';
import { NodeExecutionContext, NodeExecutionResult, PublishedNode } from '../types';

export const SEND_TEXT_MESSAGE_EXECUTOR = 'send_text_message';

/** Envia um texto simples e segue imediatamente pros sucessores — o envio de fato é assíncrono (publicado pro dispatcher), o grafo não bloqueia esperando a Meta responder. */
@Injectable()
export class SendTextMessageHandler {
  constructor(
    private readonly registry: NodeExecutorRegistry,
    private readonly messagingService: MessagingService,
  ) {
    this.registry.register(SEND_TEXT_MESSAGE_EXECUTOR, (node, context) =>
      this.handle(node, context),
    );
  }

  private async handle(
    node: PublishedNode,
    context: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const texto = renderTemplate(String(node.configJson.texto ?? ''), context);
    if (!texto.trim()) {
      throw new Error('Nó "Mensagem" sem texto para enviar.');
    }

    const event: ChannelMessageSendEvent = {
      eventId: context.executionNodeId,
      tenantId: context.tenantId,
      contatoId: context.contatoId,
      canal: context.canal,
      connectionId: context.connectionId,
      to: context.contatoTelefone,
      kind: 'texto',
      texto,
      correlationId: context.executionId,
    };
    this.messagingService.publish(RoutingKeys.CHANNEL_MESSAGE_SEND, event as unknown as Record<string, unknown>);

    return { kind: 'ok', output: { texto } };
  }
}
