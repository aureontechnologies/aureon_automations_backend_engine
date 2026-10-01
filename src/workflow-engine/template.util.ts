import { NodeExecutionContext } from './types';

/**
 * Prefixos que o identificador do contato leva no banco quando não é um número
 * de telefone, para nunca colidir com um do WhatsApp. Os canais que os usavam
 * saíram do ar, mas os CONTATOS gravados por eles continuam no banco — tirar
 * esta limpeza faria `{{telefone}}` desses contatos aparecer com o prefixo
 * cru numa mensagem.
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
