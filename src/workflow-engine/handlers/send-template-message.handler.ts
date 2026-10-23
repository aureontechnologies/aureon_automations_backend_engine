import { Injectable } from '@nestjs/common';
import { ChannelMessageSendEvent } from '../../messaging/channel-message-send.event';
import { RoutingKeys } from '../../messaging/messaging.constants';
import { MessagingService } from '../../messaging/messaging.service';
import { NodeExecutorRegistry } from '../node-executor.registry';
import { NodeExecutionContext, NodeExecutionResult, PublishedNode } from '../types';

export const SEND_TEMPLATE_MESSAGE_EXECUTOR = 'send_template_message';

/**
 * "Modelo de mensagem": pede ao dispatcher o envio de um modelo aprovado pela
 * Meta. O motor só repassa o mapeamento das variáveis do snapshot — conferir a
 * aprovação e preencher os valores com os dados do contato é do backend, que
 * é quem tem os modelos e as credenciais.
 *
 * Numa TRANSMISSÃO este nó já chega reivindicado como SUCCESS (o modelo foi
 * enviado pela própria fila da transmissão), então o motor o pula e segue para
 * os sucessores sem reenviar — ver `claimExecutionNode` no `engine.service`.
 */
@Injectable()
export class SendTemplateMessageHandler {
  constructor(
    private readonly registry: NodeExecutorRegistry,
    private readonly messagingService: MessagingService,
  ) {
    this.registry.register(SEND_TEMPLATE_MESSAGE_EXECUTOR, (node, context) =>
      this.handle(node, context),
    );
  }

  private async handle(
    node: PublishedNode,
    context: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const templateId = node.configJson.templateId;
    if (typeof templateId !== 'string' || !templateId) {
      throw new Error('Nó "Modelo de mensagem" sem modelo escolhido.');
    }

    const event: ChannelMessageSendEvent = {
      eventId: context.executionNodeId,
      tenantId: context.tenantId,
      contatoId: context.contatoId,
      canal: context.canal,
      connectionId: context.connectionId,
      to: context.contatoTelefone,
      kind: 'template',
      template: node.configJson,
      correlationId: context.executionId,
    };
    this.messagingService.publish(
      RoutingKeys.CHANNEL_MESSAGE_SEND,
      event as unknown as Record<string, unknown>,
    );
    return { kind: 'ok', output: { templateId } };
  }
}
