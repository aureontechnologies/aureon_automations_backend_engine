// `@nestjs/config` é ESM e o Jest do projeto não o carrega via `require`; aqui
// ele só aparece na cadeia de imports do nó do Agente IA.
jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));

import { NodeExecutorRegistry } from '../node-executor.registry';
import { RoutingKeys } from '../../messaging/messaging.constants';
import type { NodeExecutionContext, PublishedNode } from '../types';
import { IfContactRepliedHandler } from './if-contact-replied.handler';
import { SendButtonsMessageHandler } from './send-buttons-message.handler';
import { SendMediaMessageHandler } from './send-media-message.handler';
import { SendTextMessageHandler } from './send-text-message.handler';
import { TriggerAiAgentHandler } from './trigger-ai-agent.handler';
import { WaitForReplyHandler } from './wait-for-reply.handler';

/**
 * Um teste por NÓ do catálogo, nos três canais: o que cada um publica para o
 * dispatcher e quando ele recusa uma configuração impossível de executar.
 */

const CANAIS = ['WHATSAPP', 'INSTAGRAM', 'FACEBOOK'] as const;

/** O contato tem prefixo por canal no banco — `ig:`/`fb:`. */
const CONTATO_POR_CANAL = {
  WHATSAPP: '5511999990000',
  INSTAGRAM: 'ig:IGSID-77',
  FACEBOOK: 'fb:PSID-77',
} as const;

function contextFor(canal: (typeof CANAIS)[number]): NodeExecutionContext {
  return {
    tenantId: 't1',
    contatoId: 'contato-1',
    contatoTelefone: CONTATO_POR_CANAL[canal],
    contatoNome: 'Maria',
    canal,
    workflowId: 'wf-1',
    executionId: 'exec-1',
    executionNodeId: 'en-1',
    connectionId: 'conn-1',
  };
}

function node(configJson: Record<string, unknown>): PublishedNode {
  return { id: 'n1', clientId: 'c1', isTrigger: false, configJson };
}

function setup() {
  const published: Array<{ key: string; event: Record<string, unknown> }> = [];
  const messaging = {
    publish: jest.fn((key: string, event: Record<string, unknown>) =>
      published.push({ key, event }),
    ),
  };
  const agentConversation = {
    respond: jest.fn().mockResolvedValue({ status: 'respondeu', transferido: false }),
  };
  const registry = new NodeExecutorRegistry();
  new SendTextMessageHandler(registry, messaging as never);
  new SendButtonsMessageHandler(registry, messaging as never);
  new SendMediaMessageHandler(registry, messaging as never);
  new WaitForReplyHandler(registry);
  new IfContactRepliedHandler(registry);
  new TriggerAiAgentHandler(registry, agentConversation as never);
  return { registry, published, messaging, agentConversation };
}

describe('Nó "Mensagem" (send_text_message)', () => {
  it.each(CANAIS)('%s: publica o envio com o texto personalizado', async (canal) => {
    const { registry, published } = setup();

    const result = await registry.get('send_text_message')(
      node({ texto: 'Oi {{nome}}, falo com o {{telefone}}?' }),
      contextFor(canal),
    );

    expect(result).toEqual({
      kind: 'ok',
      output: { texto: 'Oi Maria, falo com o ' + CONTATO_POR_CANAL[canal].replace(/^(ig|fb):/, '') + '?' },
    });
    expect(published[0].key).toBe(RoutingKeys.CHANNEL_MESSAGE_SEND);
    expect(published[0].event).toMatchObject({
      eventId: 'en-1',
      canal,
      connectionId: 'conn-1',
      to: CONTATO_POR_CANAL[canal],
      kind: 'texto',
    });
  });

  it('recusa nó sem texto, em vez de enviar mensagem vazia', async () => {
    const { registry, published } = setup();
    await expect(
      registry.get('send_text_message')(node({ texto: '   ' }), contextFor('WHATSAPP')),
    ).rejects.toThrow(/sem texto/i);
    expect(published).toHaveLength(0);
  });
});

