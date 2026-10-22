import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NodeExecutorRegistry } from '../node-executor.registry';
import { NodeExecutionContext, NodeExecutionResult, PublishedNode } from '../types';
import { CONDICAO_BRANCH, type CondicaoConfig } from '../../crm/acoes.constants';
import { avaliarCondicao } from '../../crm/condicao';

export const CONDITION_EXECUTOR = 'condition';

/**
 * Nó "Condição" — if/else na hora, sem suspender: lê o contato (etiquetas e
 * campos), a mensagem que abriu a rodada e o relógio, e segue por "sim" ou
 * "nao" (`handleOrigem` das duas saídas desenhadas no canvas).
 */
@Injectable()
export class ConditionHandler {
  constructor(
    private readonly registry: NodeExecutorRegistry,
    private readonly prisma: PrismaService,
  ) {
    this.registry.register(CONDITION_EXECUTOR, (node, context) => this.handle(node, context));
  }

  private async handle(node: PublishedNode, context: NodeExecutionContext): Promise<NodeExecutionResult> {
    const contato = await this.prisma.contato.findUnique({
      where: { id: context.contatoId },
      include: { etiquetas: { select: { etiquetaId: true } } },
    });
    const resultado = avaliarCondicao(node.configJson as unknown as CondicaoConfig, {
      etiquetaIds: new Set(contato?.etiquetas.map((e) => e.etiquetaId) ?? []),
      campos: {
        nome: contato?.nome ?? null,
        telefone: contato?.telefone ?? null,
        email: contato?.email ?? null,
        observacoes: contato?.observacoes ?? null,
        valor: contato ? Number(contato.valor) : null,
        rating: contato?.rating ?? null,
      },
      mensagem: context.incoming?.texto ?? context.incoming?.conteudo ?? null,
      agora: new Date(),
    });
    return {
      kind: 'ok',
      branch: resultado ? CONDICAO_BRANCH.sim : CONDICAO_BRANCH.nao,
      output: { resultado },
    };
  }
}
