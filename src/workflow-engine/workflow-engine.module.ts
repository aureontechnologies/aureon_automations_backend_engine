import { Module } from '@nestjs/common';
import { AgentConversationModule } from '../agent-conversation/agent-conversation.module';
import { EngineTriggersConsumer } from '../consumers/engine-triggers.consumer';
import { ContatosModule } from '../contatos/contatos.module';
import { SendButtonsMessageHandler } from './handlers/send-buttons-message.handler';
import { SendMediaMessageHandler } from './handlers/send-media-message.handler';
import { SendTextMessageHandler } from './handlers/send-text-message.handler';
import { TriggerAiAgentHandler } from './handlers/trigger-ai-agent.handler';
import { WaitForReplyHandler } from './handlers/wait-for-reply.handler';
import { WorkflowEngineService } from './engine.service';
import { NodeExecutorRegistry } from './node-executor.registry';
import { WaitResolverService } from './wait-resolver.service';
import { WaitTimeoutPollerService } from './wait-timeout-poller.service';

/**
 * Cada handler se registra no `NodeExecutorRegistry` no PRÓPRIO construtor —
 * por isso todos precisam estar listados aqui em `providers`, mesmo que
 * nenhum outro serviço os injete diretamente: é a instanciação pelo
 * container do Nest que dispara o registro (mesmo efeito colateral do
 * "importar por causa do side-effect" da referência Python, só que via DI
 * em vez de import). Esquecer um handler aqui = executor sem handler
 * registrado silenciosamente até rodar (fica como erro só em runtime,
 * mensagem clara "Nenhum handler registrado para executor ...").
 */
@Module({
  imports: [ContatosModule, AgentConversationModule],
  providers: [
    NodeExecutorRegistry,
    WorkflowEngineService,
    WaitResolverService,
    WaitTimeoutPollerService,
    EngineTriggersConsumer,
    SendTextMessageHandler,
    SendButtonsMessageHandler,
    SendMediaMessageHandler,
    WaitForReplyHandler,
    TriggerAiAgentHandler,
  ],
  exports: [WorkflowEngineService, WaitResolverService],
})
export class WorkflowEngineModule {}
