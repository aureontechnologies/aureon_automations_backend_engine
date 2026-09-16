import { NodeExecutionContext } from './types';

/** Substitui `{{nome}}` e `{{telefone}}` pelos dados do contato — mesma convenção documentada no schemaJson dos nós de mensagem. */
export function renderTemplate(texto: string, context: NodeExecutionContext): string {
  return texto
    .replaceAll('{{nome}}', context.contatoNome ?? '')
    .replaceAll('{{telefone}}', context.contatoTelefone);
}
