import { AiCreditConfig } from './ai-credit.config';
import { AiUsageService } from './ai-usage.service';

/**
 * O caminho do dinheiro no MOTOR — o gêmeo do teste que existe no backend.
 *
 * Os dois serviços descontam da MESMA carteira, então divergir em
 * comportamento é pior que divergir em forma: a mesma conversa custaria valores
 * diferentes dependendo de quem a atendeu. Estes testes fixam as quatro
 * decisões que precisam bater com as de lá, mais uma que só existe aqui: o
 * motivo devolvido ao cliente NÃO pode carregar a mensagem crua do provedor.
 */
const TENANT = '11111111-1111-4111-8111-111111111111';

/**
 * A reserva calculada para as mensagens de `input()`: ~5 tokens de prompt mais
 * o teto de 500 da resposta, na taxa padrão de 1 crédito por token.
 */
const RESERVA_ESPERADA = 505;

function setup(
  options: {
    reserva?: { doPlano: number; doComprado: number } | null;
    credencial?: { provider: string; apiKey: string; cobraCreditos: boolean } | null;
    respostaDoProvedor?: unknown;
    erroDoProvedor?: Error;
    saldo?: number;
  } = {},
) {
  const reserva =
    options.reserva === undefined
      ? { doPlano: RESERVA_ESPERADA, doComprado: 0 }
      : options.reserva;

  const walletRepository = {
    ensure: jest.fn().mockResolvedValue(undefined),
    saldo: jest.fn().mockResolvedValue(options.saldo ?? 0),
    reservar: jest.fn().mockResolvedValue(reserva),
    liquidar: jest.fn().mockImplementation(({ creditosReais }) =>
      Promise.resolve({
        creditosDebitados: creditosReais,
        saldoDepois: 10_000 - creditosReais,
      }),
    ),
    estornar: jest.fn().mockResolvedValue(undefined),
  };

  const usageRepository = {
    abrir: jest.fn().mockResolvedValue({ id: 'uso-1' }),
    concluir: jest.fn().mockResolvedValue({}),
    estornar: jest.fn().mockResolvedValue({}),
  };

  const aiService = {
    resolverCredencial: jest
      .fn()
      .mockReturnValue(
        options.credencial === undefined
          ? { provider: 'openai', apiKey: 'sk-plataforma', cobraCreditos: true }
          : options.credencial,
      ),
    chat: options.erroDoProvedor
      ? jest.fn().mockRejectedValue(options.erroDoProvedor)
      : jest.fn().mockResolvedValue(
          options.respostaDoProvedor ?? {
            texto: 'Olá!',
            model: 'gpt-4o-mini',
            provider: 'openai',
            cobraCreditos: true,
            usage: {
              promptTokens: 300,
              completionTokens: 120,
              totalTokens: 420,
            },
          },
        ),
  };

  const service = new AiUsageService(
    aiService as never,
    walletRepository as never,
    usageRepository as never,
    new AiCreditConfig(),
  );

  return { service, walletRepository, usageRepository, aiService };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT,
    feature: 'agente_conversa',
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system' as const, content: 'Você é um agente.' },
      { role: 'user' as const, content: 'Oi' },
    ],
    ...overrides,
  };
}

