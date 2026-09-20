/**
 * Espelha `backend/src/_modules/_features/messaging/dtos/inbound-message.dto.ts`.
 *
 * O motor recebe a mensagem do contato JÁ normalizada pelo backend — nenhum
 * formato da Meta chega até aqui. É com estes campos que os nós decidem o
 * caminho do fluxo e que o Agente IA entende o que o contato mandou.
 */

export type InboundMessageTipo =
  | 'TEXTO'
  | 'BOTAO'
  | 'IMAGEM'
  | 'VIDEO'
  | 'AUDIO'
  | 'DOCUMENTO'
  | 'STICKER'
  | 'LOCALIZACAO'
  | 'CONTATO'
  | 'REACAO'
  | 'COMPARTILHAMENTO'
  | 'STORY'
  | 'NAO_SUPORTADO';

export interface InboundAttachment {
  tipo:
    | 'IMAGEM'
    | 'VIDEO'
    | 'AUDIO'
    | 'DOCUMENTO'
    | 'STICKER'
    | 'COMPARTILHAMENTO'
    | 'OUTRO';
  /** Link do arquivo — Instagram e Messenger mandam assim. */
  url?: string;
  /** Id da mídia na Meta — WhatsApp manda assim (baixar exige o token). */
  mediaId?: string;
  mimeType?: string;
  nomeArquivo?: string;
  legenda?: string;
}

export interface InboundLocation {
  latitude: number;
  longitude: number;
  nome?: string;
  endereco?: string;
}

export interface InboundContactCard {
  nome?: string;
  telefones: string[];
}

export interface InboundReaction {
  emoji?: string;
  mensagemId?: string;
}

export interface InboundReplyContext {
  tipo: 'STORY' | 'POST' | 'MENSAGEM';
  id?: string;
  url?: string;
}
