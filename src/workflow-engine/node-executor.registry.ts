import { Injectable } from '@nestjs/common';
import { BranchResolver, NodeHandler } from './types';

/**
 * Registry chave(`NodeType.executor`)→handler, mesmo padrão da referência
 * (`NodeExecutorRegistry` do worker Python) — um handler novo se registra
 * chamando `register()` no seu próprio construtor (ver `handlers/*.ts`), e o
 * `WorkflowEngineModule` só precisa listar as classes de handler nos seus
 * `providers` pra que o registro aconteça (Nest instancia todo provider
 * declarado, mesmo que nada mais o injete diretamente — ver comentário em
 * `handlers/index.ts`).
 */
@Injectable()
export class NodeExecutorRegistry {
  private readonly handlers = new Map<string, NodeHandler>();
  private readonly branchResolvers = new Map<string, BranchResolver>();

  register(
    executorKey: string,
    handler: NodeHandler,
    branchResolver?: BranchResolver,
  ): void {
    this.handlers.set(executorKey, handler);
    if (branchResolver) {
      this.branchResolvers.set(executorKey, branchResolver);
    }
  }

  get(executorKey: string): NodeHandler {
    const handler = this.handlers.get(executorKey);
    if (!handler) {
      throw new Error(`Nenhum handler registrado para executor "${executorKey}".`);
    }
    return handler;
  }

  isBranching(executorKey: string): boolean {
    return this.branchResolvers.has(executorKey);
  }

  getBranchResolver(executorKey: string): BranchResolver | undefined {
    return this.branchResolvers.get(executorKey);
  }
}
