import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { WAIT_TIMEOUT_POLL_INTERVAL_MS } from '../messaging/messaging.constants';
import { WorkflowEngineService } from './engine.service';
import { WaitResolverService } from './wait-resolver.service';

/**
 * Roda em paralelo ao consumo do RabbitMQ (mesmo espírito da thread de
 * poller da referência) — garante progresso em execuções suspensas mesmo
 * sem nenhuma mensagem nova chegando, resolvendo esperas cujo `resumeAt` já
 * passou.
 */
@Injectable()
export class WaitTimeoutPollerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WaitTimeoutPollerService.name);
  private interval?: ReturnType<typeof setInterval>;
  private polling = false;

  constructor(
    private readonly waitResolver: WaitResolverService,
    private readonly engine: WorkflowEngineService,
  ) {}

  onApplicationBootstrap(): void {
    this.interval = setInterval(() => {
      void this.pollOnce();
    }, WAIT_TIMEOUT_POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.interval) clearInterval(this.interval);
  }

  private async pollOnce(): Promise<void> {
    if (this.polling) return; // evita sobrepor execuções se um ciclo demorar mais que o intervalo
    this.polling = true;
    try {
      const dueWaits = await this.waitResolver.claimDue();
      for (const wait of dueWaits) {
        await this.engine.resumeWait(wait, 'TIMEOUT').catch((error: unknown) => {
          this.logger.error(`Falha ao resolver espera vencida ${wait.id}`, error as Error);
        });
      }
    } catch (error) {
      this.logger.error('Falha no ciclo do poller de timeout.', error as Error);
    } finally {
      this.polling = false;
    }
  }
}
