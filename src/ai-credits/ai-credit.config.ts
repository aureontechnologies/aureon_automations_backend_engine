import { Injectable, Logger } from '@nestjs/common';
import { AI_CARACTERES_POR_TOKEN } from '../ai/ai.constants';

/**
 * Espelho de `backend/src/_modules/_features/ai-credits/services/ai-credit-config.service.ts`
 * e de `ai-credit.constants.ts`.
 *
 * Os valores TÊM que bater entre os dois serviços: eles descontam da MESMA
 * carteira, e uma conversão diferente em cada um faria a mesma conversa custar
 * valores diferentes dependendo de quem a atendeu. Por isso os dois leem as
 * mesmas variáveis de ambiente (`AI_CREDIT_TOKEN_RATIO`,
 * `AI_CREDIT_RESERVA_MINIMA`) e carregam os mesmos padrões.
 */

export const AI_CREDIT_TOKEN_RATIO_PADRAO = 1;
export const AI_CREDIT_RESERVA_MINIMA_PADRAO = 200;

@Injectable()
export class AiCreditConfig {
  private readonly logger = new Logger(AiCreditConfig.name);

  get tokenRatio(): number {
    return this.numeroPositivo(
      'AI_CREDIT_TOKEN_RATIO',
      AI_CREDIT_TOKEN_RATIO_PADRAO,
    );
  }

  get reservaMinima(): number {
    return Math.ceil(
      this.numeroPositivo(
        'AI_CREDIT_RESERVA_MINIMA',
        AI_CREDIT_RESERVA_MINIMA_PADRAO,
      ),
    );
  }

  /** Arredonda para CIMA: consumo que custa zero crédito seria uso gratuito ilimitado. */
  creditosPorTokens(tokens: number): number {
    if (tokens <= 0) return 0;
    return Math.max(1, Math.ceil(tokens * this.tokenRatio));
  }

  /**
   * Quanto reservar antes da chamada. Erra para cima de propósito — o excedente
   * volta na liquidação, e errar para baixo deixaria o saldo negativo em
   * concorrência.
   */
  estimarCreditos(caracteresDoPrompt: number, maxTokensResposta: number): number {
    const tokensEstimados =
      Math.ceil(caracteresDoPrompt / AI_CARACTERES_POR_TOKEN) +
      maxTokensResposta;
    return Math.max(
      this.reservaMinima,
      this.creditosPorTokens(tokensEstimados),
    );
  }

  private numeroPositivo(chave: string, padrao: number): number {
    const bruto = process.env[chave]?.trim();
    if (!bruto) return padrao;

    const valor = Number(bruto);
    if (!Number.isFinite(valor) || valor <= 0) {
      this.logger.warn(
        `${chave}="${bruto}" não é um número positivo — usando o padrão ${padrao}.`,
      );
      return padrao;
    }
    return valor;
  }
}
