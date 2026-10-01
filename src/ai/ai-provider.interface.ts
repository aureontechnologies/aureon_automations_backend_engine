/**
 * Porta de `backend/src/_modules/_integrations/ai/interfaces/ai-provider.interface.ts`
 * — mesmo contrato, para que os dois serviços falem com IA pela mesma forma.
 *
 * Os dois repositórios são independentes e não compartilham arquivo (ver
 * `prisma/README.md` para a mesma regra aplicada ao schema). O que os mantém
 * alinhados é este contrato ser pequeno e explícito.
 */

export type AiChatRole = 'system' | 'user' | 'assistant';

export interface AiChatMessage {
  role: AiChatRole;
  content: string;
}

/** Tokens realmente cobrados pelo provedor — a medida de onde saem os créditos. */
export interface AiTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AiChatRequest {
  model: string;
  messages: AiChatMessage[];
  maxTokens: number;
  apiKey: string;
  baseUrl?: string;
}

export interface AiChatResult {
  texto: string;
  usage: AiTokenUsage;
  model: string;
}

/**
 * Falha de uma chamada de IA, sem vocabulário HTTP.
 *
 * Substitui o `OpenAiCallError` deste serviço: mesmo papel, mas nomeado pelo
 * que é (uma falha de provedor) e não por quem é o provedor.
 */
export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | undefined,
    readonly culpaDoCliente: boolean = false,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export interface AiProvider {
  readonly nome: string;
  chat(request: AiChatRequest): Promise<AiChatResult>;
}

export const I_AI_PROVIDERS = Symbol('I_AI_PROVIDERS');
