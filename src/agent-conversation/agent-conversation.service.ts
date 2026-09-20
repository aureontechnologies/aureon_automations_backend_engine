import { Injectable, Logger } from '@nestjs/common';
import { Canal } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AgenteRepository } from '../contatos/agente.repository';
import { ContatoRepository } from '../contatos/contato.repository';
import { MensagemRepository } from '../contatos/mensagem.repository';
import { ChannelMessageSendEvent } from '../messaging/channel-message-send.event';
import { RoutingKeys } from '../messaging/messaging.constants';
import { MessagingService } from '../messaging/messaging.service';
import { OpenAiClient, OpenAiCallError } from '../openai/openai.client';
import { TokenCryptoService } from '../security/token-crypto.service';

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
  | { status: 'respondeu'; transferido: boolean }
  | { status: 'sem_chave_configurada' }
  | { status: 'falha_openai'; motivo: string };

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
    private readonly tokenCryptoService: TokenCryptoService,
    private readonly openAiClient: OpenAiClient,
    private readonly messagingService: MessagingService,
  ) {}

  async respond(input: AgentConversationInput): Promise<AgentConversationOutcome> {
    const agente = await this.agenteRepository.findByIdAndTenant(
      input.agentId,
      input.tenantId,
    );
    if (!agente?.openAiApiKeyEncrypted) {
      this.logger.warn(
        `Agente ${input.agentId} sem chave OpenAI configurada — não é possível responder.`,
      );
      return { status: 'sem_chave_configurada' };
    }

    const apiKey = this.tokenCryptoService.decrypt(agente.openAiApiKeyEncrypted);
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

    let reply: string;
    try {
      reply = await this.openAiClient.chat(apiKey, agente.openAiModel, messages);
    } catch (error) {
      const motivo = error instanceof OpenAiCallError ? error.message : String(error);
      this.logger.error(`Falha ao chamar OpenAI para o agente ${agente.id}: ${motivo}`);
      return { status: 'falha_openai', motivo };
    }

    const transferido = reply.includes(TRANSFER_MARKER);
    const textoVisivel = reply.replace(TRANSFER_MARKER, '').trim();

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

    return { status: 'respondeu', transferido };
  }

  private buildSystemPrompt(instrucoes: string, canal: Canal): string {
    const canalLabel = {
      WHATSAPP: 'WhatsApp',
      INSTAGRAM: 'Instagram Direct',
      FACEBOOK: 'Facebook Messenger',
    }[canal];

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
