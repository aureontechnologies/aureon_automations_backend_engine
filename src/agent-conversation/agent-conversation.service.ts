import { Injectable, Logger } from '@nestjs/common';
import { Canal } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AgenteRepository } from '../contatos/agente.repository';
import { ContatoRepository } from '../contatos/contato.repository';
import { MensagemRepository } from '../contatos/mensagem.repository';
import { ChannelMessageSendEvent } from '../messaging/channel-message-send.event';
import { RoutingKeys } from '../messaging/messaging.constants';
import { MessagingService } from '../messaging/messaging.service';
import { AI_MODELO_PADRAO } from '../ai/ai.constants';
import { AiUsageService } from '../ai-credits/ai-usage.service';

const TRANSFER_MARKER = '[TRANSFERIR_HUMANO]';
const HISTORY_LIMIT = 20;

export interface AgentConversationInput {
  tenantId: string;
  contatoId: string;
  contatoTelefone: string;
  contatoNome: string | null;
  agentId: string;
  canal: Canal;
  connectionId: string;
}

export type AgentConversationOutcome =
  | { status: 'respondeu'; transferido: boolean; creditosConsumidos: number }
  /**
   * O tenant está sem créditos de IA. NÃO é falha de configuração nem erro de
   * infraestrutura: é cobrança. Separado dos outros para que o handler possa
   * dar ao cliente a mensagem certa ("compre créditos") em vez de um erro
   * técnico que não diz o que fazer.
   */
  | { status: 'sem_creditos'; saldo: number; necessario: number }
  /** A plataforma está sem chave de IA configurada — problema nosso. */
  | { status: 'sem_provedor' }
  | { status: 'falha_provedor'; motivo: string };

/**
 * Lógica compartilhada entre a primeira ativação do agente (nó "Agente IA"
 * dentro de um workflow) e a continuação de uma conversa já assumida por ele
 * (mensagens seguintes do mesmo contato, roteadas fora do grafo) — ambos os
 * casos são "o agente responde a última mensagem do contato", só muda quem
 * chama.
 */
@Injectable()
export class AgentConversationService {
  private readonly logger = new Logger(AgentConversationService.name);

  constructor(
    private readonly agenteRepository: AgenteRepository,
    private readonly contatoRepository: ContatoRepository,
    private readonly mensagemRepository: MensagemRepository,
    private readonly aiUsageService: AiUsageService,
    private readonly messagingService: MessagingService,
  ) {}

  async respond(input: AgentConversationInput): Promise<AgentConversationOutcome> {
    const agente = await this.agenteRepository.findByIdAndTenant(
      input.agentId,
      input.tenantId,
    );
    if (!agente) {
      // O agente foi apagado entre a publicação do workflow e a execução.
      this.logger.warn(`Agente ${input.agentId} não encontrado no tenant ${input.tenantId}.`);
      return {
        status: 'falha_provedor',
        motivo: `Agente ${input.agentId} não existe mais.`,
      };
    }

    const historico = await this.mensagemRepository.listarHistoricoRecente(
      input.contatoId,
      HISTORY_LIMIT,
    );

    const systemPrompt = this.buildSystemPrompt(agente.instrucoes, input.canal);
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...historico
        .filter((m) => m.conteudo)
        .map((m) => ({
          role: (m.direcao === 'ENTRADA' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: m.conteudo!,
        })),
    ];

    // Toda a cobrança acontece aqui dentro: verifica saldo, reserva, chama a
    // IA, liquida pelo consumo real e estorna se falhar. Este serviço não
    // conhece a OpenAI nem a carteira — só pede uma resposta e recebe um
    // estado.
    const execucao = await this.aiUsageService.executar({
      tenantId: input.tenantId,
      feature: 'agente_conversa',
      model: agente.openAiModel || AI_MODELO_PADRAO,
      messages,
      agenteId: agente.id,
      contatoId: input.contatoId,
      metadata: { canal: input.canal, agenteNome: agente.nome },
    });

    if (execucao.status !== 'ok') {
      if (execucao.status === 'sem_creditos') {
        this.logger.warn(
          `Tenant ${input.tenantId} sem créditos de IA: agente ${agente.id} não respondeu ao ` +
            `contato ${input.contatoId} (saldo ${execucao.saldo}, necessário ${execucao.necessario}).`,
        );
      }
      return execucao;
    }

    const transferido = execucao.texto.includes(TRANSFER_MARKER);
    const textoVisivel = execucao.texto.replace(TRANSFER_MARKER, '').trim();

    const event: ChannelMessageSendEvent = {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      contatoId: input.contatoId,
      canal: input.canal,
      connectionId: input.connectionId,
      to: input.contatoTelefone,
      kind: 'texto',
      texto: textoVisivel,
      correlationId: `agente:${agente.id}`,
    };
    this.messagingService.publish(RoutingKeys.CHANNEL_MESSAGE_SEND, event as unknown as Record<string, unknown>);

    await this.contatoRepository.setAgenteAtivo(
      input.contatoId,
      transferido ? null : agente.id,
    );

    return {
      status: 'respondeu',
      transferido,
      creditosConsumidos: execucao.creditosConsumidos,
    };
  }

  private buildSystemPrompt(instrucoes: string, canal: Canal): string {
    // Só o WhatsApp Business está no ar. O enum do banco ainda tem os canais
    // retirados, e uma automação antiga deles pode chegar aqui: o rótulo cai
    // no nome do canal em vez de virar `undefined` na frase do prompt.
    const canalLabel: string =
      { WHATSAPP: 'WhatsApp' }[canal as 'WHATSAPP'] ?? canal;

    // O histórico é texto: o que o contato manda sem ser texto chega descrito
    // entre colchetes (ver `inbound-message.util.ts` no backend). Dizer isso
    // ao agente evita que ele finja ter visto a foto — e o ensina a pedir o
    // que falta.
    return [
      instrucoes,
      '',
      `Você está atendendo pelo ${canalLabel}.`,
      'No histórico, o que o contato mandou sem ser texto aparece descrito entre colchetes: [imagem], [vídeo], [áudio], [documento], [figurinha], [localização], [contato], [reação], [botão], [publicação compartilhada] e [resposta a story]. Você NÃO enxerga o conteúdo desses arquivos — use a descrição e, se precisar do conteúdo, peça ao contato que descreva ou escreva.',
      `Se em algum momento você decidir que a conversa precisa ser transferida para um atendente humano, inclua exatamente o texto "${TRANSFER_MARKER}" no final da sua resposta.`,
    ].join('\n');
  }
}
