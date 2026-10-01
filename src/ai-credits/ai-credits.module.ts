import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AiCreditConfig } from './ai-credit.config';
import { AiCreditWalletRepository } from './ai-credit-wallet.repository';
import { AiUsageRepository } from './ai-usage.repository';
import { AiUsageService } from './ai-usage.service';

/**
 * O controle de créditos deste serviço.
 *
 * Só a parte de CONSUMO: o motor gasta crédito, nunca concede nem vende. Quem
 * credita é o backend, ao confirmar um pagamento — e é bom que este serviço não
 * tenha esse poder, já que ele não tem porta HTTP nem recebe webhook nenhum.
 */
@Module({
  imports: [AiModule],
  providers: [
    AiCreditConfig,
    AiCreditWalletRepository,
    AiUsageRepository,
    AiUsageService,
  ],
  exports: [AiUsageService],
})
export class AiCreditsModule {}
