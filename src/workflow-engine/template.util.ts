import { NodeExecutionContext } from './types';

/**
 * Prefixos que o identificador do contato leva no banco por canal (`ig:` no
 * Instagram, `fb:` no Messenger) para nunca colidir com um número de WhatsApp.
 * São detalhe interno: numa mensagem para o contato, `{{telefone}}` mostra o
 * número no WhatsApp e o identificador limpo nos outros canais.
 */
const CONTACT_PREFIXES = ['ig:', 'fb:'];

export function contatoIdentificador(telefone: string): string {
  const prefixo = CONTACT_PREFIXES.find((p) => telefone.startsWith(p));
  return prefixo ? telefone.slice(prefixo.length) : telefone;
}

/** Substitui `{{nome}}` e `{{telefone}}` pelos dados do contato — mesma convenção documentada no schemaJson dos nós de mensagem. */
export function renderTemplate(texto: string, context: NodeExecutionContext): string {
  return texto
    .replaceAll('{{nome}}', context.contatoNome ?? '')
    .replaceAll('{{telefone}}', contatoIdentificador(context.contatoTelefone));
}
