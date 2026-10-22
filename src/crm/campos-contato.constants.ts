// CÓPIA de backend/src/common/constants/campos-contato.constants.ts — manter idêntica (ver prisma/README.md, mesma regra do schema).
/**
 * Campos do contato que a ação "Definir ou alterar valor de campo" das
 * automações pode escrever. Fonte única para a validação da ativação, o
 * handler do motor (cópia em `backend-engine`) e o seletor do canvas na web.
 *
 * `telefone` fica de fora de propósito: é a identidade do contato no WhatsApp,
 * e trocá-lo por automação faria as próximas mensagens irem para outra pessoa.
 */
export const CAMPOS_CONTATO = {
  nome: { label: 'Nome', tipo: 'texto' },
  email: { label: 'E-mail', tipo: 'texto' },
  valor: { label: 'Valor (R$)', tipo: 'numero' },
  rating: { label: 'Avaliação (0 a 5)', tipo: 'numero' },
  observacoes: { label: 'Observações', tipo: 'texto' },
} as const;

export type CampoContato = keyof typeof CAMPOS_CONTATO;

export function isCampoContato(value: unknown): value is CampoContato {
  return typeof value === 'string' && value in CAMPOS_CONTATO;
}

/**
 * Telefone como o WhatsApp identifica o contato: só dígitos, com DDI. Um número
 * brasileiro digitado sem DDI (10 ou 11 dígitos) ganha o 55 — é o caso comum
 * de quem cadastra à mão "(11) 99999-0000".
 */
export function normalizarTelefone(raw: string): string {
  const digitos = raw.replace(/\D/g, '');
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  return digitos;
}
