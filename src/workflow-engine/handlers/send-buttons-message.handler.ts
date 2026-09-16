import { Injectable } from '@nestjs/common';
import { ChannelMessageButton, ChannelMessageSendEvent } from '../../messaging/channel-message-send.event';
import { RoutingKeys } from '../../messaging/messaging.constants';
import { MessagingService } from '../../messaging/messaging.service';
import { NodeExecutorRegistry } from '../node-executor.registry';
import { renderTemplate } from '../template.util';
import {
  BranchResolver,
  NodeExecutionContext,
  NodeExecutionResult,
  PublishedNode,
} from '../types';

export const SEND_BUTTONS_MESSAGE_EXECUTOR = 'send_buttons_message';

/** Timeout padrão de espera por um clique — não há campo de configuração pra isso na UI hoje (ao contrário do nó "Aguardar Resposta"), então usamos a janela de mensageria do WhatsApp (24h) como default seguro. */
const DEFAULT_TIMEOUT_MINUTES = 24 * 60;

/**
 * Envia uma mensagem com até 3 botões e suspende aguardando o clique — ao
 * contrário de `send_text_message`, este nó BRANCHES: a aresta seguida no
 * resume é escolhida pelo id do botão clicado (`handleOrigem` == `botoes[].id`
 * configurado no nó), mesma convenção usada pelo inspector do Flutter
 * (`node_handles.dart`). Um clique que não corresponde a nenhum botão
 * configurado (texto digitado, id desconhecido) não segue nenhuma aresta —
 * resposta ambígua, mesmo comportamento da referência.
 */
@Injectable()
export class SendButtonsMessageHandler {
  constructor(
    private readonly registry: NodeExecutorRegistry,
    private readonly messagingService: MessagingService,
  ) {
    this.registry.register(
      SEND_BUTTONS_MESSAGE_EXECUTOR,
      (node, context) => this.handle(node, context),
      this.resolveBranch,
    );
  }

  private async handle(
    node: PublishedNode,
    context: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const texto = renderTemplate(String(node.configJson.texto ?? ''), context);
    const botoes = this.extractButtons(node);

    const event: ChannelMessageSendEvent = {
      eventId: context.executionNodeId,
      tenantId: context.tenantId,
      contatoId: context.contatoId,
      canal: context.canal,
      connectionId: context.connectionId,
      to: context.contatoTelefone,
      kind: 'botoes',
      texto,
      botoes,
      correlationId: context.executionId,
    };
    this.messagingService.publish(RoutingKeys.CHANNEL_MESSAGE_SEND, event as unknown as Record<string, unknown>);

    return {
      kind: 'suspend',
      resumeAt: new Date(Date.now() + DEFAULT_TIMEOUT_MINUTES * 60_000),
      motivo: 'AGUARDANDO_CLIQUE_BOTAO',
      output: { texto, botoes },
    };
  }

  private resolveBranch: BranchResolver = (node, incoming, resolvedReason) => {
    if (resolvedReason !== 'REPLY' || !incoming?.interactiveReplyId) {
      return null; // timeout ou resposta sem id de botão — nenhuma aresta
    }
    const botoes = this.extractButtons(node);
    const matched = botoes.find((botao) => botao.id === incoming.interactiveReplyId);
    return matched?.id ?? null;
  };

  private extractButtons(node: PublishedNode): ChannelMessageButton[] {
    const raw = (node.configJson.botoes as Array<{ id?: string; label?: string }>) ?? [];
    return raw
      .filter((botao): botao is { id: string; label: string } => typeof botao.id === 'string')
      .map((botao) => ({ id: botao.id, label: botao.label ?? '' }));
  }
}
