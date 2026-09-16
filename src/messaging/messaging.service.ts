import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { Injectable, Logger } from '@nestjs/common';
import { AUREON_EXCHANGE } from './messaging.constants';

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(private readonly amqpConnection: AmqpConnection) {}

  publish(routingKey: string, payload: Record<string, unknown>): void {
    this.amqpConnection
      .publish(AUREON_EXCHANGE, routingKey, payload)
      .catch((error: unknown) => {
        this.logger.error(
          `Falha ao publicar evento "${routingKey}"`,
          error as Error,
        );
      });
  }
}
