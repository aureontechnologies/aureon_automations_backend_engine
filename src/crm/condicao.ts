import type { CondicaoConfig, RegraCondicao } from './acoes.constants';

/** O que uma condição consegue olhar do contato no momento em que o fluxo passa por ela. */
export interface ContextoCondicao {
  etiquetaIds: Set<string>;
  campos: Record<string, string | number | null>;
  /** Texto da mensagem que abriu esta rodada do fluxo. */
  mensagem: string | null;
  agora: Date;
  /** Fuso para as regras de horário. */
  timeZone?: string;
}

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Hora e dia da semana no fuso do negócio (padrão: Brasília). */
function relogio(agora: Date, timeZone = 'America/Sao_Paulo'): { minutos: number; dia: number } {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(agora);
  const get = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
  const dias = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    minutos: Number(get('hour')) * 60 + Number(get('minute')),
    dia: dias.indexOf(get('weekday')),
  };
}

function hhmm(valor: string): number {
  const [h, m] = valor.split(':').map(Number);
  return h * 60 + m;
}

export function avaliarRegra(regra: RegraCondicao, ctx: ContextoCondicao): boolean {
  switch (regra.tipo) {
    case 'TEM_ETIQUETA':
      return ctx.etiquetaIds.has(regra.etiquetaId);
    case 'NAO_TEM_ETIQUETA':
      return !ctx.etiquetaIds.has(regra.etiquetaId);
    case 'CAMPO': {
      const bruto = ctx.campos[regra.campo];
      const atual = bruto === null || bruto === undefined ? '' : String(bruto);
      const esperado = regra.valor ?? '';
      switch (regra.operador) {
        case 'PREENCHIDO':
          return atual.trim().length > 0;
        case 'VAZIO':
          return atual.trim().length === 0;
        case 'IGUAL':
          return normalizar(atual) === normalizar(esperado);
        case 'DIFERENTE':
          return normalizar(atual) !== normalizar(esperado);
        case 'CONTEM':
          return normalizar(atual).includes(normalizar(esperado));
        case 'MAIOR':
          return Number(atual) > Number(esperado);
        case 'MENOR':
          return Number(atual) < Number(esperado);
      }
      return false;
    }
    case 'MENSAGEM': {
      const texto = normalizar(ctx.mensagem ?? '');
      const valor = normalizar(regra.valor);
      if (regra.operador === 'IGUAL') return texto === valor;
      if (regra.operador === 'COMECA_COM') return texto.startsWith(valor);
      return texto.includes(valor);
    }
    case 'HORARIO': {
      const { minutos, dia } = relogio(ctx.agora, ctx.timeZone);
      if (regra.dias.length > 0 && !regra.dias.includes(dia)) return false;
      const inicio = hhmm(regra.inicio);
      const fim = hhmm(regra.fim);
      // Janela que atravessa a meia-noite (22:00 → 06:00).
      return inicio <= fim
        ? minutos >= inicio && minutos < fim
        : minutos >= inicio || minutos < fim;
    }
  }
}

/** Condição sem regra nenhuma segue por "não" — a ativação já recusa esse caso. */
export function avaliarCondicao(config: CondicaoConfig, ctx: ContextoCondicao): boolean {
  const regras = Array.isArray(config.regras) ? config.regras : [];
  if (regras.length === 0) return false;
  return config.combinacao === 'QUALQUER'
    ? regras.some((regra) => avaliarRegra(regra, ctx))
    : regras.every((regra) => avaliarRegra(regra, ctx));
}
