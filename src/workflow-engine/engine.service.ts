import { Injectable, Logger } from '@nestjs/common';
import { Prisma, WorkflowExecutionWait } from '@prisma/client';
import { ContatoRepository } from '../contatos/contato.repository';
import { AutomationTriggerEvent } from '../messaging/automation-trigger.event';
import { PrismaService } from '../prisma/prisma.service';
import { NodeExecutorRegistry } from './node-executor.registry';
import {
  IncomingMessage,
  NodeExecutionContext,
  NodeExecutionResult,
  PublishedEdge,
  PublishedNode,
  PublishedWorkflowSnapshot,
} from './types';

interface DrainState {
  executionId: string;
  snapshot: PublishedWorkflowSnapshot;
  nodesById: Map<string, PublishedNode>;
  edgesBySource: Map<string, PublishedEdge[]>;
  baseContext: Omit<NodeExecutionContext, 'executionNodeId' | 'incoming'>;
  queue: string[];
  visited: Set<string>;
  incoming?: IncomingMessage;
}

/**
 * Anda o grafo publicado de um workflow (BFS), despachando cada nó pelo seu
 * `executor` via `NodeExecutorRegistry` — mesma estrutura de
 * `_drain_queue`/`_execute_action_node` da referência (worker Python), com
 * uma garantia a mais: cada nó só é executado depois de uma tentativa de
 * CRIAR sua linha `WorkflowExecutionNode` (trava de idempotência via
 * `@@unique([executionId, nodeId])`) — se a criação colidir, o nó já foi
 * processado numa tentativa anterior (crash + reprocessamento do mesmo
 * evento `automation.trigger`) e é pulado sem reexecutar o handler, evitando
 * reenvio duplicado de mensagem.
 */
@Injectable()
export class WorkflowEngineService {
  private readonly logger = new Logger(WorkflowEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: NodeExecutorRegistry,
    private readonly contatoRepository: ContatoRepository,
  ) {}

  async runFromTrigger(event: AutomationTriggerEvent): Promise<void> {
    const workflow = await this.prisma.workflow.findUnique({
      where: { id: event.workflowId },
    });
    const snapshot = workflow?.publishedJson as unknown as PublishedWorkflowSnapshot | undefined;
    if (!snapshot) {
      this.logger.error(`Workflow ${event.workflowId} sem publishedJson — não é possível executar.`);
      await this.markExecutionFailed(event.executionId, 'Workflow sem snapshot publicado.');
      return;
    }

    const contato = await this.contatoRepository.findById(event.contatoId);
    if (!contato) {
      await this.markExecutionFailed(event.executionId, 'Contato não encontrado.');
      return;
    }

    const nodesById = new Map(snapshot.nodes.map((n) => [n.id, n]));
    const edgesBySource = this.groupEdgesBySource(snapshot.edges);
    const triggerNode = nodesById.get(event.triggerNodeId);
    if (!triggerNode) {
      await this.markExecutionFailed(event.executionId, 'Nó-gatilho não encontrado no snapshot.');
      return;
    }

    const baseContext: DrainState['baseContext'] = {
      tenantId: event.tenantId,
      contatoId: event.contatoId,
      contatoTelefone: contato.telefone,
      contatoNome: contato.nome,
      canal: event.canal,
      workflowId: event.workflowId,
      executionId: event.executionId,
      connectionId: event.connectionId,
    };
    const incoming: IncomingMessage = {
      conteudo: event.conteudo,
      tipo: event.tipo,
      interactiveReplyId: event.interactiveReplyId,
      occurredAt: event.occurredAt,
    };

    const queue = this.successorNodeIds(triggerNode.id, edgesBySource);
    await this.drain({
      executionId: event.executionId,
      snapshot,
      nodesById,
      edgesBySource,
      baseContext,
      queue,
      visited: new Set([triggerNode.id]),
      incoming,
    });
  }

