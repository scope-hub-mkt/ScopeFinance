import "server-only";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Serviços entregues — a correlação cliente × serviço × contrato × cobrança.
 *
 * ⚖️ **É o gêmeo financeiro do painel `/servicos/prestados` da Dashboard**,
 * pedido pelo dono em 03/09/2026: *"confira se esse tipo de otimização foi
 * implementada também no scope finance… inclusive o segundo painel que
 * mostra os nós de relações e o histórico de serviços entregues, ativos"*.
 *
 * ⛔ **O que muda de lado para lado, e por quê.** A Dashboard responde *"quem
 * entrega e quanto recebe"* — ela é dona do catálogo e do comissionamento. O
 * ScopeFinance responde *"o que foi cobrado por isso e o que entrou"* — ele é
 * dono da cobrança (`RN-01`). Colaborador **não existe aqui**, e inventá-lo
 * criaria a segunda verdade sobre quem presta o quê.
 *
 * ⚠️ Os serviços vêm de `servicos_espelho`, que é **cópia somente leitura** do
 * catálogo da Dashboard. Um nome estranho aqui se corrige lá, nunca aqui.
 */

export interface ServicoEntregue {
  id: string;
  contrato_id: string;
  cliente_id: string | null;
  cliente_nome: string;
  /** Nulo quando o item foi descrito à mão, sem casar com o catálogo. */
  servico_id: string | null;
  servico_nome: string;
  descricao: string;
  quantidade: number;
  valor: number | null;
  recorrencia: string | null;
  /** ── começo, meio e fim, do contrato que o cobre ── */
  contrato_status: string;
  contrato_inicio: string | null;
  contrato_fim: string | null;
  /** Dias de vigência já corridos (ou totais, se encerrado). Nulo sem início. */
  dias: number | null;
  /** ── o que foi cobrado e o que entrou, por este contrato ── */
  cobrancas: number;
  cobrado: number;
  recebido: number;
  /** ⚠️ Quantas dessas cobranças NÃO nasceram no gateway (`RN-52`). */
  cobrancas_manuais: number;
}

export interface TelaServicosEntregues {
  linhas: ServicoEntregue[];
  clientes: { id: string; nome: string; itens: number }[];
  totais: {
    itens: number;
    ativos: number;
    encerrados: number;
    recorrentes: number;
    /** ⛔ Itens de contrato ativo que nunca geraram cobrança nenhuma. */
    semCobranca: number;
    cobrado: number;
    recebido: number;
  };
}

