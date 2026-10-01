import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AiProviderError,
  I_AI_PROVIDERS,
  type AiChatMessage,
  type AiChatResult,
  type AiProvider,
} from './ai-provider.interface';
import { AI_MAX_TOKENS_RESPOSTA, AI_PROVIDER_PADRAO } from './ai.constants';

/**
 * De quem é a chave desta chamada. Espelho de `AiCredentialsResolver` do
 * backend — mesma costura para o BYOK futuro, mesmo comportamento hoje.
 */
export interface AiCredencial {
  provider: string;
  apiKey: string;
  /** Falso no BYOK: o cliente paga o provedor direto, e não há o que descontar. */
  cobraCreditos: boolean;
}

export interface AiChatInput {
  tenantId: string;
  model: string;
  messages: AiChatMessage[];
  maxTokens?: number;
}

export interface AiChatOutput extends AiChatResult {
  provider: string;
  cobraCreditos: boolean;
}

/**
 * A porta única para falar com uma IA neste serviço.
 *
 * Resolve a credencial, escolhe o provedor e devolve texto + tokens. Não mexe
 * em saldo: quem cobra é o `AiUsageService`, uma camada acima. A separação é a
 * mesma do backend, e é ela que permite trocar de fornecedor sem encostar na
 * cobrança.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly porNome: ReadonlyMap<string, AiProvider>;

  constructor(@Inject(I_AI_PROVIDERS) providers: AiProvider[]) {
    this.porNome = new Map(providers.map((p) => [p.nome, p]));
  }

  /**
   * A credencial que esta chamada usaria. Exposta separada de `chat` para que o
   * `AiUsageService` saiba, ANTES de reservar crédito, se esta chamada é
   * cobrada — no BYOK ela não é.
   *
   * `tenantId` ainda não é lido: entra na assinatura desde já para que ligar o
   * BYOK não mude nenhum chamador.
   */
  resolverCredencial(_tenantId: string): AiCredencial | null {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      this.logger.error(
        'OPENAI_API_KEY ausente neste serviço: nenhum agente consegue responder. ' +
          'Cadastre a chave da plataforma nas variáveis do backend-engine.',
      );
      return null;
    }
    return {
      provider: process.env.AI_PROVIDER?.trim() || AI_PROVIDER_PADRAO,
      apiKey,
      cobraCreditos: true,
    };
  }

  async chat(
    input: AiChatInput,
    credencial: AiCredencial,
  ): Promise<AiChatOutput> {
    const provider = this.porNome.get(credencial.provider);
    if (!provider) {
      throw new AiProviderError(
        `Provedor de IA "${credencial.provider}" não está registrado.`,
        500,
      );
    }

    const resultado = await provider.chat({
      model: input.model,
      messages: input.messages,
      maxTokens: input.maxTokens ?? AI_MAX_TOKENS_RESPOSTA,
      apiKey: credencial.apiKey,
    });

    return {
      ...resultado,
      provider: provider.nome,
      cobraCreditos: credencial.cobraCreditos,
    };
  }
}