  async resumeWait(
    wait: WorkflowExecutionWait,
    resolvedReason: 'REPLY' | 'TIMEOUT',
    incoming?: IncomingMessage,
  ): Promise<void> {
    const execution = await this.prisma.workflowExecution.findUnique({
      where: { id: wait.executionId },
    });
    if (!execution) return;

    const workflow = await this.prisma.workflow.findUnique({
      where: { id: execution.workflowId },
    });
    const snapshot = workflow?.publishedJson as unknown as PublishedWorkflowSnapshot | undefined;
    if (!snapshot) {
      await this.markExecutionFailed(execution.id, 'Workflow sem snapshot publicado.');
      return;
    }

    const contato = await this.contatoRepository.findById(execution.contatoId);
    if (!contato) {
      await this.markExecutionFailed(execution.id, 'Contato não encontrado.');
      return;
    }

    const nodesById = new Map(snapshot.nodes.map((n) => [n.id, n]));
    const edgesBySource = this.groupEdgesBySource(snapshot.edges);
    const triggerNode = snapshot.nodes.find((n) => n.isTrigger);
    const connectionId = String(triggerNode?.configJson.connectionId ?? '');

    const executionNode = await this.prisma.workflowExecutionNode.findUnique({
      where: { id: wait.executionNodeId },
    });
    const stoppedAtNode = executionNode ? nodesById.get(executionNode.nodeId) : undefined;

    let queue = (wait.pendingQueue as string[]) ?? [];
    const visited = new Set<string>((wait.visitedNodeIds as string[]) ?? []);

    if (stoppedAtNode && this.registry.isBranching(stoppedAtNode.executor ?? '')) {
      const resolver = this.registry.getBranchResolver(stoppedAtNode.executor ?? '');
      const handle = resolver?.(stoppedAtNode, incoming, resolvedReason);
      if (handle) {
        const edge = (edgesBySource.get(stoppedAtNode.id) ?? []).find(
          (e) => e.handleOrigem === handle,
        );
        if (edge) queue = [edge.destinoNodeId, ...queue];
      }
      // Sem handle resolvido (resposta ambígua ou timeout sem aresta própria): a fila permanece como estava — nenhum ramo seguido.
    }

    const baseContext: DrainState['baseContext'] = {
      tenantId: workflow!.tenantId,
      contatoId: execution.contatoId,
      contatoTelefone: contato.telefone,
      contatoNome: contato.nome,
      canal: workflow!.canal,
      workflowId: execution.workflowId,
      executionId: execution.id,
      connectionId,
    };

    await this.prisma.workflowExecution.update({
      where: { id: execution.id },
      data: { status: 'RUNNING' },
    });

    await this.drain({
      executionId: execution.id,
      snapshot,
      nodesById,
      edgesBySource,
      baseContext,
      queue,
      visited,
      incoming,
    });
  }

