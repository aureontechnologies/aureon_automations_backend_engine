import { avaliarCondicao, type ContextoCondicao } from './condicao';

function ctx(partial: Partial<ContextoCondicao> = {}): ContextoCondicao {
  return {
    etiquetaIds: new Set(['vip']),
    campos: { nome: 'Ana', email: null, valor: 150 },
    mensagem: 'Quero falar com o Financeiro',
    // Quarta-feira, 10:00 em Brasília.
    agora: new Date('2026-10-21T13:00:00Z'),
    ...partial,
  };
}

describe('avaliarCondicao', () => {
  it('etiqueta presente / ausente', () => {
    expect(avaliarCondicao({ combinacao: 'TODAS', regras: [{ id: '1', tipo: 'TEM_ETIQUETA', etiquetaId: 'vip' }] }, ctx())).toBe(true);
    expect(avaliarCondicao({ combinacao: 'TODAS', regras: [{ id: '1', tipo: 'NAO_TEM_ETIQUETA', etiquetaId: 'vip' }] }, ctx())).toBe(false);
  });

  it('campos: vazio, igual sem acento/caixa e numérico', () => {
    const regras = [
      { id: '1', tipo: 'CAMPO' as const, campo: 'email', operador: 'VAZIO' as const },
      { id: '2', tipo: 'CAMPO' as const, campo: 'nome', operador: 'IGUAL' as const, valor: 'ANA' },
      { id: '3', tipo: 'CAMPO' as const, campo: 'valor', operador: 'MAIOR' as const, valor: '100' },
    ];
    expect(avaliarCondicao({ combinacao: 'TODAS', regras }, ctx())).toBe(true);
  });

  it('mensagem contém, sem acento', () => {
    expect(
      avaliarCondicao({ combinacao: 'TODAS', regras: [{ id: '1', tipo: 'MENSAGEM', operador: 'CONTEM', valor: 'financeiro' }] }, ctx()),
    ).toBe(true);
  });

  it('horário comercial no fuso de Brasília', () => {
    const comercial = { id: '1', tipo: 'HORARIO' as const, inicio: '08:00', fim: '18:00', dias: [1, 2, 3, 4, 5] };
    expect(avaliarCondicao({ combinacao: 'TODAS', regras: [comercial] }, ctx())).toBe(true);
    // Domingo.
    expect(avaliarCondicao({ combinacao: 'TODAS', regras: [comercial] }, ctx({ agora: new Date('2026-10-25T13:00:00Z') }))).toBe(false);
  });

  it('janela que atravessa a meia-noite', () => {
    const noite = { id: '1', tipo: 'HORARIO' as const, inicio: '22:00', fim: '06:00', dias: [] };
    // 02:00 em Brasília.
    expect(avaliarCondicao({ combinacao: 'TODAS', regras: [noite] }, ctx({ agora: new Date('2026-10-21T05:00:00Z') }))).toBe(true);
  });

  it('QUALQUER basta uma; sem regras é "não"', () => {
    const regras = [
      { id: '1', tipo: 'TEM_ETIQUETA' as const, etiquetaId: 'outra' },
      { id: '2', tipo: 'TEM_ETIQUETA' as const, etiquetaId: 'vip' },
    ];
    expect(avaliarCondicao({ combinacao: 'QUALQUER', regras }, ctx())).toBe(true);
    expect(avaliarCondicao({ combinacao: 'TODAS', regras }, ctx())).toBe(false);
    expect(avaliarCondicao({ combinacao: 'TODAS', regras: [] }, ctx())).toBe(false);
  });
});
