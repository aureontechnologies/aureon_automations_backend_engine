import { NodeExecutorRegistry } from '../node-executor.registry';
import { RoutingKeys } from '../../messaging/messaging.constants';
import type { NodeExecutionContext, PublishedNode } from '../types';
import {
  SEND_TEMPLATE_MESSAGE_EXECUTOR,
  SendTemplateMessageHandler,
} from './send-template-message.handler';

const context: NodeExecutionContext = {
  tenantId: 't1',
  contatoId: 'contato-1',
  contatoTelefone: '5511999990000',
  contatoNome: 'Maria',
  canal: 'WHATSAPP',
  workflowId: 'wf-1',
  executionId: 'exec-1',
  executionNodeId: 'en-1',
  connectionId: 'conn-1',
};

function node(configJson: Record<string, unknown>): PublishedNode {
  return { id: 'n1', clientId: 'c1', isTrigger: false, configJson };
}

describe('SendTemplateMessageHandler', () => {
  function setup() {
    const messaging = { publish: jest.fn() };
    const registry = new NodeExecutorRegistry();
    new SendTemplateMessageHandler(registry, messaging as never);
    return { messaging, handler: registry.get(SEND_TEMPLATE_MESSAGE_EXECUTOR) };
  }

  it('publica o pedido de envio do modelo com o mapeamento do nó e o id do nó como chave de idempotência', async () => {
    const { messaging, handler } = setup();
    const config = {
      templateId: 'tpl-1',
      variaveis: [{ fonte: 'CAMPO', campo: 'nome' }],
    };

    const result = await handler(node(config), context);

    expect(result).toEqual({ kind: 'ok', output: { templateId: 'tpl-1' } });
    expect(messaging.publish).toHaveBeenCalledWith(
      RoutingKeys.CHANNEL_MESSAGE_SEND,
      expect.objectContaining({
        eventId: 'en-1',
        kind: 'template',
        template: config,
        connectionId: 'conn-1',
        to: '5511999990000',
      }),
    );
  });

  it('recusa nó sem modelo escolhido, sem publicar nada', async () => {
    const { messaging, handler } = setup();
    await expect(handler(node({}), context)).rejects.toThrow('sem modelo');
    expect(messaging.publish).not.toHaveBeenCalled();
  });
});
