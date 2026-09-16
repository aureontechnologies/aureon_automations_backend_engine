import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AUREON_EXCHANGE, Queues, RoutingKeys } from './messaging.constants';
import { MessagingService } from './messaging.service';

/**
 * Declara a MESMA exchange (`aureon.events`, topic) que o backend principal,
 * e a fila `ENGINE_TRIGGERS` com seus binds — independente de qual dos dois
 * apps sobe primeiro (declaração de exchange/fila é idempotente no
 * RabbitMQ). O motor não declara as filas de envio/retry/DLQ — essas são
 * consumidas só pelo backend principal (`ChannelDispatchModule`).
 */
@Global()
@Module({
  imports: [
    RabbitMQModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        exchanges: [{ name: AUREON_EXCHANGE, type: 'topic' }],
        queues: [
          {
            name: Queues.ENGINE_TRIGGERS,
            exchange: AUREON_EXCHANGE,
            routingKey: [RoutingKeys.AUTOMATION_TRIGGER, RoutingKeys.CONTATO_RESPONDEU],
            createQueueIfNotExists: true,
            options: { durable: true },
          },
        ],
        uri: config.getOrThrow<string>('RABBITMQ_URL'),
        connectionInitOptions: { wait: false },
      }),
    }),
  ],
  providers: [MessagingService],
  exports: [MessagingService],
})
export class MessagingModule {}
