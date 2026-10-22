import { Injectable } from '@nestjs/common';
import { NodeExecutorRegistry } from '../node-executor.registry';
import { NodeExecutionContext, NodeExecutionResult, PublishedNode } from '../types';
import { ATRASO_MAX_SEGUNDOS, atrasoEmSegundos } from '../../crm/acoes.constants';

export const SMART_DELAY_EXECUTOR = 'smart_delay';

/**
 * "Atraso inteligente" — espera um TEMPO e segue. Diferente do "Aguardar
 * resposta", uma mensagem do contato no meio não adianta o fluxo
 * (`aceitaResposta: false`); quem retoma é sempre o poller de timeout.
 *
 * O poller passa a cada 15s: atrasos curtos (segundos) têm essa granularidade.
 */
@Injectable()
export class SmartDelayHandler {
  constructor(private readonly registry: NodeExecutorRegistry) {
    this.registry.register(SMART_DELAY_EXECUTOR, (node, context) => this.handle(node, context));
  }

  private async handle(node: PublishedNode, _context: NodeExecutionContext): Promise<NodeExecutionResult> {
    const segundos = atrasoEmSegundos(node.configJson);
    if (!Number.isFinite(segundos) || segundos <= 0) {
      throw new Error('Nó "Atraso inteligente" sem tempo válido.');
    }
    const espera = Math.min(segundos, ATRASO_MAX_SEGUNDOS);
    return {
      kind: 'suspend',
      resumeAt: new Date(Date.now() + espera * 1000),
      motivo: 'ATRASO_INTELIGENTE',
      aceitaResposta: false,
      output: { segundos: espera },
    };
  }
}
