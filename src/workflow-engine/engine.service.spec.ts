import { Prisma } from '@prisma/client';
import { MAX_VOLTAS, WorkflowEngineService } from './engine.service';
import { IfContactRepliedHandler } from './handlers/if-contact-replied.handler';
import { WaitForReplyHandler } from './handlers/wait-for-reply.handler';
import { RestartAutomationHandler } from './handlers/restart-automation.handler';
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
  /** Qual passagem do fluxo por este nó — cada "Reiniciar automação" abre a seguinte. */
  volta: number;
  status: string;
  output?: unknown;
}

interface FindWhere {
  id?: string;
  executionId_nodeId_volta?: { executionId: string; nodeId: string; volta: number };
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
      // A trava de idempotência do banco é (executionId, nodeId, volta): o mesmo
      // nó numa volta NOVA é uma linha nova, e é isso que deixa o fluxo voltar
      // atrás sem afrouxar a proteção contra evento duplicado.
      create: jest.fn(
        async ({ data }: { data: { executionId: string; nodeId: string; volta: number } }) => {
          if (
            nodeRows.some(
              (r) =>
                r.executionId === data.executionId &&
                r.nodeId === data.nodeId &&
                r.volta === data.volta,
            )
          ) {
            throw new Prisma.PrismaClientKnownRequestError('duplicado', {
              code: 'P2002',
              clientVersion: 'test',
            });
          }
          const row: NodeRow = {
            id: `en-${data.nodeId}-v${data.volta}`,
            ...data,
            status: 'RUNNING',
          };
          nodeRows.push(row);
          return row;
        },
      ),
      findUnique: jest.fn(async ({ where }: { where: FindWhere }) => {
        const key = where.executionId_nodeId_volta;
        return where.id
          ? nodeRows.find((r) => r.id === where.id)
          : nodeRows.find(
              (r) =>
                r.executionId === key?.executionId &&
                r.nodeId === key?.nodeId &&
                r.volta === key?.volta,
            );
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<NodeRow> }) => {
        const row = nodeRows.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    workflowExecutionWait: {
      // `executionId` é único no banco: uma execução tem no máximo UMA espera
      // pendente, reaproveitada a cada nova suspensão.
      upsert: jest.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { executionId: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const existente = waits.find((w) => w.executionId === where.executionId);
          if (existente) {
            Object.assign(existente, update);
            return existente;
          }
          const wait = { id: `wait-${waits.length + 1}`, ...create };
          waits.push(wait);
          return wait;
        },
      ),
    },
  };
  const contatos = {
    findById: jest.fn(async () => ({ id: 'contato-1', telefone: '5511999999999', nome: 'Ana' })),
  };

  const registry = new NodeExecutorRegistry();
  new WaitForReplyHandler(registry);
  new IfContactRepliedHandler(registry);
  new RestartAutomationHandler(registry);
  registry.register('record', async (node) => {
    ran.push(node.id);
    return { kind: 'ok' };
  });

  // Guarda quantas esperas já estavam gravadas no instante da publicação — é
  // o que prova a ORDEM (gravar a espera, depois publicar).
  const publicados: Array<{
    key: string;
    event: Record<string, unknown>;
    esperasGravadas: number;
  }> = [];
  const messaging = {
    publish: jest.fn((key: string, event: Record<string, unknown>) =>
      publicados.push({ key, event, esperasGravadas: waits.length }),
    ),
  };

  const engine = new WorkflowEngineService(
    prisma as never,
    registry,
    contatos as never,
    messaging as never,
  );
  return { engine, registry, nodeRows, waits, execution, ran, publicados };
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

  it('nó que suspende publica a mensagem SÓ depois de gravar a espera', async () => {
    // Ordem invertida deixaria uma janela em que o contato já clicou e ainda
    // não existe espera para aquele clique resolver.
    const comBotoes = {
      ...SNAPSHOT,
      nodes: [
        ...SNAPSHOT.nodes,
        { id: 'botoes', clientId: 'b', isTrigger: false, executor: 'botoes', configJson: {} },
      ],
      edges: [
        { origemNodeId: 'trigger', destinoNodeId: 'botoes' },
        ...SNAPSHOT.edges.filter((e) => e.origemNodeId !== 'trigger'),
      ],
    };
    const { engine, registry, publicados } = buildEngine(comBotoes);
    registry.register('botoes', async () => ({
      kind: 'suspend',
      resumeAt: new Date(Date.now() + 60_000),
      motivo: 'AGUARDANDO_CLIQUE_BOTAO',
      publicarAposEspera: {
        routingKey: 'channel.message.send',
        event: { kind: 'botoes' },
      },
    }));

    await engine.runFromTrigger(TRIGGER_EVENT);

    expect(publicados).toEqual([
      { key: 'channel.message.send', event: { kind: 'botoes' }, esperasGravadas: 1 },
    ]);
  });

  it('um fluxo com DUAS esperas seguidas reaproveita a mesma linha de espera', async () => {
    // "Mensagem com Botões" (espera o clique) e depois "Aguardar resposta" —
    // o caso que quebrava com "Unique constraint failed on (executionId)".
    const duasEsperas = {
      ...SNAPSHOT,
      nodes: [
        ...SNAPSHOT.nodes,
        { id: 'wait2', clientId: 'w2', isTrigger: false, executor: 'wait_for_reply', configJson: {} },
      ],
      edges: [
        { origemNodeId: 'trigger', destinoNodeId: 'wait' },
        { origemNodeId: 'wait', destinoNodeId: 'wait2' },
        { origemNodeId: 'wait2', destinoNodeId: 'check' },
        { origemNodeId: 'check', destinoNodeId: 'yes', handleOrigem: 'sim' },
        { origemNodeId: 'check', destinoNodeId: 'no', handleOrigem: 'nao' },
      ],
    };
    const { engine, waits, execution, ran } = buildEngine(duasEsperas);

    await engine.runFromTrigger(TRIGGER_EVENT);
    await engine.resumeWait(waits[0] as never, 'REPLY', REPLY);

    expect(waits).toHaveLength(1);
    expect(execution.status).toBe('WAITING');
    expect(waits[0].pendingQueue).toEqual(['check']);
    expect(waits[0].resolvedAt).toBeNull();

    await engine.resumeWait(waits[0] as never, 'REPLY', REPLY);

    expect(ran).toEqual(['yes']);
    expect(execution.status).toBe('FINISHED');
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

/**
 * O fluxo de lembrete, que é o caso real do "Reiniciar automação": espera a
 * resposta, e se o prazo esgota manda um lembrete e VOLTA para a espera.
 *
 *   gatilho → espera → respondeu? --sim--> fim
 *                               \--não--> lembrete → reinicia (volta p/ espera)
 */
const SNAPSHOT_REINICIO: PublishedWorkflowSnapshot = {
  workflowId: 'wf-1',
  nome: 'Lembrete',
  nodes: [
    { id: 'trigger', clientId: 't', isTrigger: true, executor: 'trigger_whatsapp_message', configJson: { connectionId: 'conn-1' } },
    { id: 'wait', clientId: 'w', isTrigger: false, executor: 'wait_for_reply', configJson: { timeoutMinutos: 5 } },
    { id: 'check', clientId: 'c', isTrigger: false, executor: 'if_contact_replied', configJson: {} },
    { id: 'fim', clientId: 'f', isTrigger: false, executor: 'record', configJson: {} },
    { id: 'lembrete', clientId: 'l', isTrigger: false, executor: 'record', configJson: {} },
    { id: 'reinicio', clientId: 'r', isTrigger: false, executor: 'restart_automation', configJson: { nodeClientId: 'w' } },
  ],
  edges: [
    { origemNodeId: 'trigger', destinoNodeId: 'wait' },
    { origemNodeId: 'wait', destinoNodeId: 'check' },
    { origemNodeId: 'check', destinoNodeId: 'fim', handleOrigem: 'sim' },
    { origemNodeId: 'check', destinoNodeId: 'lembrete', handleOrigem: 'nao' },
    { origemNodeId: 'lembrete', destinoNodeId: 'reinicio' },
  ],
};

/** Laço sem espera nenhuma no caminho: só o teto de voltas o interrompe. */
const SNAPSHOT_LACO: PublishedWorkflowSnapshot = {
  workflowId: 'wf-1',
  nome: 'Laço',
  nodes: [
    { id: 'trigger', clientId: 't', isTrigger: true, executor: 'trigger_whatsapp_message', configJson: { connectionId: 'conn-1' } },
    { id: 'msg', clientId: 'm', isTrigger: false, executor: 'record', configJson: {} },
    { id: 'reinicio', clientId: 'r', isTrigger: false, executor: 'restart_automation', configJson: { nodeClientId: 'm' } },
  ],
  edges: [
    { origemNodeId: 'trigger', destinoNodeId: 'msg' },
    { origemNodeId: 'msg', destinoNodeId: 'reinicio' },
  ],
};

describe('WorkflowEngineService — nó "Reiniciar automação"', () => {
  it('volta para a espera e a executa DE NOVO, numa volta nova', async () => {
    const { engine, waits, execution, ran, nodeRows } = buildEngine(SNAPSHOT_REINICIO);

    await engine.runFromTrigger(TRIGGER_EVENT);
    expect(execution.status).toBe('WAITING');

    // Prazo esgotado: segue por "não", manda o lembrete e reinicia.
    await engine.resumeWait(waits[0] as never, 'TIMEOUT');

    expect(ran).toEqual(['lembrete']);
    // A espera foi reaproveitada (uma por execução) e agora aponta para a
    // passagem NOVA pelo mesmo nó — é isso que prova que ele reexecutou.
    expect(waits).toHaveLength(1);
    expect(waits[0].executionNodeId).toBe('en-wait-v1');
    expect(execution.status).toBe('WAITING');

    // O histórico guarda as duas passagens, em voltas diferentes.
    const passagens = nodeRows.filter((r) => r.nodeId === 'wait');
    expect(passagens.map((r) => r.volta)).toEqual([0, 1]);

    // Agora o contato responde: segue por "sim" e encerra.
    await engine.resumeWait(waits[0] as never, 'REPLY', REPLY);

    expect(ran).toEqual(['lembrete', 'fim']);
    expect(execution.status).toBe('FINISHED');
  });

  it('registra para onde voltou e em qual volta', async () => {
    const { engine, waits, nodeRows } = buildEngine(SNAPSHOT_REINICIO);

    await engine.runFromTrigger(TRIGGER_EVENT);
    await engine.resumeWait(waits[0] as never, 'TIMEOUT');

    expect(nodeRows.find((r) => r.nodeId === 'reinicio')?.output).toEqual({
      voltaPara: 'w',
      volta: 1,
    });
  });

  it('para no teto de voltas em vez de girar para sempre', async () => {
    const { engine, execution, ran } = buildEngine(SNAPSHOT_LACO);

    await engine.runFromTrigger(TRIGGER_EVENT);

    // Uma passagem por volta, da volta 0 até o teto — e então o motor encerra.
    expect(ran).toHaveLength(MAX_VOLTAS + 1);
    expect(new Set(ran)).toEqual(new Set(['msg']));
    expect(execution.status).toBe('FINISHED');
  });

  it('voltar para o gatilho recomeça pelos sucessores dele', async () => {
    const snapshot: PublishedWorkflowSnapshot = {
      ...SNAPSHOT_LACO,
      // Mesmo laço, mas apontando para o GATILHO — "reiniciar do começo".
      nodes: SNAPSHOT_LACO.nodes.map((node) =>
        node.id === 'reinicio' ? { ...node, configJson: { nodeClientId: 't' } } : node,
      ),
    };
    const { engine, execution, ran } = buildEngine(snapshot);

    await engine.runFromTrigger(TRIGGER_EVENT);

    // O gatilho nunca é executado (nem na volta): quem roda é o `msg` depois dele.
    expect(ran).toHaveLength(MAX_VOLTAS + 1);
    expect(new Set(ran)).toEqual(new Set(['msg']));
    expect(execution.status).toBe('FINISHED');
  });

  it('falha explicitamente quando o destino não existe no snapshot', async () => {
    const snapshot: PublishedWorkflowSnapshot = {
      ...SNAPSHOT_LACO,
      nodes: SNAPSHOT_LACO.nodes.map((node) =>
        node.id === 'reinicio'
          ? { ...node, configJson: { nodeClientId: 'nao-existe' } }
          : node,
      ),
    };
    const { engine, execution, nodeRows } = buildEngine(snapshot);

    await engine.runFromTrigger(TRIGGER_EVENT);

    expect(execution.status).toBe('FAILED');
    expect(nodeRows.find((r) => r.nodeId === 'reinicio')?.status).toBe('FAILED');
  });
});
