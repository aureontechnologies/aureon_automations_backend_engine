import { Canal } from '@prisma/client';
import type {
  InboundAttachment,
  InboundContactCard,
  InboundLocation,
  InboundMessageTipo,
  InboundReaction,
  InboundReplyContext,
} from '../messaging/inbound-message';

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

/**
 * A mensagem que originou esta rodada de execução (disparo inicial ou resposta
 * que resolveu uma espera), já normalizada pelo backend.
 *
 * `conteudo` é a linha legível ("[imagem] essa cor ficou linda"); `texto` é só
 * o que o contato escreveu. Os campos estruturados existem para que um nó —
 * ou o Agente IA — possa reagir ao que de fato chegou.
 */
export interface IncomingMessage {
  conteudo: string | null;
  texto?: string | null;
  tipo: InboundMessageTipo;
  interactiveReplyId?: string | null;
  anexos?: InboundAttachment[];
  localizacao?: InboundLocation;
  contatoCompartilhado?: InboundContactCard;
  reacao?: InboundReaction;
  respostaA?: InboundReplyContext;
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
  /** Conexão (WhatsAppConnection/InstagramConnection/FacebookConnection) resolvida do nó-gatilho publicado — usada por todo nó de envio deste fluxo. */
  connectionId: string;
  /** A mensagem que originou esta rodada: a do disparo inicial ou a resposta que resolveu uma espera. Ausente quando a rodada foi retomada por timeout. */
  incoming?: IncomingMessage;
  /**
   * Como terminou a espera que retomou esta rodada — `REPLY` (o contato
   * respondeu) ou `TIMEOUT` (o prazo esgotou). Ausente na rodada do disparo
   * inicial, em que nenhuma espera aconteceu ainda.
   */
  waitResolution?: 'REPLY' | 'TIMEOUT';
}

/** Sinaliza ao motor "pare de andar o grafo agora e persista o estado" — sem lançar exceção, controle de fluxo explícito (mesmo espírito de `SuspendWorkflow`/`RestartWorkflow` da referência). */
export type NodeExecutionResult =
  /**
   * `branch` presente = nó condicional (if/else) que decide na hora, sem
   * suspender: o motor segue SÓ a aresta cujo `handleOrigem` é igual a ele.
   * Ausente = segue todas as arestas de saída, como sempre.
   */
  | { kind: 'ok'; output?: Record<string, unknown>; branch?: string }
  /**
   * `publicarAposEspera` sai na fila só DEPOIS que a espera está gravada. É o
   * caso da mensagem com botões: publicar antes abre uma janela em que o
   * contato já pode ter clicado e ainda não existe espera para aquele clique
   * resolver — e o clique se perderia.
   */
  | {
      kind: 'suspend';
      resumeAt: Date;
      motivo: string;
      output?: Record<string, unknown>;
      publicarAposEspera?: { routingKey: string; event: Record<string, unknown> };
    }
  | { kind: 'finish'; output?: Record<string, unknown> }
  /**
   * Devolve a execução a um nó anterior — é o "Reiniciar automação".
   *
   * O alvo vem como `clientId` (o id que o canvas gera e o usuário escolheu na
   * configuração do nó), e não como id de banco: é o `clientId` que o inspector
   * conhece, e o snapshot publicado carrega os dois, então o motor resolve a
   * tradução. O handler não teria como fazê-la — ele não vê o snapshot.
   *
   * Voltar significa reexecutar de verdade os nós dali para frente, então o
   * motor abre uma VOLTA nova da execução (ver `volta` em
   * `WorkflowExecutionNode`): sem isso, a trava de idempotência que protege o
   * reprocessamento de eventos duplicados pularia todo o trecho repetido.
   */
  | { kind: 'goto'; targetClientId: string; output?: Record<string, unknown> };

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
