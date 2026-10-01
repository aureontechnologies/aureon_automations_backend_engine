import { Module } from '@nestjs/common';
import { I_AI_PROVIDERS } from './ai-provider.interface';
import { AiService } from './ai.service';
import { OpenAiProvider } from './openai.provider';

/**
 * A camada de FORNECEDOR de IA deste serviço — abaixo da de créditos, e sem
 * saber que ela existe.
 *
 * Somar Anthropic, Gemini ou Azure OpenAI é escrever a classe e listá-la no
 * `useFactory`. Nenhum handler de workflow muda por isso.
 */
@Module({
  providers: [
    OpenAiProvider,
    {
      provide: I_AI_PROVIDERS,
      useFactory: (openai: OpenAiProvider) => [openai],
      inject: [OpenAiProvider],
    },
    AiService,
  ],
  exports: [AiService],
})
export class AiModule {}
