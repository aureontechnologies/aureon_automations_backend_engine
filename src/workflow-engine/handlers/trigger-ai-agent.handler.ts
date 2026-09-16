import { Injectable } from '@nestjs/common';
import { AgentConversationService } from '../../agent-conversation/agent-conversation.service';
import { NodeExecutorRegistry } from '../node-executor.registry';
import { NodeExecutionContext, NodeExecutionResult, PublishedNode } from '../types';

export const TRIGGER_AI_AGENT_EXECUTOR = 'trigger_ai_agent';

/**
 * Aciona um Agente IA para "assumir" a conversa — ao contrário dos outros
 * nós de ação, este SEMPRE finaliza a execução do workflow aqui (`kind:
 * 'finish'`), mesmo que existam arestas depois dele no grafo: a partir deste
 * ponto, a condução da conversa passa a ser feita pelo próprio agente
 * (`Contato.agenteAtivoId`), fora do motor de workflow, até ele mesmo decidir
 * transferir para um humano.
 */
@Injectable()
export class TriggerAiAgentHandler {
  constructor(
    private readonly registry: NodeExecutorRegistry,
    private readonly agentConversationService: AgentConversationService,
  ) {
    this.registry.register(TRIGGER_AI_AGENT_EXECUTOR, (node, context) =>
      this.handle(node, context),
    );
  }

  private async handle(
    node: PublishedNode,
    context: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const agentId = String(node.configJson.agentId ?? '');
    if (!agentId) {
      throw new Error('Nó "Agente IA" sem agentId configurado.');
    }

    const outcome = await this.agentConversationService.respond({
      tenantId: context.tenantId,
      contatoId: context.contatoId,
      contatoTelefone: context.contatoTelefone,
      contatoNome: context.contatoNome,
      agentId,
      canal: context.canal,
      connectionId: context.connectionId,
    });

    return { kind: 'finish', output: { agentId, outcome: outcome.status } };
  }
}
