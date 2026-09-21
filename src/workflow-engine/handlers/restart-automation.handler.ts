import { Injectable } from '@nestjs/common';
import { NodeExecutorRegistry } from '../node-executor.registry';
import { NodeExecutionContext, NodeExecutionResult, PublishedNode } from '../types';

export const RESTART_AUTOMATION_EXECUTOR = 'restart_automation';

/** Chave do alvo dentro do `configJson` — o `clientId` do nó escolhido no inspector. */
export const RESTART_TARGET_KEY = 'nodeClientId';

/**
 * "Reiniciar automação" — devolve o fluxo a um nó anterior escolhido pelo
 * usuário.
 *
 * O handler é deliberadamente burro: ele não sabe onde o alvo está no grafo
 * (não enxerga o snapshot nem as arestas) e não decide nada sobre reexecução.
 * Só diz PARA ONDE voltar, e o motor cuida do resto — abrir a volta nova,
 * limpar os visitados e respeitar o teto de voltas. É a mesma divisão do
 * `branch` dos nós condicionais: o handler escolhe, o motor anda o grafo.
 *
 * O alvo vazio é erro de execução, e não um "segue em frente": o nó não tem
 * saída nenhuma, então ignorar a falta de alvo deixaria o contato numa conversa
 * que simplesmente para — exatamente o que a validação de ativação existe para
 * evitar, e o que este erro torna visível se algo escapar dela.
 */
@Injectable()
export class RestartAutomationHandler {
  constructor(private readonly registry: NodeExecutorRegistry) {
    this.registry.register(RESTART_AUTOMATION_EXECUTOR, (node, context) =>
      this.handle(node, context),
    );
  }

  private async handle(
    node: PublishedNode,
    _context: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const targetClientId = String(node.configJson[RESTART_TARGET_KEY] ?? '').trim();
    if (!targetClientId) {
      throw new Error('Nó "Reiniciar automação" sem o nó de destino escolhido.');
    }

    return { kind: 'goto', targetClientId };
  }
}
