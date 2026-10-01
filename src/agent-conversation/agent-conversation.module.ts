import { Module } from '@nestjs/common';
import { AiCreditsModule } from '../ai-credits/ai-credits.module';
import { ContatosModule } from '../contatos/contatos.module';
import { AgentConversationService } from './agent-conversation.service';

/**
 * A conversa do agente. Depois da migração para créditos, ela não decifra mais
 * chave nenhuma (`TokenCryptoService` saiu) e não fala mais com a OpenAI
 * direto: tudo passa pelo `AiUsageService`, que cobra e mede.
 */
@Module({
  imports: [ContatosModule, AiCreditsModule],
  providers: [AgentConversationService],
  exports: [AgentConversationService],
})
export class AgentConversationModule {}