describe('Nó "Mensagem com Botões" (send_buttons_message)', () => {
  const botoes = [
    { id: 'b1', label: 'Ver preços' },
    { id: 'b2', label: 'Falar com time' },
  ];

  it.each(CANAIS)('%s: publica os botões e suspende esperando o clique', async (canal) => {
    const { registry, published } = setup();

    const result = await registry.get('send_buttons_message')(
      node({ texto: 'Olá {{nome}}', botoes }),
      contextFor(canal),
    );

    expect(result.kind).toBe('suspend');
    if (result.kind !== 'suspend') throw new Error('esperava suspend');
    expect(result.motivo).toBe('AGUARDANDO_CLIQUE_BOTAO');
    expect(result.resumeAt.getTime()).toBeGreaterThan(Date.now());
    // O envio não sai aqui: quem publica é o motor, depois de gravar a espera
    // — senão um clique instantâneo não teria espera para resolver.
    expect(published).toHaveLength(0);
    expect(result.publicarAposEspera?.routingKey).toBe(RoutingKeys.CHANNEL_MESSAGE_SEND);
    expect(result.publicarAposEspera?.event).toMatchObject({
      canal,
      kind: 'botoes',
      texto: 'Olá Maria',
      botoes,
    });
  });

  it('o clique escolhe o ramo do botão; texto solto ou timeout não seguem ramo nenhum', () => {
    const { registry } = setup();
    const resolver = registry.getBranchResolver('send_buttons_message')!;
    const botoesNode = node({ texto: 'Olá', botoes });
    const reply = (interactiveReplyId: string | null) => ({
      conteudo: 'x',
      tipo: 'BOTOES' as const,
      interactiveReplyId,
      occurredAt: new Date().toISOString(),
    });

    expect(resolver(botoesNode, reply('b2'), 'REPLY')).toBe('b2');
    expect(resolver(botoesNode, reply('desconhecido'), 'REPLY')).toBeNull();
    expect(resolver(botoesNode, reply(null), 'REPLY')).toBeNull();
    expect(resolver(botoesNode, undefined, 'TIMEOUT')).toBeNull();
  });

  it('recusa nó sem botões', async () => {
    const { registry } = setup();
    await expect(
      registry.get('send_buttons_message')(
        node({ texto: 'Olá', botoes: [] }),
        contextFor('INSTAGRAM'),
      ),
    ).rejects.toThrow(/sem nenhum botão/i);
  });
});

describe('Nó "Enviar Mídia" (send_media_message)', () => {
  it.each(CANAIS)('%s: publica o anexo com a legenda personalizada', async (canal) => {
    const { registry, published } = setup();

    const result = await registry.get('send_media_message')(
      node({ tipo: 'imagem', url: 'https://x.com/a.jpg', legenda: 'Para {{nome}}' }),
      contextFor(canal),
    );

    expect(result).toEqual({
      kind: 'ok',
      output: { tipo: 'imagem', url: 'https://x.com/a.jpg' },
    });
    expect(published[0].event).toMatchObject({
      canal,
      kind: 'midia',
      midia: { tipo: 'imagem', url: 'https://x.com/a.jpg', legenda: 'Para Maria' },
    });
  });

  it('recusa mídia sem URL ou com tipo inválido', async () => {
    const { registry } = setup();
    await expect(
      registry.get('send_media_message')(node({ tipo: 'imagem' }), contextFor('WHATSAPP')),
    ).rejects.toThrow(/sem URL/i);
    await expect(
      registry.get('send_media_message')(
        node({ tipo: 'gif', url: 'https://x.com/a.gif' }),
        contextFor('WHATSAPP'),
      ),
    ).rejects.toThrow(/tipo inválido/i);
  });
});

