import { Injectable } from '@nestjs/common';
import { NodeExecutorRegistry } from '../node-executor.registry';
import { NodeExecutionContext, NodeExecutionResult, PublishedNode } from '../types';
import { CrmActionsService, type ResultadoAcao } from '../../crm/crm-actions.service';
import type { AcaoConfig } from '../../crm/acoes.constants';

export const RUN_ACTIONS_EXECUTOR = 'run_actions';

/**
 * Nó "Ações" — executa, em ordem, a lista de ações configurada (etiquetas,
 * Kanban, agenda, outro fluxo, campos, notificação, atribuição) e segue.
 * O resultado de cada uma vai para o output do nó (tela de Execuções).
 */
@Injectable()
export class RunActionsHandler {
  constructor(
    private readonly registry: NodeExecutorRegistry,
    private readonly crm: CrmActionsService,
  ) {
    this.registry.register(RUN_ACTIONS_EXECUTOR, (node, context) => this.handle(node, context));
  }

  private async handle(node: PublishedNode, context: NodeExecutionContext): Promise<NodeExecutionResult> {
    const acoes = (Array.isArray(node.configJson.acoes) ? node.configJson.acoes : []) as AcaoConfig[];
    const resultados: ResultadoAcao[] = [];
    for (const acao of acoes) {
      resultados.push(await this.crm.executar(acao, context));
    }
    return { kind: 'ok', output: { acoes: resultados } };
  }
}
