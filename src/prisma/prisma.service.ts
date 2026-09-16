import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Mesmo banco do servico backend, que e o dono do schema e o UNICO que roda
 * migrations. Este servico so le/escreve nas tabelas ja migradas por ele.
 *
 * O Prisma Client aqui e gerado a partir de `prisma/schema.prisma` deste
 * repositorio, que e uma copia byte a byte do schema do backend — os dois
 * servicos sao independentes e nao compartilham arquivo. Ver prisma/README.md
 * para a regra de sincronizacao e `npm run schema:check` para detectar
 * divergencia.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