/** Dias entre duas datas, ou até hoje. Espelha o gêmeo da Dashboard. */
function diasEntre(inicio: string | null, fim: string | null): number | null {
  if (!inicio) return null;
  const a = new Date(inicio + "T00:00:00Z").getTime();
  const b = fim ? new Date(fim + "T00:00:00Z").getTime() : Date.now();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

const TETO = 5000;

export async function montarServicosEntregues(): Promise<TelaServicosEntregues> {
  const supabase = createSupabaseAdmin();

  // ⚠️ Leituras planas e costura em memória, e cada uma com `.limit()` no
  // próprio `select`: é o mesmo padrão que a catraca de consumo da Dashboard
  // obriga, e vale aqui pela mesma razão — uma tela nova é onde a varredura
  // de tabela inteira entra sem ninguém reparar.
  const [itens, contratos, clientes, espelho, receber] = await Promise.all([
    supabase
      .from("contrato_servicos")
      .select("id, contrato_id, servico_id, descricao, quantidade, valor, recorrencia")
      .limit(TETO),
    supabase.from("contratos").select("id, cliente_id, status, inicio, fim").limit(TETO),
    supabase.from("clientes").select("id, nome").limit(TETO),
    supabase.from("servicos_espelho").select("id, nome, recorrencia").limit(TETO),
    supabase
      .from("contas_receber")
      .select("contrato_id, valor, valor_pago, status, origem_lancamento")
      .limit(TETO),
  ]);

  const erro = itens.error ?? contratos.error ?? clientes.error ?? espelho.error ?? receber.error;
  if (erro) throw new Error(erro.message);

  const contratoPorId = new Map((contratos.data ?? []).map((c) => [c.id, c]));
  const nomeCliente = new Map((clientes.data ?? []).map((c) => [c.id, c.nome]));
  const doCatalogo = new Map((espelho.data ?? []).map((s) => [s.id, s]));

  /** Cobranças agrupadas por contrato — uma passada, não uma consulta por linha. */
  const porContrato = new Map<
    string,
    { cobrancas: number; cobrado: number; recebido: number; manuais: number }
  >();
  for (const r of receber.data ?? []) {
    const k = r.contrato_id;
    if (!k) continue;
    const a = porContrato.get(k) ?? { cobrancas: 0, cobrado: 0, recebido: 0, manuais: 0 };
    a.cobrancas++;
    a.cobrado += Number(r.valor || 0);
    if (r.status === "Pago") a.recebido += Number(r.valor_pago ?? r.valor ?? 0);
    if (r.origem_lancamento !== "asaas") a.manuais++;
    porContrato.set(k, a);
  }

  const linhas: ServicoEntregue[] = (itens.data ?? []).map((i) => {
    const contrato = contratoPorId.get(i.contrato_id);
    const servico = i.servico_id ? doCatalogo.get(i.servico_id) : null;
    const agregado = porContrato.get(i.contrato_id) ?? {
      cobrancas: 0,
      cobrado: 0,
      recebido: 0,
      manuais: 0,
    };

    return {
      id: i.id,
      contrato_id: i.contrato_id,
      cliente_id: contrato?.cliente_id ?? null,
      cliente_nome: contrato?.cliente_id
        ? (nomeCliente.get(contrato.cliente_id) ?? "(cliente não encontrado)")
        : "(sem cliente)",
      servico_id: i.servico_id ?? null,
      // ⚖️ Item sem `servico_id` é legítimo: alguém descreveu à mão em vez de
      // escolher do catálogo. A tela diz isso em vez de fingir um nome.
      servico_nome: servico?.nome ?? "(descrito à mão)",
      descricao: i.descricao ?? "",
      quantidade: Number(i.quantidade ?? 1),
      valor: i.valor === null || i.valor === undefined ? null : Number(i.valor),
      recorrencia: i.recorrencia ?? servico?.recorrencia ?? null,
      contrato_status: contrato?.status ?? "(sem contrato)",
      contrato_inicio: contrato?.inicio ?? null,
      contrato_fim: contrato?.fim ?? null,
      dias: diasEntre(contrato?.inicio ?? null, contrato?.fim ?? null),
      cobrancas: agregado.cobrancas,
      cobrado: agregado.cobrado,
      recebido: agregado.recebido,
      cobrancas_manuais: agregado.manuais,
    };
  });

  const porCliente = new Map<string, number>();
  for (const l of linhas) {
    if (!l.cliente_id) continue;
    porCliente.set(l.cliente_id, (porCliente.get(l.cliente_id) ?? 0) + 1);
  }

  const ativo = (l: ServicoEntregue) => l.contrato_status === "Ativo";

  return {
    linhas,
    clientes: [...porCliente.entries()]
      .map(([id, itens]) => ({ id, nome: nomeCliente.get(id) ?? "(cliente removido)", itens }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    totais: {
      itens: linhas.length,
      ativos: linhas.filter(ativo).length,
      encerrados: linhas.filter((l) => !ativo(l)).length,
      recorrentes: linhas.filter((l) => l.recorrencia && ativo(l)).length,
      // ⛔ O número que a tela existe para tornar visível: item de contrato
      // ativo que nunca virou cobrança é serviço entregue e não faturado.
      semCobranca: linhas.filter((l) => ativo(l) && l.cobrancas === 0).length,
      cobrado: linhas.reduce((s, l) => s + l.cobrado, 0),
      recebido: linhas.reduce((s, l) => s + l.recebido, 0),
    },
  };
}