describe('Nó "Aguardar Resposta" (wait_for_reply)', () => {
  it('suspende pelo tempo configurado', async () => {
    const { registry } = setup();
    const result = await registry.get('wait_for_reply')(
      node({ timeoutMinutos: 5 }),
      contextFor('FACEBOOK'),
    );
    expect(result.kind).toBe('suspend');
    if (result.kind === 'suspend') {
      expect(result.motivo).toBe('AGUARDANDO_RESPOSTA');
      const minutos = (result.resumeAt.getTime() - Date.now()) / 60_000;
      expect(Math.round(minutos)).toBe(5);
    }
  });

  it('sem configuração, espera 30 minutos', async () => {
    const { registry } = setup();
    const result = await registry.get('wait_for_reply')(node({}), contextFor('WHATSAPP'));
    if (result.kind !== 'suspend') throw new Error('esperava suspend');
    expect(Math.round((result.resumeAt.getTime() - Date.now()) / 60_000)).toBe(30);
  });
});

describe('Nó "Contato respondeu?" (if_contact_replied)', () => {
  it('segue por "sim" quando a espera terminou com resposta', async () => {
    const { registry } = setup();
    const result = await registry.get('if_contact_replied')(node({}), {
      ...contextFor('INSTAGRAM'),
      waitResolution: 'REPLY',
    });
    expect(result).toEqual({ kind: 'ok', branch: 'sim', output: { respondeu: true } });
  });

  it('segue por "nao" quando o prazo esgotou', async () => {
    const { registry } = setup();
    const result = await registry.get('if_contact_replied')(node({}), {
      ...contextFor('INSTAGRAM'),
      waitResolution: 'TIMEOUT',
    });
    expect(result).toEqual({ kind: 'ok', branch: 'nao', output: { respondeu: false } });
  });
});

describe('Nó "Agente IA" (trigger_ai_agent)', () => {
  it.each(CANAIS)('%s: passa a conversa ao agente e encerra o fluxo', async (canal) => {
    const { registry, agentConversation } = setup();

    const result = await registry.get('trigger_ai_agent')(
      node({ agentId: 'agente-1' }),
      contextFor(canal),
    );

    expect(agentConversation.respond).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agente-1',
        canal,
        connectionId: 'conn-1',
        contatoTelefone: CONTATO_POR_CANAL[canal],
      }),
    );
    expect(result).toEqual({
      kind: 'finish',
      output: { agentId: 'agente-1', transferidoParaHumano: false },
    });
  });

  it('agente que pede transferência para humano fica registrado no histórico do nó', async () => {
    const { registry, agentConversation } = setup();
    agentConversation.respond.mockResolvedValue({ status: 'respondeu', transferido: true });

    const result = await registry.get('trigger_ai_agent')(
      node({ agentId: 'agente-1' }),
      contextFor('WHATSAPP'),
    );

    expect(result).toEqual({
      kind: 'finish',
      output: { agentId: 'agente-1', transferidoParaHumano: true },
    });
  });

  it('sem agentId, sem chave da OpenAI ou com a OpenAI falhando, a execução falha', async () => {
    const { registry, agentConversation } = setup();
    await expect(
      registry.get('trigger_ai_agent')(node({}), contextFor('WHATSAPP')),
    ).rejects.toThrow(/sem agentId/i);

    agentConversation.respond.mockResolvedValue({ status: 'sem_chave_configurada' });
    await expect(
      registry.get('trigger_ai_agent')(node({ agentId: 'a' }), contextFor('WHATSAPP')),
    ).rejects.toThrow(/chave da OpenAI/i);

    agentConversation.respond.mockResolvedValue({ status: 'falha_openai', motivo: 'HTTP 429' });
    await expect(
      registry.get('trigger_ai_agent')(node({ agentId: 'a' }), contextFor('WHATSAPP')),
    ).rejects.toThrow(/HTTP 429/);
  });
});
