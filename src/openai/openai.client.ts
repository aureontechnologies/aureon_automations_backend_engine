import { Injectable, Logger } from '@nestjs/common';

/**
 * Endpoint da OpenAI. Configurável por `OPENAI_BASE_URL` para apontar a um
 * endpoint compatível (Azure OpenAI, gateway próprio) sem mudar código.
 */
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

export class OpenAiCallError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | undefined,
  ) {
    super(message);
  }
}

/**
 * Porta de `backend/src/_modules/agents/services/openai.client.ts` — mesmo
 * contrato de chamada, usando `fetch` nativo (Node 18+) em vez de
 * `@nestjs/axios`, pra não trazer HttpModule pra um app sem HTTP.
 */
@Injectable()
export class OpenAiClient {
  private readonly logger = new Logger(OpenAiClient.name);

  async chat(
    apiKey: string,
    model: string,
    messages: ChatMessage[],
  ): Promise<string> {
    let response: Response;
    try {
      const baseUrl = (process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, messages, max_tokens: 500 }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Falha de rede ao chamar a OpenAI: ${message}`);
      throw new OpenAiCallError(`Falha ao comunicar com a OpenAI: ${message}`, undefined);
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({}) as any);
      const message = body?.error?.message ?? `HTTP ${response.status}`;
      this.logger.error(`OpenAI respondeu ${response.status}: ${message}`);
      throw new OpenAiCallError(message, response.status);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const reply = data.choices?.[0]?.message?.content;
    if (typeof reply !== 'string') {
      throw new OpenAiCallError(
        'A OpenAI retornou uma resposta em formato inesperado.',
        response.status,
      );
    }
    return reply;
  }
}
