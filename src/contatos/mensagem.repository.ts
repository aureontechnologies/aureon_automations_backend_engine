import { Injectable } from '@nestjs/common';
import { Canal, Mensagem, MensagemDirecao, MensagemTipo } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface RegistrarMensagemInput {
  tenantId: string;
  contatoId: string;
  canal: Canal;
  direcao: MensagemDirecao;
  tipo?: MensagemTipo;
  conteudo?: string | null;
}

@Injectable()
export class MensagemRepository {
  constructor(private readonly prisma: PrismaService) {}

  registrar(input: RegistrarMensagemInput): Promise<Mensagem> {
    return this.prisma.mensagem.create({
      data: {
        tenantId: input.tenantId,
        contatoId: input.contatoId,
        canal: input.canal,
        direcao: input.direcao,
        tipo: input.tipo ?? 'TEXTO',
        conteudo: input.conteudo ?? null,
      },
    });
  }

  listarHistoricoRecente(contatoId: string, limite: number): Promise<Mensagem[]> {
    return this.prisma.mensagem
      .findMany({
        where: { contatoId },
        orderBy: { criadoEm: 'desc' },
        take: limite,
      })
      .then((mensagens) => mensagens.reverse());
  }
}