describe('AiUsageService (motor)', () => {
  it('cobra pelo consumo REAL e devolve a diferença da reserva', async () => {
    const { service, walletRepository, usageRepository } = setup();

    const resultado = await service.executar(input());

    // 420 tokens × taxa 1 = 420 créditos, e não os 505 reservados.
    expect(walletRepository.liquidar).toHaveBeenCalledWith(
      expect.objectContaining({ creditosReais: 420 }),
    );
    expect(resultado).toMatchObject({ status: 'ok', creditosConsumidos: 420 });
    expect(usageRepository.concluir).toHaveBeenCalledWith(
      expect.objectContaining({ totalTokens: 420, creditosConsumidos: 420 }),
    );
  });

  it('sem saldo, NÃO chama o provedor', async () => {
    // O ponto do teste é `chat` nunca ter sido chamado: recusar depois da
    // chamada já teria custado dinheiro à plataforma.
    const { service, aiService, usageRepository } = setup({
      reserva: null,
      saldo: 12,
    });

    const resultado = await service.executar(input());

    expect(resultado).toEqual({
      status: 'sem_creditos',
      saldo: 12,
      necessario: RESERVA_ESPERADA,
    });
    expect(aiService.chat).not.toHaveBeenCalled();
    expect(usageRepository.abrir).not.toHaveBeenCalled();
  });

  it('sem chave da plataforma, não reserva nem chama nada', async () => {
    const { service, aiService, walletRepository } = setup({ credencial: null });

    const resultado = await service.executar(input());

    expect(resultado).toEqual({ status: 'sem_provedor' });
    expect(walletRepository.reservar).not.toHaveBeenCalled();
    expect(aiService.chat).not.toHaveBeenCalled();
  });

  it('chamada que falha é estornada por inteiro', async () => {
    const { service, walletRepository, usageRepository } = setup({
      erroDoProvedor: new Error('timeout'),
    });

    const resultado = await service.executar(input());

    expect(resultado.status).toBe('falha_provedor');
    expect(walletRepository.estornar).toHaveBeenCalledWith(
      expect.objectContaining({
        reserva: { doPlano: RESERVA_ESPERADA, doComprado: 0 },
        referenciaId: 'uso-1',
      }),
    );
    expect(walletRepository.liquidar).not.toHaveBeenCalled();
    // `creditosConsumidos: 0` no registro: o cliente não pagou por uma resposta
    // que não recebeu.
    expect(usageRepository.estornar).toHaveBeenCalledWith('uso-1', 'timeout');
  });

  it('o motivo devolvido ao cliente NÃO carrega a mensagem crua do provedor', async () => {
    // Desde que a chave é da PLATAFORMA, as mensagens da OpenAI falam da NOSSA
    // conta. O motivo vira o erro que o tenant lê na tela de Execuções, então
    // ele precisa ser genérico — o texto real fica só no log e no `AiUsage`.
    const cru = 'Incorrect API key provided: sk-proj-ABC***XYZ';
    const { service, usageRepository } = setup({
      erroDoProvedor: new Error(cru),
    });

    const resultado = await service.executar(input());

    expect(resultado).toEqual({
      status: 'falha_provedor',
      motivo: expect.any(String),
    });
    if (resultado.status !== 'falha_provedor') throw new Error('estado inesperado');
    expect(resultado.motivo).not.toContain('sk-');
    expect(resultado.motivo).not.toContain('API key');
    // O texto real continua guardado, onde só a operação enxerga.
    expect(usageRepository.estornar).toHaveBeenCalledWith('uso-1', cru);
  });

  it('sem `usage` do provedor, cobra a estimativa reservada', async () => {
    // Endpoint compatível que não devolve contagem de tokens. Inventar um
    // consumo seria pior: cobrar o que foi reservado é o número que existe.
    const { service, walletRepository } = setup({
      respostaDoProvedor: {
        texto: 'Olá!',
        model: 'gpt-4o-mini',
        provider: 'openai',
        cobraCreditos: true,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      },
    });

    await service.executar(input());

    expect(walletRepository.liquidar).toHaveBeenCalledWith(
      expect.objectContaining({ creditosReais: RESERVA_ESPERADA }),
    );
  });

  it('BYOK não desconta crédito, mas registra o consumo', async () => {
    const { service, walletRepository, usageRepository } = setup({
      credencial: {
        provider: 'openai',
        apiKey: 'sk-do-tenant',
        cobraCreditos: false,
      },
    });

    const resultado = await service.executar(input());

    expect(walletRepository.reservar).not.toHaveBeenCalled();
    expect(walletRepository.liquidar).not.toHaveBeenCalled();
    expect(resultado).toMatchObject({ status: 'ok', creditosConsumidos: 0 });
    // A métrica não depende de quem paga a conta.
    expect(usageRepository.abrir).toHaveBeenCalledWith(
      expect.objectContaining({ creditosReservados: 0 }),
    );
    expect(usageRepository.concluir).toHaveBeenCalledWith(
      expect.objectContaining({ totalTokens: 420, creditosConsumidos: 0 }),
    );
  });

  it('registra o consumo sem usuário — quem gastou foi o motor', async () => {
    const { service, usageRepository } = setup();

    await service.executar(input({ agenteId: 'agente-9', contatoId: 'contato-3' }));

    expect(usageRepository.abrir).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        provider: 'openai',
        feature: 'agente_conversa',
        agenteId: 'agente-9',
        contatoId: 'contato-3',
        requestId: expect.any(String),
      }),
    );
  });
});
