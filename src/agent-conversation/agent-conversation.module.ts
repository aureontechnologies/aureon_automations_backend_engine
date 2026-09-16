import { Module } from '@nestjs/common';
import { ContatosModule } from '../contatos/contatos.module';
import { OpenAiClient } from '../openai/openai.client';
import { TokenCryptoService } from '../security/token-crypto.service';
import { AgentConversationService } from './agent-conversation.service';

@Module({
  imports: [ContatosModule],
  providers: [AgentConversationService, OpenAiClient, TokenCryptoService],
  exports: [AgentConversationService],
})
export class AgentConversationModule {}
