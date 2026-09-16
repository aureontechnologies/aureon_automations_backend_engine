import { Injectable } from '@nestjs/common';
import { Agente } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AgenteRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByIdAndTenant(id: string, tenantId: string): Promise<Agente | null> {
    return this.prisma.agente.findFirst({ where: { id, tenantId } });
  }
}
