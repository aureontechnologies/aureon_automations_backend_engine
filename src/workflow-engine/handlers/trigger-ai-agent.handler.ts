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

    // Uma falha aqui (sem créditos, OpenAI fora do ar) precisa aparecer como
    // execução FALHADA na tela de Execuções — silenciar deixaria o contato sem
    // resposta e o cliente sem saber por quê.
    const outcome = await this.agentConversationService.respond({
      tenantId: context.tenantId,
      contatoId: context.contatoId,
      contatoTelefone: context.contatoTelefone,
      contatoNome: context.contatoNome,
      agentId,
      canal: context.canal,
      connectionId: context.connectionId,
    });

    // A mensagem de cada falha é o que o cliente vai LER na tela de Execuções,
    // então ela diz o que fazer — e "sem créditos" não pode parecer um defeito
    // do sistema, porque não é.
    if (outcome.status === 'sem_creditos') {
      throw new Error(
        'Saldo insuficiente de créditos de IA para o Agente IA responder. ' +
          'Adquira créditos adicionais para continuar.',
      );
    }
    if (outcome.status === 'sem_provedor') {
      throw new Error(
        'O serviço de IA está indisponível no momento. Tente novamente em instantes.',
      );
    }
    if (outcome.status === 'falha_provedor') {
      throw new Error(`Falha ao acionar o Agente IA: ${outcome.motivo}`);
    }

    return {
      kind: 'finish',
      output: {
        agentId,
        transferidoParaHumano: outcome.transferido,
        creditosConsumidos: outcome.creditosConsumidos,
      },
    };
  }
}
