import { Injectable } from '@nestjs/common';
import { Contato } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ContatoRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<Contato | null> {
    return this.prisma.contato.findUnique({ where: { id } });
  }

  setAgenteAtivo(id: string, agenteId: string | null): Promise<Contato> {
    return this.prisma.contato.update({
      where: { id },
      data: {
        agenteAtivoId: agenteId,
        agenteAtivoDesde: agenteId ? new Date() : null,
      },
    });
  }
}
