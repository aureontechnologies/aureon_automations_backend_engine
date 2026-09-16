import { Injectable } from '@nestjs/common';
import { NodeExecutorRegistry } from '../node-executor.registry';
import { NodeExecutionContext, NodeExecutionResult, PublishedNode } from '../types';

export const WAIT_FOR_REPLY_EXECUTOR = 'wait_for_reply';
const DEFAULT_TIMEOUT_MINUTES = 30;

/**
 * Suspende até o contato responder ou o tempo esgotar. Diferente de
 * `send_buttons_message`, este nó tem uma única saída genérica no canvas
 * (`node_handles.dart` só dá handles por botão pra MENSAGEM_BOTOES — todo o
 * resto, incluindo este, tem exatamente uma aresta "Próximo") — então o
 * resume sempre segue a mesma aresta única, tanto por resposta quanto por
 * timeout. Não precisa de branch resolver.
 */
@Injectable()
export class WaitForReplyHandler {
  constructor(private readonly registry: NodeExecutorRegistry) {
    this.registry.register(WAIT_FOR_REPLY_EXECUTOR, (node, context) =>
      this.handle(node, context),
    );
  }

  private async handle(
    node: PublishedNode,
    _context: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const timeoutMinutos = Number(node.configJson.timeoutMinutos ?? DEFAULT_TIMEOUT_MINUTES);
    return {
      kind: 'suspend',
      resumeAt: new Date(Date.now() + timeoutMinutos * 60_000),
      motivo: 'AGUARDANDO_RESPOSTA',
    };
  }
}
