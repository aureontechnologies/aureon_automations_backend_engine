import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MessagingModule } from './messaging/messaging.module';
import { PrismaModule } from './prisma/prisma.module';
import { WorkflowEngineModule } from './workflow-engine/workflow-engine.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Em producao (container) as variaveis chegam como env vars reais
      // injetadas pela plataforma — nao existe arquivo .env na imagem, e nem
      // deve existir: secret em layer de imagem vaza para quem puxar a
      // imagem. Em dev, le o .env.dev DESTE servico (nao mais um arquivo da
      // raiz de um monorepo — este repositorio e autocontido).
      ignoreEnvFile: process.env.NODE_ENV === 'production',
      envFilePath: '.env.dev',
    }),
    PrismaModule,
    MessagingModule,
    WorkflowEngineModule,
  ],
})
export class EngineModule {}
