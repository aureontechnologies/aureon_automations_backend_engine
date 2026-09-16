import { Canal } from '@prisma/client';

export interface PublishedNode {
  id: string;
  clientId: string;
  nodeTypeChave?: string;
  executor?: string;
  isTrigger: boolean;
  configJson: Record<string, unknown>;
}

export interface PublishedEdge {
  origemNodeId: string;
  destinoNodeId: string;
  handleOrigem?: string | null;
}

/** Forma exata gravada em `Workflow.publishedJson` por `workflow.service.ts::publishWorkflow`. */
export interface PublishedWorkflowSnapshot {
  workflowId: string;
  nome: string;
  nodes: PublishedNode[];
  edges: PublishedEdge[];
}

/** A mensagem que originou esta rodada de execução (disparo inicial ou resposta que resolveu uma espera). */
export interface IncomingMessage {
  conteudo: string | null;
  tipo: 'TEXTO' | 'BOTOES' | 'MIDIA';
  interactiveReplyId?: string | null;
  occurredAt: string;
}

export interface NodeExecutionContext {
  tenantId: string;
  contatoId: string;
  contatoTelefone: string;
  contatoNome: string | null;
  canal: Canal;
  workflowId: string;
  executionId: string;
  /** `WorkflowExecutionNode.id` do nó sendo executado agora — usado como chave de idempotência dos eventos de envio publicados por este nó. */
  executionNodeId: string;
  /** Conexão (WhatsAppConnection/MetaChannelConnection) resolvida do nó-gatilho publicado — usada por todo nó de envio deste fluxo. */
  connectionId: string;
  /** Presente apenas quando esta rodada foi retomada por uma resposta (não por timeout nem no disparo inicial). */
  incoming?: IncomingMessage;
}

/** Sinaliza ao motor "pare de andar o grafo agora e persista o estado" — sem lançar exceção, controle de fluxo explícito (mesmo espírito de `SuspendWorkflow`/`RestartWorkflow` da referência). */
export type NodeExecutionResult =
  | { kind: 'ok'; output?: Record<string, unknown> }
  | { kind: 'suspend'; resumeAt: Date; motivo: string; output?: Record<string, unknown> }
  | { kind: 'finish'; output?: Record<string, unknown> };

export type NodeHandler = (
  node: PublishedNode,
  context: NodeExecutionContext,
) => Promise<NodeExecutionResult>;

/** Só nós que suspendem (`send_buttons_message`) precisam resolver, no resume, qual aresta seguir a partir da resposta recebida. */
export type BranchResolver = (
  node: PublishedNode,
  incoming: IncomingMessage | undefined,
  resolvedReason: 'REPLY' | 'TIMEOUT',
) => string | null | undefined; // handleOrigem a seguir, ou null/undefined = nenhuma aresta (resposta ambígua)
