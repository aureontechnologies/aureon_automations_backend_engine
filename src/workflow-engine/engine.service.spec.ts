import { Prisma } from '@prisma/client';
import { WorkflowEngineService } from './engine.service';
import { IfContactRepliedHandler } from './handlers/if-contact-replied.handler';
import { WaitForReplyHandler } from './handlers/wait-for-reply.handler';
import { NodeExecutorRegistry } from './node-executor.registry';
import { PublishedWorkflowSnapshot } from './types';

/**
 * Motor de verdade (drain/resume) + handlers de verdade, sobre um Prisma em
 * memória. O que se verifica é o CAMINHO percorrido: quais nós rodaram.
 */

const SNAPSHOT: PublishedWorkflowSnapshot = {
  workflowId: 'wf-1',
  nome: 'Follow-up',
  nodes: [
    { id: 'trigger', clientId: 't', isTrigger: true, executor: 'trigger_whatsapp_message', configJson: { connectionId: 'conn-1' } },
    { id: 'wait', clientId: 'w', isTrigger: false, executor: 'wait_for_reply', configJson: { timeoutMinutos: 5 } },
    { id: 'check', clientId: 'c', isTrigger: false, executor: 'if_contact_replied', configJson: {} },
    { id: 'yes', clientId: 'y', isTrigger: false, executor: 'record', configJson: {} },
    { id: 'no', clientId: 'n', isTrigger: false, executor: 'record', configJson: {} },
  ],
  edges: [
    { origemNodeId: 'trigger', destinoNodeId: 'wait' },
    { origemNodeId: 'wait', destinoNodeId: 'check' },
    { origemNodeId: 'check', destinoNodeId: 'yes', handleOrigem: 'sim' },
    { origemNodeId: 'check', destinoNodeId: 'no', handleOrigem: 'nao' },
  ],
};

interface NodeRow {
  id: string;
  executionId: string;
  nodeId: string;
  status: string;
  output?: unknown;
}

interface FindWhere {
  id?: string;
  executionId_nodeId?: { executionId: string; nodeId: string };
}

function buildEngine(snapshot: PublishedWorkflowSnapshot = SNAPSHOT) {
  const nodeRows: NodeRow[] = [];
  const waits: Array<Record<string, unknown>> = [];
  const execution = { id: 'exec-1', workflowId: 'wf-1', contatoId: 'contato-1', status: 'RUNNING' };
  const ran: string[] = [];

  const prisma = {
    workflow: {
      findUnique: jest.fn(async () => ({
        id: 'wf-1',
        tenantId: 'tenant-1',
        canal: 'WHATSAPP',
        publishedJson: snapshot,
      })),
    },
    workflowExecution: {
      findUnique: jest.fn(async () => execution),
      update: jest.fn(async ({ data }: { data: { status: string } }) => {
        execution.status = data.status;
        return execution;
      }),
    },
    workflowExecutionNode: {
      create: jest.fn(async ({ data }: { data: { executionId: string; nodeId: string } }) => {
        if (nodeRows.some((r) => r.executionId === data.executionId && r.nodeId === data.nodeId)) {
          throw new Prisma.PrismaClientKnownRequestError('duplicado', {
            code: 'P2002',
            clientVersion: 'test',
          });
        }
        const row: NodeRow = { id: `en-${data.nodeId}`, ...data, status: 'RUNNING' };
        nodeRows.push(row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: { where: FindWhere }) => {
        const key = where.executionId_nodeId;
        return where.id
          ? nodeRows.find((r) => r.id === where.id)
          : nodeRows.find((r) => r.executionId === key?.executionId && r.nodeId === key?.nodeId);
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<NodeRow> }) => {
        const row = nodeRows.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    workflowExecutionWait: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const wait = { id: `wait-${waits.length + 1}`, ...data };
        waits.push(wait);
        return wait;
      }),
    },
  };
  const contatos = {
    findById: jest.fn(async () => ({ id: 'contato-1', telefone: '5511999999999', nome: 'Ana' })),
  };

  const registry = new NodeExecutorRegistry();
  new WaitForReplyHandler(registry);
  new IfContactRepliedHandler(registry);
  registry.register('record', async (node) => {
    ran.push(node.id);
    return { kind: 'ok' };
  });

  const engine = new WorkflowEngineService(prisma as never, registry, contatos as never);
  return { engine, nodeRows, waits, execution, ran };
}

