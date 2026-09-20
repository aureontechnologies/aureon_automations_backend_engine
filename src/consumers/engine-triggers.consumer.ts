import { MessageHandlerErrorBehavior, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Injectable, Logger } from '@nestjs/common';
import { AgentConversationService } from '../agent-conversation/agent-conversation.service';
import { ContatoRepository } from '../contatos/contato.repository';
import type { AutomationTriggerEvent } from '../messaging/automation-trigger.event';
import type { ContatoRespondeuEvent } from '../messaging/contato-respondeu.event';
import { Queues } from '../messaging/messaging.constants';
import { WorkflowEngineService } from '../workflow-engine/engine.service';
import { WaitResolverService } from '../workflow-engine/wait-resolver.service';

type IncomingEvent = AutomationTriggerEvent | ContatoRespondeuEvent;

/**
 * Único consumidor da fila `ENGINE_TRIGGERS`, que recebe uma mistura de dois
 * tipos de evento (`automation.trigger` e `contato.respondeu`) — igual ao
 * `process_message` da referência (worker Python), que despacha pelo campo
 * `event` em vez de ter um handler por routing key. É obrigatório ser UM
 * consumidor só: dois `@RabbitSubscribe` na MESMA fila fariam o RabbitMQ
 * distribuir mensagens entre eles round-robin sem nenhuma garantia de que
 * cada um só veria o tipo que espera.
 */
@Injectable()
export class EngineTriggersConsumer {
  private readonly logger = new Logger(EngineTriggersConsumer.name);

  constructor(
    private readonly engine: WorkflowEngineService,
    private readonly waitResolver: WaitResolverService,
    private readonly contatoRepository: ContatoRepository,
    private readonly agentConversationService: AgentConversationService,
  ) {}

  @RabbitSubscribe({
    queue: Queues.ENGINE_TRIGGERS,
    errorBehavior: MessageHandlerErrorBehavior.NACK,
  })
  async handle(event: IncomingEvent): Promise<void> {
    if (event.event === 'automation.trigger') {
      await this.engine.runFromTrigger(event);
      return;
    }
    if (event.event === 'contato.respondeu') {
      await this.handleContatoRespondeu(event);
      return;
    }
    this.logger.warn(`Evento desconhecido recebido em ${Queues.ENGINE_TRIGGERS}: ${JSON.stringify(event)}`);
  }

  private async handleContatoRespondeu(event: ContatoRespondeuEvent): Promise<void> {
    const contato = await this.contatoRepository.findById(event.contatoId);
    const incoming = {
      conteudo: event.conteudo,
      texto: event.texto,
      tipo: event.tipo,
      interactiveReplyId: event.interactiveReplyId,
      anexos: event.anexos,
      localizacao: event.localizacao,
      contatoCompartilhado: event.contatoCompartilhado,
      reacao: event.reacao,
      respostaA: event.respostaA,
      occurredAt: event.occurredAt,
    };

    if (contato?.agenteAtivoId) {
      // Conversa sob controle de um agente — responde diretamente, sem passar pelo grafo do workflow.
      await this.agentConversationService.respond({
        tenantId: event.tenantId,
        contatoId: event.contatoId,
        contatoTelefone: contato.telefone,
        contatoNome: contato.nome,
        agentId: contato.agenteAtivoId,
        canal: event.canal,
        connectionId: event.connectionId,
      });
      return;
    }

    const wait = await this.waitResolver.claimByContato(event.contatoId);
    if (wait) {
      await this.engine.resumeWait(wait, 'REPLY', incoming);
    }
    // Sem espera pendente e sem agente ativo: esta resposta não retoma nada — só o AutomationTriggerService (no Core) decide se ela dispara um NOVO workflow.
  }
}