  private async drain(state: DrainState): Promise<void> {
    const { executionId, nodesById, edgesBySource, baseContext, incoming } = state;
    const queue = [...state.queue];
    const visited = state.visited;

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const node = nodesById.get(nodeId);
      if (!node) {
        this.logger.warn(`Aresta aponta para nó inexistente (${nodeId}) — pulando este ramo.`);
        continue;
      }

      const claim = await this.claimExecutionNode(executionId, node.id);
      if (claim.status === 'SUCCESS') {
        // Reprocessamento idempotente: este nó já rodou numa tentativa anterior — não reexecuta, só avança.
        queue.push(...this.successorNodeIds(nodeId, edgesBySource));
        continue;
      }
      if (claim.status === 'FAILED') {
        // Execução já é FAILED por uma tentativa anterior — não há o que continuar.
        return;
      }

      const context: NodeExecutionContext = {
        ...baseContext,
        executionNodeId: claim.executionNodeId,
        incoming,
      };

      let result: NodeExecutionResult;
      try {
        if (!node.executor) throw new Error(`Nó ${node.id} sem executor definido.`);
        const handler = this.registry.get(node.executor);
        result = await handler(node, context);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Falha ao executar nó ${node.id} (${node.executor}): ${message}`);
        await this.markNodeFailed(claim.executionNodeId, message);
        await this.markExecutionFailed(executionId, message);
        return;
      }

      if (result.kind === 'ok') {
        await this.markNodeSuccess(claim.executionNodeId, result.output);
        queue.push(...this.successorNodeIds(nodeId, edgesBySource));
        continue;
      }

      if (result.kind === 'finish') {
        await this.markNodeSuccess(claim.executionNodeId, result.output);
        await this.markExecutionFinished(executionId);
        return;
      }

      // result.kind === 'suspend'
      await this.markNodeSuccess(claim.executionNodeId, result.output);
      if (!node.executor || !this.registry.isBranching(node.executor)) {
        // Nó não-ramificado: o caminho seguinte já é conhecido, enfileira antes de suspender.
        queue.push(...this.successorNodeIds(nodeId, edgesBySource));
      }
      await this.persistWait(executionId, claim.executionNodeId, result.resumeAt, queue, visited);
      await this.prisma.workflowExecution.update({
        where: { id: executionId },
        data: { status: 'WAITING' },
      });
      return;
    }

    await this.markExecutionFinished(executionId);
  }

  private async claimExecutionNode(
    executionId: string,
    nodeId: string,
  ): Promise<{ status: 'PENDING' | 'SUCCESS' | 'FAILED'; executionNodeId: string }> {
    try {
      const created = await this.prisma.workflowExecutionNode.create({
        data: { executionId, nodeId, status: 'RUNNING', iniciadoEm: new Date() },
      });
      return { status: 'PENDING', executionNodeId: created.id };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.workflowExecutionNode.findUnique({
          where: { executionId_nodeId: { executionId, nodeId } },
        });
        return {
          status: (existing?.status as 'SUCCESS' | 'FAILED') ?? 'PENDING',
          executionNodeId: existing!.id,
        };
      }
      throw error;
    }
  }

  private async markNodeSuccess(
    executionNodeId: string,
    output?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.workflowExecutionNode.update({
      where: { id: executionNodeId },
      data: {
        status: 'SUCCESS',
        output: (output ?? {}) as Prisma.InputJsonValue,
        finalizadoEm: new Date(),
      },
    });
  }

  private async markNodeFailed(executionNodeId: string, erro: string): Promise<void> {
    await this.prisma.workflowExecutionNode.update({
      where: { id: executionNodeId },
      data: { status: 'FAILED', erro, finalizadoEm: new Date() },
    });
  }

  private async markExecutionFailed(executionId: string, _erro: string): Promise<void> {
    await this.prisma.workflowExecution
      .update({
        where: { id: executionId },
        data: { status: 'FAILED', finalizadoEm: new Date() },
      })
      .catch(() => undefined);
  }

  private async markExecutionFinished(executionId: string): Promise<void> {
    await this.prisma.workflowExecution.update({
      where: { id: executionId },
      data: { status: 'FINISHED', finalizadoEm: new Date() },
    });
  }

  private async persistWait(
    executionId: string,
    executionNodeId: string,
    resumeAt: Date,
    pendingQueue: string[],
    visited: Set<string>,
  ): Promise<void> {
    await this.prisma.workflowExecutionWait.create({
      data: {
        executionId,
        executionNodeId,
        resumeAt,
        pendingQueue: pendingQueue as unknown as Prisma.InputJsonValue,
        visitedNodeIds: [...visited] as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private groupEdgesBySource(edges: PublishedEdge[]): Map<string, PublishedEdge[]> {
    const map = new Map<string, PublishedEdge[]>();
    for (const edge of edges) {
      const list = map.get(edge.origemNodeId) ?? [];
      list.push(edge);
      map.set(edge.origemNodeId, list);
    }
    return map;
  }

  private successorNodeIds(
    nodeId: string,
    edgesBySource: Map<string, PublishedEdge[]>,
  ): string[] {
    return (edgesBySource.get(nodeId) ?? []).map((edge) => edge.destinoNodeId);
  }
}
