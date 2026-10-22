// CÓPIA de backend/src/common/constants/acoes.constants.ts — manter idêntica (ver prisma/README.md, mesma regra do schema).
/**
 * Contrato de `configJson` dos nós novos do canvas — "Ações", "Condição" e
 * "Atraso inteligente". Espelhado (cópia) em `backend-engine`, que executa,
 * e em `aureon_automations_web`, que edita. Mudar um formato aqui é mudar
 * nos três.
 */

// --- Ações -------------------------------------------------------------------

export const TIPOS_ACAO = [
  'ADICIONAR_ETIQUETA',
  'REMOVER_ETIQUETA',
  'KANBAN_CARTAO',
  'AGENDAMENTO',
  'ENQUADRAR_FLUXO',
  'DEFINIR_CAMPO',
  'NOTIFICAR_MEMBRO',
  'ATRIBUIR_ATENDIMENTO',
  'REMOVER_ATRIBUICAO',
] as const;

export type TipoAcao = (typeof TIPOS_ACAO)[number];

export type AcaoConfig =
  | {
      id: string;
      tipo: 'ADICIONAR_ETIQUETA' | 'REMOVER_ETIQUETA';
      etiquetaIds: string[];
    }
  | {
      id: string;
      tipo: 'KANBAN_CARTAO';
      quadroId: string;
      colunaId: string;
      /** Aceita `{{nome}}` e `{{telefone}}`. Vazio = nome do contato. */
      titulo?: string;
      descricao?: string;
      membroIds?: string[];
    }
  | {
      id: string;
      tipo: 'AGENDAMENTO';
      titulo: string;
      descricao?: string;
      /** Começa N minutos depois de a automação passar por aqui. */
      minutosAPartir: number;
      duracaoMinutos: number;
      usuarioId?: string;
      lembreteMinutos?: number | null;
    }
  | { id: string; tipo: 'ENQUADRAR_FLUXO'; workflowId: string }
  | { id: string; tipo: 'DEFINIR_CAMPO'; campo: string; valor: string }
  | {
      id: string;
      tipo: 'NOTIFICAR_MEMBRO';
      usuarioIds: string[];
      mensagem?: string;
    }
  | { id: string; tipo: 'ATRIBUIR_ATENDIMENTO'; usuarioId: string }
  | { id: string; tipo: 'REMOVER_ATRIBUICAO' };

// --- Condição ----------------------------------------------------------------

export const CONDICAO_BRANCH = { sim: 'sim', nao: 'nao' } as const;

export type RegraCondicao =
  | {
      id: string;
      tipo: 'TEM_ETIQUETA' | 'NAO_TEM_ETIQUETA';
      etiquetaId: string;
    }
  | {
      id: string;
      tipo: 'CAMPO';
      campo: string;
      operador:
        | 'IGUAL'
        | 'DIFERENTE'
        | 'CONTEM'
        | 'PREENCHIDO'
        | 'VAZIO'
        | 'MAIOR'
        | 'MENOR';
      valor?: string;
    }
  | {
      id: string;
      tipo: 'MENSAGEM';
      operador: 'IGUAL' | 'CONTEM' | 'COMECA_COM';
      valor: string;
    }
  | {
      id: string;
      tipo: 'HORARIO';
      /** "08:00" */
      inicio: string;
      fim: string;
      /** 0 = domingo … 6 = sábado. */
      dias: number[];
    };

export interface CondicaoConfig {
  combinacao: 'TODAS' | 'QUALQUER';
  regras: RegraCondicao[];
}

// --- Atraso inteligente ------------------------------------------------------

export const UNIDADES_ATRASO = {
  SEGUNDOS: 1,
  MINUTOS: 60,
  HORAS: 3600,
  DIAS: 86_400,
} as const;

export type UnidadeAtraso = keyof typeof UNIDADES_ATRASO;

/** 30 dias — o mesmo teto do "Aguardar resposta". */
export const ATRASO_MAX_SEGUNDOS = 30 * 86_400;

export function atrasoEmSegundos(config: Record<string, unknown>): number {
  const quantidade = Number(config.quantidade);
  const unidade = config.unidade as UnidadeAtraso;
  const fator = UNIDADES_ATRASO[unidade];
  if (!Number.isFinite(quantidade) || !fator) return NaN;
  return quantidade * fator;
}
