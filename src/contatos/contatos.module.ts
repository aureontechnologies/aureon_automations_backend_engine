import { Module } from '@nestjs/common';
import { AgenteRepository } from './agente.repository';
import { ContatoRepository } from './contato.repository';
import { MensagemRepository } from './mensagem.repository';

@Module({
  providers: [ContatoRepository, MensagemRepository, AgenteRepository],
  exports: [ContatoRepository, MensagemRepository, AgenteRepository],
})
export class ContatosModule {}
