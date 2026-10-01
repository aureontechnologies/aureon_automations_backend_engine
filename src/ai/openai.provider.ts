import { Injectable, Logger } from '@nestjs/common';
import {
  AiProviderError,
  type AiChatRequest,
  type AiChatResult,
  type AiProvider,
} from './ai-provider.interface';

/**
 * Endpoint da OpenAI. Configurável por `OPENAI_BASE_URL` para apontar a um
 * endpoint compatível (Azure OpenAI, gateway próprio) sem mudar código.
 */
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

interface ChatCompletionResponse {
  model?: string;
  choices?: { message?: { content?: string } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * Porta de `backend/.../providers/openai.provider.ts` — mesmo contrato, usando
 * `fetch` nativo (Node 18+) em vez de `@nestjs/axios`, pra não trazer
 * HttpModule pra um app sem HTTP.
 *
 * Diferença em relação ao `OpenAiClient` que este arquivo substitui: ele
 * DEVOLVE o uso de tokens. Sem isso não há como cobrar pelo consumo real, e a
 * plataforma cobraria pela estimativa.
 */
@Injectable()
export class OpenAiProvider implements AiProvider {
  readonly nome = 'openai';

  private readonly logger = new Logger(OpenAiProvider.name);

  async chat(request: AiChatRequest): Promise<AiChatResult> {
    const baseUrl = (
      request.baseUrl ||
      process.env.OPENAI_BASE_URL ||
      DEFAULT_BASE_URL
    ).replace(/\/$/, '');

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${request.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          max_tokens: request.maxTokens,
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Falha de rede ao chamar a OpenAI: ${message}`);
      throw new AiProviderError(
        `Falha ao comunicar com a OpenAI: ${message}`,
        undefined,
      );
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({}) as any);
      const message = body?.error?.message ?? `HTTP ${response.status}`;
      if (response.status === 401 || response.status === 403) {
        // Agora a chave é da PLATAFORMA: uma recusa aqui não é problema de um
        // cliente, é a IA fora do ar para todos.
        this.logger.error(
          `OPENAI_API_KEY da plataforma recusada (${response.status}): ${message}. ` +
            'Nenhum agente consegue responder enquanto isto não for corrigido.',
        );
      } else {
        this.logger.error(`OpenAI respondeu ${response.status}: ${message}`);
      }
      throw new AiProviderError(
        message,
        response.status,
        [400, 404, 422].includes(response.status),
      );
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const texto = data.choices?.[0]?.message?.content;
    if (typeof texto !== 'string') {
      throw new AiProviderError(
        'A OpenAI retornou uma resposta em formato inesperado.',
        response.status,
      );
    }

    return {
      texto,
      model: data.model ?? request.model,
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
    };
  }
}