const TRIGGER_EVENT = {
  eventId: 'ev-1',
  executionId: 'exec-1',
  workflowId: 'wf-1',
  tenantId: 'tenant-1',
  contatoId: 'contato-1',
  triggerNodeId: 'trigger',
  canal: 'WHATSAPP',
  connectionId: 'conn-1',
  conteudo: 'Oi',
  tipo: 'TEXTO',
  occurredAt: new Date().toISOString(),
} as never;

const REPLY = { conteudo: 'Quero sim', tipo: 'TEXTO' as const, occurredAt: new Date().toISOString() };

describe('WorkflowEngineService — nó "Contato respondeu?"', () => {
  it('suspende no "Aguardar resposta" sem decidir nada ainda', async () => {
    const { engine, waits, execution, ran } = buildEngine();

    await engine.runFromTrigger(TRIGGER_EVENT);

    expect(execution.status).toBe('WAITING');
    expect(waits).toHaveLength(1);
    expect(waits[0].pendingQueue).toEqual(['check']);
    expect(ran).toEqual([]);
  });

  it('segue por "sim" quando a espera termina com a resposta do contato', async () => {
    const { engine, waits, execution, ran, nodeRows } = buildEngine();
    await engine.runFromTrigger(TRIGGER_EVENT);

    await engine.resumeWait(waits[0] as never, 'REPLY', REPLY);

    expect(ran).toEqual(['yes']);
    expect(execution.status).toBe('FINISHED');
    expect(nodeRows.find((r) => r.nodeId === 'check')?.output).toEqual({
      respondeu: true,
      branch: 'sim',
    });
  });

  it('segue por "não" quando o prazo esgota sem resposta', async () => {
    const { engine, waits, execution, ran } = buildEngine();
    await engine.runFromTrigger(TRIGGER_EVENT);

    await engine.resumeWait(waits[0] as never, 'TIMEOUT');

    expect(ran).toEqual(['no']);
    expect(execution.status).toBe('FINISHED');
  });

  it('com um ramo sem aresta, encerra a execução sem seguir o outro', async () => {
    const semNao = {
      ...SNAPSHOT,
      edges: SNAPSHOT.edges.filter((e) => e.handleOrigem !== 'nao'),
    };
    const { engine, waits, execution, ran } = buildEngine(semNao);
    await engine.runFromTrigger(TRIGGER_EVENT);

    await engine.resumeWait(waits[0] as never, 'TIMEOUT');

    expect(ran).toEqual([]);
    expect(execution.status).toBe('FINISHED');
  });

  it('ligado direto ao gatilho, a mensagem que abriu a rodada conta como resposta', async () => {
    const direto = {
      ...SNAPSHOT,
      edges: [
        { origemNodeId: 'trigger', destinoNodeId: 'check' },
        ...SNAPSHOT.edges.filter((e) => e.origemNodeId === 'check'),
      ],
    };
    const { engine, ran } = buildEngine(direto);

    await engine.runFromTrigger(TRIGGER_EVENT);

    expect(ran).toEqual(['yes']);
  });

  it('no reprocessamento, segue o MESMO ramo já escolhido sem reexecutar o nó', async () => {
    const { engine, waits, ran, nodeRows } = buildEngine();
    await engine.runFromTrigger(TRIGGER_EVENT);
    await engine.resumeWait(waits[0] as never, 'REPLY', REPLY);
    // Simula crash depois do "check" e antes do nó seguinte: o reprocessamento
    // chega com TIMEOUT, mas o ramo gravado ("sim") é o que vale.
    nodeRows.splice(
      nodeRows.findIndex((r) => r.nodeId === 'yes'),
      1,
    );
    ran.length = 0;

    await engine.resumeWait(waits[0] as never, 'TIMEOUT');

    expect(ran).toEqual(['yes']);
  });
});
