import { Injectable } from '@nestjs/common';
import { ChannelMessageSendEvent } from '../../messaging/channel-message-send.event';
import { RoutingKeys } from '../../messaging/messaging.constants';
import { MessagingService } from '../../messaging/messaging.service';
import { NodeExecutorRegistry } from '../node-executor.registry';
import { renderTemplate } from '../template.util';
import { NodeExecutionContext, NodeExecutionResult, PublishedNode } from '../types';

export const SEND_MEDIA_MESSAGE_EXECUTOR = 'send_media_message';

const TIPOS_VALIDOS = ['imagem', 'video', 'documento'] as const;
type MediaTipo = (typeof TIPOS_VALIDOS)[number];

/**
 * Envia imagem, vídeo ou documento. O que cada canal aceita de fato é
 * resolvido no dispatcher (o Direct do Instagram, por exemplo, não tem anexo
 * de documento e manda o link em texto) — aqui o nó só publica o pedido.
 */

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
    const tipo = node.configJson.tipo as MediaTipo;
    if (!TIPOS_VALIDOS.includes(tipo)) {
      throw new Error(
        `Nó "Enviar Mídia" com tipo inválido (${String(node.configJson.tipo)}).`,
      );
    }
    const url = String(node.configJson.url ?? '').trim();
    if (!url) {
      throw new Error('Nó "Enviar Mídia" sem URL do arquivo.');
    }
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
