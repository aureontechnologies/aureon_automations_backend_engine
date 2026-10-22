import { Injectable, Logger } from '@nestjs/common';
import { ConversaEventoTipo, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from '../messaging/messaging.service';
import { RoutingKeys } from '../messaging/messaging.constants';
import type { AutomationTriggerEvent } from '../messaging/automation-trigger.event';
import { renderTemplate } from '../workflow-engine/template.util';
import type { NodeExecutionContext } from '../workflow-engine/types';
import type { AcaoConfig } from './acoes.constants';
import { CAMPOS_CONTATO, isCampoContato } from './campos-contato.constants';

/** O que uma ação fez — vai para o `output` do nó, visível na tela de Execuções. */
export interface ResultadoAcao {
  tipo: AcaoConfig['tipo'];
  ok: boolean;
  detalhe: string;
}

const PASSO_POSICAO = 1024;

/**
 * Executa as ações do nó "Ações" sobre o CRM. Escreve direto no banco (o motor
 * não chama a API Core) e registra no chat do contato o mesmo evento que a
 * ação manual registraria — com origem AUTOMACAO.
 *
 * Uma ação que não encontra o que precisa (etiqueta apagada, quadro removido)
 * NÃO derruba o fluxo: vira `ok: false` com o motivo e as próximas seguem. Só
 * erro de infraestrutura (banco fora) sobe, para o motor marcar a falha.
 */
@Injectable()
export class CrmActionsService {
  private readonly logger = new Logger(CrmActionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
  ) {}

  async executar(acao: AcaoConfig, ctx: NodeExecutionContext): Promise<ResultadoAcao> {
    switch (acao.tipo) {
      case 'ADICIONAR_ETIQUETA':
        return this.adicionarEtiquetas(acao.etiquetaIds, ctx);
      case 'REMOVER_ETIQUETA':
        return this.removerEtiquetas(acao.etiquetaIds, ctx);
      case 'KANBAN_CARTAO':
        return this.kanban(acao, ctx);
      case 'AGENDAMENTO':
        return this.agendar(acao, ctx);
      case 'ENQUADRAR_FLUXO':
        return this.enquadrar(acao.workflowId, ctx);
      case 'DEFINIR_CAMPO':
        return this.definirCampo(acao.campo, acao.valor, ctx);
      case 'NOTIFICAR_MEMBRO':
        return this.notificar(acao.usuarioIds, acao.mensagem, ctx);
      case 'ATRIBUIR_ATENDIMENTO':
        return this.atribuir(acao.usuarioId, ctx);
      case 'REMOVER_ATRIBUICAO':
        return this.atribuir(null, ctx);
      default:
        return { tipo: (acao as AcaoConfig).tipo, ok: false, detalhe: 'Ação desconhecida.' };
    }
  }

  // --- Etiquetas -------------------------------------------------------------

  private async adicionarEtiquetas(ids: string[], ctx: NodeExecutionContext): Promise<ResultadoAcao> {
    const etiquetas = await this.prisma.etiqueta.findMany({
      where: { tenantId: ctx.tenantId, id: { in: ids ?? [] } },
      select: { id: true, nome: true },
    });
    const jaTem = new Set(
      (
        await this.prisma.contatoEtiqueta.findMany({
          where: { contatoId: ctx.contatoId, etiquetaId: { in: etiquetas.map((e) => e.id) } },
          select: { etiquetaId: true },
        })
      ).map((row) => row.etiquetaId),
    );
    const novas = etiquetas.filter((e) => !jaTem.has(e.id));
    if (novas.length > 0) {
      await this.prisma.contatoEtiqueta.createMany({
        data: novas.map((e) => ({ contatoId: ctx.contatoId, etiquetaId: e.id })),
        skipDuplicates: true,
      });
      for (const etiqueta of novas) {
        await this.evento(ctx, 'ETIQUETA_ADICIONADA', `Etiqueta *${etiqueta.nome}* adicionada pela automação`, {
          etiquetaId: etiqueta.id,
        });
      }
    }
    return {
      tipo: 'ADICIONAR_ETIQUETA',
      ok: etiquetas.length > 0,
      detalhe:
        etiquetas.length === 0
          ? 'Nenhuma das etiquetas existe mais.'
          : `${novas.length} adicionada(s), ${etiquetas.length - novas.length} já existia(m).`,
    };
  }

  private async removerEtiquetas(ids: string[], ctx: NodeExecutionContext): Promise<ResultadoAcao> {
    const tinha = await this.prisma.contatoEtiqueta.findMany({
      where: { contatoId: ctx.contatoId, etiquetaId: { in: ids ?? [] } },
      include: { etiqueta: { select: { nome: true } } },
    });
    if (tinha.length > 0) {
      await this.prisma.contatoEtiqueta.deleteMany({
        where: { contatoId: ctx.contatoId, etiquetaId: { in: tinha.map((t) => t.etiquetaId) } },
      });
      for (const row of tinha) {
        await this.evento(ctx, 'ETIQUETA_REMOVIDA', `Etiqueta *${row.etiqueta.nome}* removida pela automação`, {
          etiquetaId: row.etiquetaId,
        });
      }
    }
    return { tipo: 'REMOVER_ETIQUETA', ok: true, detalhe: `${tinha.length} removida(s).` };
  }

  // --- Kanban ----------------------------------------------------------------

  /** Um cartão por contato por quadro: se já existe, é movido/atualizado; senão, criado. */
  private async kanban(
    acao: Extract<AcaoConfig, { tipo: 'KANBAN_CARTAO' }>,
    ctx: NodeExecutionContext,
  ): Promise<ResultadoAcao> {
    const coluna = await this.prisma.kanbanColuna.findFirst({
      where: { id: acao.colunaId, quadroId: acao.quadroId, quadro: { tenantId: ctx.tenantId } },
      include: { quadro: { select: { nome: true } } },
    });
    if (!coluna) {
      return { tipo: 'KANBAN_CARTAO', ok: false, detalhe: 'O quadro ou a coluna não existe mais.' };
    }

    const titulo =
      renderTemplate(acao.titulo ?? '', ctx).trim() || ctx.contatoNome || ctx.contatoTelefone;
    const descricao = acao.descricao ? renderTemplate(acao.descricao, ctx) : undefined;
    const ultima = await this.prisma.kanbanCartao.aggregate({
      where: { colunaId: coluna.id },
      _max: { posicao: true },
    });
    const posicao = (ultima._max.posicao ?? 0) + PASSO_POSICAO;
    const membroIds = await this.membrosValidos(ctx.tenantId, acao.membroIds ?? []);

    const existente = await this.prisma.kanbanCartao.findFirst({
      where: { quadroId: acao.quadroId, contatoId: ctx.contatoId },
      select: { id: true, colunaId: true },
    });

    if (existente) {
      await this.prisma.$transaction(async (tx) => {
        await tx.kanbanCartao.update({
          where: { id: existente.id },
          data: {
            ...(existente.colunaId !== coluna.id ? { colunaId: coluna.id, posicao } : {}),
            ...(acao.titulo ? { titulo } : {}),
            ...(descricao !== undefined ? { descricao } : {}),
          },
        });
        if (membroIds.length) {
          await tx.kanbanCartaoMembro.createMany({
            data: membroIds.map((usuarioId) => ({ cartaoId: existente.id, usuarioId })),
            skipDuplicates: true,
          });
        }
      });
      await this.evento(ctx, 'KANBAN_CARTAO', `Cartão movido para ${coluna.quadro.nome} › ${coluna.nome} pela automação`, {
        cartaoId: existente.id,
      });
      return { tipo: 'KANBAN_CARTAO', ok: true, detalhe: `Cartão atualizado em ${coluna.nome}.` };
    }

    const cartao = await this.prisma.kanbanCartao.create({
      data: {
        tenantId: ctx.tenantId,
        quadroId: acao.quadroId,
        colunaId: coluna.id,
        contatoId: ctx.contatoId,
        titulo,
        descricao: descricao ?? null,
        posicao,
        membros: membroIds.length ? { create: membroIds.map((usuarioId) => ({ usuarioId })) } : undefined,
      },
    });
    await this.evento(ctx, 'KANBAN_CARTAO', `Cartão *${titulo}* criado em ${coluna.quadro.nome} › ${coluna.nome} pela automação`, {
      cartaoId: cartao.id,
    });
    return { tipo: 'KANBAN_CARTAO', ok: true, detalhe: `Cartão criado em ${coluna.nome}.` };
  }

  // --- Agenda ----------------------------------------------------------------

  private async agendar(
    acao: Extract<AcaoConfig, { tipo: 'AGENDAMENTO' }>,
    ctx: NodeExecutionContext,
  ): Promise<ResultadoAcao> {
    const responsavel =
      (acao.usuarioId && (await this.membrosValidos(ctx.tenantId, [acao.usuarioId]))[0]) ||
      (await this.dono(ctx.tenantId));
    const inicio = new Date(Date.now() + Math.max(0, Number(acao.minutosAPartir) || 0) * 60_000);
    const fim = new Date(inicio.getTime() + Math.max(5, Number(acao.duracaoMinutos) || 30) * 60_000);
    const titulo = renderTemplate(acao.titulo, ctx).trim() || 'Agendamento';

    const agendamento = await this.prisma.agendamento.create({
      data: {
        tenantId: ctx.tenantId,
        usuarioId: responsavel,
        contatoId: ctx.contatoId,
        titulo,
        descricao: acao.descricao ? renderTemplate(acao.descricao, ctx) : null,
        inicio,
        fim,
        lembreteMinutos: acao.lembreteMinutos ?? null,
        origem: 'AUTOMACAO',
      },
    });
    await this.evento(ctx, 'AGENDAMENTO_CRIADO', `Agendamento *${titulo}* criado pela automação para ${formatarData(inicio)}`, {
      agendamentoId: agendamento.id,
    });
    if (responsavel) {
      await this.notificacao(ctx.tenantId, [responsavel], 'AGENDA', 'Novo agendamento (automação)', `${titulo} — ${formatarData(inicio)}`, `/agenda?data=${inicio.toISOString().slice(0, 10)}`);
    }
    return { tipo: 'AGENDAMENTO', ok: true, detalhe: `Agendado para ${formatarData(inicio)}.` };
  }

  // --- Outro fluxo -----------------------------------------------------------

  /**
   * "Enquadrar em outro fluxo": o contato entra AGORA no fluxo escolhido,
   * independente do gatilho dele. Quem já está no meio daquele fluxo (rodando
   * ou esperando) não entra de novo; quem já passou por ele, entra outra vez.
   */
  private async enquadrar(workflowId: string, ctx: NodeExecutionContext): Promise<ResultadoAcao> {
    if (workflowId === ctx.workflowId) {
      return { tipo: 'ENQUADRAR_FLUXO', ok: false, detalhe: 'O fluxo de destino é este mesmo fluxo.' };
    }
    const destino = await this.prisma.workflow.findFirst({
      where: { id: workflowId, tenantId: ctx.tenantId },
      select: { id: true, nome: true, status: true, version: true, publishedJson: true, whatsappConnectionId: true },
    });
    if (!destino || destino.status !== 'PUBLICADO') {
      return { tipo: 'ENQUADRAR_FLUXO', ok: false, detalhe: 'O fluxo de destino não está ativo.' };
    }
    const trigger = (destino.publishedJson as { nodes?: Array<{ id: string; isTrigger?: boolean }> } | null)?.nodes?.find(
      (node) => node.isTrigger,
    );
    if (!trigger) {
      return { tipo: 'ENQUADRAR_FLUXO', ok: false, detalhe: 'O fluxo de destino não tem gatilho publicado.' };
    }

    const anterior = await this.prisma.workflowExecution.findUnique({
      where: {
        workflowId_contatoId_workflowVersion: {
          workflowId: destino.id,
          contatoId: ctx.contatoId,
          workflowVersion: destino.version,
        },
      },
      select: { id: true, status: true },
    });
    if (anterior && (anterior.status === 'RUNNING' || anterior.status === 'WAITING')) {
      return { tipo: 'ENQUADRAR_FLUXO', ok: true, detalhe: `O contato já está no fluxo "${destino.nome}".` };
    }

    const execucao = await this.prisma.$transaction(async (tx) => {
      // A trava única (fluxo, contato, versão) impede entrar duas vezes na
      // mesma versão; o enquadramento manual é justamente o caso de reentrar.
      if (anterior) await tx.workflowExecution.delete({ where: { id: anterior.id } });
      return tx.workflowExecution.create({
        data: {
          workflowId: destino.id,
          contatoId: ctx.contatoId,
          workflowVersion: destino.version,
          status: 'RUNNING',
        },
      });
    });

    const evento: AutomationTriggerEvent = {
      event: 'automation.trigger',
      tenantId: ctx.tenantId,
      contatoId: ctx.contatoId,
      canal: ctx.canal,
      connectionId: destino.whatsappConnectionId ?? ctx.connectionId,
      workflowId: destino.id,
      workflowVersion: destino.version,
      executionId: execucao.id,
      triggerNodeId: trigger.id,
      conteudo: ctx.incoming?.conteudo ?? null,
      texto: ctx.incoming?.texto ?? null,
      tipo: ctx.incoming?.tipo ?? 'TEXTO',
      occurredAt: new Date().toISOString(),
    };
    this.messaging.publish(RoutingKeys.AUTOMATION_TRIGGER, evento as unknown as Record<string, unknown>);
    await this.evento(ctx, 'AUTOMACAO_INICIADA', `Contato enquadrado no fluxo *${destino.nome}* pela automação`, {
      workflowId: destino.id,
    });
    return { tipo: 'ENQUADRAR_FLUXO', ok: true, detalhe: `Enquadrado em "${destino.nome}".` };
  }

  // --- Campos do contato -----------------------------------------------------

  private async definirCampo(campo: string, valorBruto: string, ctx: NodeExecutionContext): Promise<ResultadoAcao> {
    if (!isCampoContato(campo)) {
      return { tipo: 'DEFINIR_CAMPO', ok: false, detalhe: `Campo "${campo}" não pode ser alterado.` };
    }
    const valor = renderTemplate(valorBruto ?? '', ctx).trim();
    let data: Prisma.ContatoUpdateInput;
    if (CAMPOS_CONTATO[campo].tipo === 'numero') {
      const numero = Number(valor.replace(',', '.'));
      if (!Number.isFinite(numero)) {
        return { tipo: 'DEFINIR_CAMPO', ok: false, detalhe: `"${valor}" não é um número.` };
      }
      data = campo === 'rating' ? { rating: Math.max(0, Math.min(5, Math.round(numero))) } : { valor: numero };
    } else {
      data = { [campo]: valor || null };
    }
    await this.prisma.contato.update({ where: { id: ctx.contatoId }, data });
    await this.evento(ctx, 'CAMPO_ALTERADO', `${CAMPOS_CONTATO[campo].label} alterado para *${valor || '(vazio)'}* pela automação`, {
      campo,
    });
    return { tipo: 'DEFINIR_CAMPO', ok: true, detalhe: `${CAMPOS_CONTATO[campo].label} = ${valor || '(vazio)'}` };
  }

  // --- Equipe ----------------------------------------------------------------

  private async notificar(usuarioIds: string[], mensagem: string | undefined, ctx: NodeExecutionContext): Promise<ResultadoAcao> {
    const validos = await this.membrosValidos(ctx.tenantId, usuarioIds ?? []);
    const conversa = await this.conversa(ctx);
    const nomeContato = ctx.contatoNome ?? ctx.contatoTelefone;
    await this.notificacao(
      ctx.tenantId,
      validos,
      'AUTOMACAO',
      `Automação: atenção para ${nomeContato}`,
      mensagem ? renderTemplate(mensagem, ctx) : `O contato ${nomeContato} passou por uma etapa que pede sua atenção.`,
      `/atendimento?conversa=${conversa.id}`,
    );
    if (validos.length > 0) {
      const nomes = await this.prisma.usuario.findMany({ where: { id: { in: validos } }, select: { nome: true } });
      await this.evento(ctx, 'MEMBRO_NOTIFICADO', `Automação notificou ${nomes.map((n) => n.nome).join(', ')}`);
    }
    return { tipo: 'NOTIFICAR_MEMBRO', ok: validos.length > 0, detalhe: `${validos.length} membro(s) notificado(s).` };
  }

  /**
   * "Atribuir e abrir atendimento": a conversa vai para o membro e fica aberta;
   * o Agente IA sai (uma pessoa assumiu). Com \`null\`, devolve à fila.
   */
  private async atribuir(usuarioId: string | null, ctx: NodeExecutionContext): Promise<ResultadoAcao> {
    const tipo = usuarioId ? 'ATRIBUIR_ATENDIMENTO' : 'REMOVER_ATRIBUICAO';
    const membro = usuarioId ? (await this.membrosValidos(ctx.tenantId, [usuarioId]))[0] : null;
    if (usuarioId && !membro) {
      return { tipo, ok: false, detalhe: 'Membro não encontrado ou desativado.' };
    }
    const conversa = await this.conversa(ctx);
    await this.prisma.$transaction([
      this.prisma.conversa.update({
        where: { id: conversa.id },
        data: membro
          ? { atribuidoAId: membro, status: 'ATIVA', finalizadaEm: null }
          : { atribuidoAId: null },
      }),
      ...(membro
        ? [this.prisma.contato.update({ where: { id: ctx.contatoId }, data: { agenteAtivoId: null, agenteAtivoDesde: null } })]
        : []),
    ]);

    if (!membro) {
      await this.evento(ctx, 'ATRIBUICAO_REMOVIDA', 'Automação removeu a atribuição — a conversa voltou para a fila', undefined, conversa.id);
      return { tipo, ok: true, detalhe: 'Atribuição removida.' };
    }
    const nome = (await this.prisma.usuario.findUnique({ where: { id: membro }, select: { nome: true } }))?.nome ?? 'membro';
    await this.evento(ctx, 'ATRIBUIDA', `Automação atribuiu o atendimento a ${nome}`, { para: membro }, conversa.id);
    await this.notificacao(
      ctx.tenantId,
      [membro],
      'ATENDIMENTO',
      'Novo atendimento para você',
      `A automação passou a conversa com ${ctx.contatoNome ?? ctx.contatoTelefone} para você.`,
      `/atendimento?conversa=${conversa.id}`,
    );
    return { tipo, ok: true, detalhe: `Atribuído a ${nome}.` };
  }

  // ---------------------------------------------------------------------------

  /** A conversa deste contato no número do fluxo — criada se ainda não existir. */
  private conversa(ctx: NodeExecutionContext) {
    return this.prisma.conversa.upsert({
      where: {
        contatoId_whatsappConnectionId: { contatoId: ctx.contatoId, whatsappConnectionId: ctx.connectionId },
      },
      create: { tenantId: ctx.tenantId, contatoId: ctx.contatoId, whatsappConnectionId: ctx.connectionId },
      update: {},
      select: { id: true },
    });
  }

  private async membrosValidos(tenantId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const membros = await this.prisma.usuario.findMany({
      where: { tenantId, ativo: true, id: { in: ids } },
      select: { id: true },
    });
    return membros.map((m) => m.id);
  }

  private async dono(tenantId: string): Promise<string | null> {
    const dono = await this.prisma.usuario.findFirst({
      where: { tenantId, papel: 'DONO', ativo: true },
      select: { id: true },
    });
    return dono?.id ?? null;
  }

  private async notificacao(
    tenantId: string,
    usuarioIds: string[],
    tipo: string,
    titulo: string,
    mensagem: string,
    link: string,
  ): Promise<void> {
    if (usuarioIds.length === 0) return;
    await this.prisma.notificacao.createMany({
      data: usuarioIds.map((usuarioId) => ({ tenantId, usuarioId, tipo, titulo, mensagem, link })),
    });
  }

  /** Evento no chat. Falhar aqui não desfaz a ação já feita — só loga. */
  private async evento(
    ctx: NodeExecutionContext,
    tipo: ConversaEventoTipo,
    descricao: string,
    metadata?: Record<string, unknown>,
    conversaId?: string,
  ): Promise<void> {
    try {
      const alvo = conversaId ?? (await this.conversa(ctx)).id;
      await this.prisma.conversaEvento.create({
        data: {
          tenantId: ctx.tenantId,
          contatoId: ctx.contatoId,
          conversaId: alvo,
          tipo,
          descricao,
          origem: 'AUTOMACAO',
          metadata: { ...(metadata ?? {}), workflowId: ctx.workflowId } as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      this.logger.error(`Falha ao registrar evento ${tipo} da automação`, error as Error);
    }
  }
}

function formatarData(data: Date): string {
  return data.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
