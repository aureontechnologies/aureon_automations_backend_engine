import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { EngineModule } from './engine.module';

/**
 * Sem HTTP — este processo só consome RabbitMQ e mantém o poller de timeout
 * de esperas rodando. `createApplicationContext` inicializa o container de
 * DI (e, com ele, os consumers registrados via `@RabbitSubscribe`) sem abrir
 * porta nenhuma, igual ao worker Python de referência não ter interface
 * HTTP.
 */
async function bootstrap() {
  const logger = new Logger('EngineBootstrap');
  const app = await NestFactory.createApplicationContext(EngineModule);
  app.enableShutdownHooks();

  logger.log('Motor de execução de workflows iniciado — aguardando eventos do RabbitMQ.');

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      logger.log(`${signal} recebido — encerrando graciosamente.`);
      void app.close().then(() => process.exit(0));
    });
  }
}
bootstrap();
