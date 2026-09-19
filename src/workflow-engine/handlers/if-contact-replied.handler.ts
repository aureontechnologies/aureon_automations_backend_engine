import { Injectable } from '@nestjs/common';
import { NodeExecutorRegistry } from '../node-executor.registry';
import { NodeExecutionContext, NodeExecutionResult, PublishedNode } from '../types';

export const IF_CONTACT_REPLIED_EXECUTOR = 'if_contact_replied';

/** `handleOrigem` das duas saídas do nó — o web desenha um handle para cada. */
export const CONTACT_REPLIED_BRANCH = { yes: 'sim', no: 'nao' } as const;

/**
 * "Contato respondeu?" — if/else logo depois de um "Aguardar resposta".
 *
 * Não suspende nem envia nada: olha COMO terminou a espera que retomou esta
 * rodada e escolhe a saída na hora. `REPLY` (o contato escreveu dentro do
 * prazo) segue por "sim"; `TIMEOUT` (o prazo esgotou) segue por "não".
 *
 * Sem espera nenhuma antes (nó ligado direto ao gatilho), a rodada foi aberta
 * pela própria mensagem do contato — então ele respondeu: "sim". Por isso a
 * regra olha a mensagem recebida quando não há espera para consultar.
 */
@Injectable()
export class IfContactRepliedHandler {
  constructor(private readonly registry: NodeExecutorRegistry) {
    this.registry.register(IF_CONTACT_REPLIED_EXECUTOR, (node, context) =>
      this.handle(node, context),
    );
  }

  private async handle(
    _node: PublishedNode,
    context: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const respondeu = context.waitResolution
      ? context.waitResolution === 'REPLY'
      : context.incoming !== undefined;
    return {
      kind: 'ok',
      branch: respondeu ? CONTACT_REPLIED_BRANCH.yes : CONTACT_REPLIED_BRANCH.no,
      output: { respondeu },
    };
  }
}
