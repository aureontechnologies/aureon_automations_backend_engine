import { Injectable } from '@nestjs/common';
import { ChannelMessageSendEvent } from '../../messaging/channel-message-send.event';
import { RoutingKeys } from '../../messaging/messaging.constants';
import { MessagingService } from '../../messaging/messaging.service';
import { NodeExecutorRegistry } from '../node-executor.registry';
import { renderTemplate } from '../template.util';
import { NodeExecutionContext, NodeExecutionResult, PublishedNode } from '../types';

export const SEND_MEDIA_MESSAGE_EXECUTOR = 'send_media_message';

@Injectable()
export class SendMediaMessageHandler {
  constructor(
    private readonly registry: NodeExecutorRegistry,
    private readonly messagingService: MessagingService,
  ) {
    this.registry.register(SEND_MEDIA_MESSAGE_EXECUTOR, (node, context) =>
      this.handle(node, context),
    );
  }

  private async handle(
    node: PublishedNode,
    context: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const tipo = node.configJson.tipo as 'imagem' | 'video' | 'documento';
    const url = String(node.configJson.url ?? '');
    const legenda = node.configJson.legenda
      ? renderTemplate(String(node.configJson.legenda), context)
      : undefined;

    const event: ChannelMessageSendEvent = {
      eventId: context.executionNodeId,
      tenantId: context.tenantId,
      contatoId: context.contatoId,
      canal: context.canal,
      connectionId: context.connectionId,
      to: context.contatoTelefone,
      kind: 'midia',
      midia: { tipo, url, legenda },
      correlationId: context.executionId,
    };
    this.messagingService.publish(RoutingKeys.CHANNEL_MESSAGE_SEND, event as unknown as Record<string, unknown>);

    return { kind: 'ok', output: { tipo, url } };
  }
}
