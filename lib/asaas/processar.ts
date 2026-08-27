import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { definicaoDoEvento } from "./eventos";
import { asaasParaDataLocal, deducaoDoGateway, dinheiro, type EnvelopeAsaas } from "./webhook";

/**
 * O que cada evento P0 do Asaas escreve no ScopeFinance.
 *
 * ⚖️ **A ordem que governa este arquivo:** gravar e processar são passos
 * distintos. `registrarEvento` é a caixa de entrada — ela grava o payload cru
 * e é a única coisa que precisa acontecer antes de responder `200`.
 * `processarEvento` roda depois, e pode falhar sem que nada se perca: o
 * evento continua na tabela, com `process_status = 'failed'`, reprocessável
 * **sem depender do Asaas reenviar**.
 *
 * ⛔ Nenhuma função daqui responde HTTP. É a rota que garante `RN-AS-06` — a
 * regra de nunca sair da faixa 2xx —, e essa separação é o que permite testar
 * as regras de negócio sem simular uma requisição.
 */

// ════════════════════════════════════════════════════════════════════
//  Caixa de entrada
// ════════════════════════════════════════════════════════════════════

export interface RegistroEvento {
  /** `false` quando o evento já estava gravado — reentrega, não novidade. */
  novo: boolean;
  erro?: string;
}

/**
 * Grava o evento cru. `RN-AS-02`: a entrega é **at least once**.
 *
 * `ignoreDuplicates` traduz o `insert … on conflict (id) do nothing` do §4.4 —
 * e é o **banco** garantindo a idempotência, não o código lembrando. Sob
 * concorrência (o Asaas reentrega em paralelo no modo Não Sequencial), um
 * `select` seguido de `insert` teria uma janela em que os dois passam.
 */
export async function registrarEvento(
  supabase: SupabaseClient,
  env: EnvelopeAsaas
): Promise<RegistroEvento> {
  const { data, error } = await supabase
    .from("asaas_webhook_events")
    .upsert(
      {
        id: env.id,
        event_type: env.event,
        entity_type: env.entity_type,
        entity_id: env.entity_id,
        // ⛔ O JSON CRU, íntegro, sempre — inclusive o de evento que não
        // sabemos tratar. É a única coisa que permite reprocessar depois de
        // descobrir um bug, e não custa nada.
        payload: env.bruto,
      },
      { onConflict: "id", ignoreDuplicates: true }
    )
    .select("id");

  if (error) return { novo: false, erro: error.message };
  return { novo: (data?.length ?? 0) > 0 };
}

/** O desfecho do processamento de um evento. */
export type Desfecho =
  | { estado: "done"; detalhe?: string }
  | { estado: "ignored"; motivo: string }
  | { estado: "failed"; motivo: string };

async function marcar(
  supabase: SupabaseClient,
  id: string,
  desfecho: Desfecho,
  tentativas: number
) {
  await supabase
    .from("asaas_webhook_events")
    .update({
      process_status: desfecho.estado,
      processed_at: new Date().toISOString(),
      process_error:
        desfecho.estado === "done" ? null : "motivo" in desfecho ? desfecho.motivo : null,
      attempts: tentativas,
    })
    .eq("id", id);
}

/**
 * Processa um evento já gravado, e **nunca lança**.
 *
 * Exceção que escapa daqui viraria falha da rota, e falha da rota vira
 * resposta fora de 2xx — que é o `RN-AS-04`, 15 falhas, fila pausada. O erro
 * se trata do lado de dentro, na tabela.
 */
export async function processarEvento(
  supabase: SupabaseClient,
  env: EnvelopeAsaas,
  tentativaAnterior = 0
): Promise<Desfecho> {
  const tentativa = tentativaAnterior + 1;
  let desfecho: Desfecho;

  try {
    desfecho = await despachar(supabase, env);
  } catch (e) {
    desfecho = { estado: "failed", motivo: e instanceof Error ? e.message : "erro desconhecido" };
  }

  await marcar(supabase, env.id, desfecho, tentativa);
  return desfecho;
}

async function despachar(supabase: SupabaseClient, env: EnvelopeAsaas): Promise<Desfecho> {
  const def = definicaoDoEvento(env.event);

  // ⛔ Tipo desconhecido não é erro: é o Asaas tendo lançado algo novo. Fica
  // gravado, marcado `ignored`, e a resposta é 200.
  if (!def) {
    return { estado: "ignored", motivo: `evento "${env.event}" não está no catálogo` };
  }

  // Ondas 2 e 3 (§4.8): gravadas desde o dia 1, processadas depois. Dizer
  // "ignored" aqui é honesto — o dado está guardado e a regra ainda não existe.
  if (def.prioridade !== "P0") {
    return { estado: "ignored", motivo: `prioridade ${def.prioridade} — gravado, ainda sem regra` };
  }

  if (!env.objeto) {
    return { estado: "failed", motivo: `evento P0 sem o objeto "${def.entidade}" no corpo` };
  }

  switch (def.entidade) {
    case "payment":
      return aplicarCobranca(supabase, env);
    case "subscription":
      return aplicarAssinatura(supabase, env);
    case "invoice":
      return aplicarNotaFiscal(supabase, env);
    case "checkout":
      return aplicarCheckout(supabase, env);
    default:
      return { estado: "ignored", motivo: `entidade ${def.entidade} não altera dado financeiro` };
  }
}

// ════════════════════════════════════════════════════════════════════
//  Vínculos — o Asaas nunca cria cliente sozinho
// ════════════════════════════════════════════════════════════════════

/**
 * Resolve o cliente pelo `asaas_customer_id`.
 *
 * ⛔ **Devolve `null` em vez de criar.** O §1.1 do plano é explícito: o Asaas
 * *"não pode ser origem de cliente novo sem passar pela conciliação por
 * documento"* (§2.4). Criar aqui produziria a duplicata que o documento
 * inteiro existe para impedir — e duplicata com nota fiscal emitida não se
 * desfaz.
 *
 * A cobrança é gravada mesmo assim, com `cliente_id` nulo. Ela fica
 * localizável (`where cliente_id is null and asaas_payment_id is not null`) e
 * o religamento acontece na conciliação, que conhece o documento.
 */
async function resolverCliente(
  supabase: SupabaseClient,
  customerId: unknown
): Promise<string | null> {
  if (typeof customerId !== "string" || !customerId) return null;
  const { data } = await supabase
    .from("clientes")
    .select("id")
    .eq("asaas_customer_id", customerId)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

async function resolverAssinatura(
  supabase: SupabaseClient,
  subscriptionId: unknown
): Promise<string | null> {
  if (typeof subscriptionId !== "string" || !subscriptionId) return null;
  const { data } = await supabase
    .from("assinaturas")
    .select("id")
    .eq("asaas_subscription_id", subscriptionId)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

// ════════════════════════════════════════════════════════════════════
//  Cobranças — `PAYMENT_*`
// ════════════════════════════════════════════════════════════════════

/**
 * O status do Asaas traduzido para o vocabulário de `contas_receber`.
 *
 * ⚖️ **Por que traduzir em vez de gravar o do Asaas na coluna `status`.** Essa
 * coluna é lida por `lib/integracao/contrato.ts`, que calcula faturamento,
 * recebido e inadimplência com ela — e a Dashboard exibe esses números sem
 * recalcular (`RN-01`). Um valor novo ali muda silenciosamente três
 * indicadores. O status fino do Asaas é preservado em `asaas_status`, que
 * ninguém soma.
 *
 * ⚠️ `REFUNDED` vira `Cancelado`, não um status novo: o cálculo de
 * inadimplência exclui `Pago` e `Cancelado`. Um estorno com vencimento
 * passado, sob qualquer outro rótulo, entraria no vermelho do painel como se
 * fosse dívida do cliente — e não é: o dinheiro voltou.
 */
export function statusDaCobranca(evento: string, statusAsaas: unknown): string | null {
  const s = typeof statusAsaas === "string" ? statusAsaas : "";

  switch (evento) {
    case "PAYMENT_RECEIVED":
      return "Pago";
    case "PAYMENT_OVERDUE":
      return "Vencido";
    case "PAYMENT_DELETED":
    case "PAYMENT_REFUNDED":
      return "Cancelado";
    case "PAYMENT_RESTORED":
    case "PAYMENT_RECEIVED_IN_CASH_UNDONE":
      return "Pendente";
    // `CONFIRMED` é dinheiro prometido, não recebido — "Ainda NÃO é saldo
    // disponível", nas palavras do próprio catálogo. Contá-lo como Pago
    // anteciparia comissão sobre dinheiro que não entrou (`RN-06`).
    case "PAYMENT_CONFIRMED":
      return "Pendente";
    case "PAYMENT_PARTIALLY_REFUNDED":
    case "PAYMENT_ANTICIPATED":
      // Não mexem no estado da conta, só no valor/na data de crédito.
      return null;
    default:
      // `PAYMENT_CREATED` e `PAYMENT_UPDATED` carregam o status atual.
      if (s === "RECEIVED" || s === "RECEIVED_IN_CASH") return "Pago";
      if (s === "OVERDUE") return "Vencido";
      if (s === "REFUNDED" || s === "DELETED") return "Cancelado";
      return "Pendente";
  }
}

/** Recebido de fato — inclui a baixa em dinheiro fora do gateway. */
function foiRecebido(evento: string, statusAsaas: unknown): boolean {
  if (evento === "PAYMENT_RECEIVED") return true;
  return statusAsaas === "RECEIVED" || statusAsaas === "RECEIVED_IN_CASH";
}

async function aplicarCobranca(
  supabase: SupabaseClient,
  env: EnvelopeAsaas
): Promise<Desfecho> {
  const o = env.objeto as Record<string, unknown>;
  const asaasId = typeof o.id === "string" ? o.id : null;
  if (!asaasId) return { estado: "failed", motivo: "cobrança sem id" };

  const recebido = foiRecebido(env.event, o.status);
  const vencimento = asaasParaDataLocal(o.dueDate);
  const pagoEm = recebido
    ? asaasParaDataLocal(o.paymentDate ?? o.clientPaymentDate ?? o.confirmedDate)
    : null;

  // ⚠️ A competência é o mês do VENCIMENTO, não o de hoje. É o que faz a
  // cobrança de janeiro paga em março contar em janeiro no faturamento.
  const competencia = vencimento ? `${vencimento.slice(0, 7)}-01` : null;

  const espelho: Record<string, unknown> = {
    asaas_payment_id: asaasId,
    descricao:
      (typeof o.description === "string" && o.description.trim()) || `Cobrança Asaas ${asaasId}`,
    valor: dinheiro(o.value),
    // ⛔ Espelho do gateway — nunca editável pela tela (§4.7).
    valor_cobrado: dinheiro(o.value),
    valor_liquido: dinheiro(o.netValue),
    asaas_status: typeof o.status === "string" ? o.status : null,
    vencimento,
    competencia,
    forma_pagamento: typeof o.billingType === "string" ? o.billingType : null,
  };

  const novoStatus = statusDaCobranca(env.event, o.status);
  if (novoStatus) espelho.status = novoStatus;

  if (recebido) {
    espelho.pago_em = pagoEm;
    espelho.valor_pago = dinheiro(o.value);
    // 📐 `RN-04` da Dashboard calcula a comissão sobre `valor_pago − deducoes`.
    // Gravando a taxa do gateway aqui, a base de comissão passa a ser
    // exatamente o `netValue` — o que o §4.10 manda — sem uma linha sequer
    // mudar do lado de lá.
    espelho.deducoes = deducaoDoGateway(o.value, o.netValue) ?? "0.00";
  } else if (env.event === "PAYMENT_RECEIVED_IN_CASH_UNDONE") {
    // Desfazer a baixa é apagar os três fatos que ela criou, não só o status.
    espelho.pago_em = null;
    espelho.valor_pago = null;
    espelho.deducoes = "0.00";
  }

  const clienteId = await resolverCliente(supabase, o.customer);
  if (clienteId) espelho.cliente_id = clienteId;

  const assinaturaId = await resolverAssinatura(supabase, o.subscription);
  if (assinaturaId) espelho.assinatura_id = assinaturaId;

  const { data: existente } = await supabase
    .from("contas_receber")
    .select("id, valor_contratado")
    .eq("asaas_payment_id", asaasId)
    .maybeSingle();

  if (existente) {
    // ⛔ `valor_contratado` NÃO entra no update. Ele é o que foi combinado com
    // o cliente, dono é o ScopeFinance, e `RN-03` diz que é editável aqui.
    // Sobrescrevê-lo com o valor do Asaas é exatamente o conflito que o §4.7
    // resolve separando os dois fatos — e apagaria a edição de um humano.
    const { error } = await supabase
      .from("contas_receber")
      .update(espelho)
      .eq("id", (existente as { id: string }).id);
    if (error) return { estado: "failed", motivo: error.message };
    return {
      estado: "done",
      detalhe: clienteId ? undefined : "cobrança sem cliente vinculado — customer desconhecido aqui",
    };
  }

  // Na criação, o contratado nasce igual ao cobrado: ainda não houve edição
  // humana para preservar.
  const { error } = await supabase
    .from("contas_receber")
    .insert({ ...espelho, valor_contratado: dinheiro(o.value) });
  if (error) return { estado: "failed", motivo: error.message };

  return {
    estado: "done",
    detalhe: clienteId ? undefined : "cobrança criada sem cliente — customer desconhecido aqui",
  };
}

// ════════════════════════════════════════════════════════════════════
//  Assinaturas — `SUBSCRIPTION_*`
// ════════════════════════════════════════════════════════════════════

/**
 * O ciclo do Asaas no vocabulário de `assinaturas.ciclo`.
 *
 * ⛔ Devolve `null` para ciclo desconhecido em vez de cair em `'mensal'`.
 * Um ciclo semestral rotulado de mensal multiplica o MRR por seis — e o
 * número sai errado **parecendo certo**, que é a falha que o §4.10 descreve.
 */
export function cicloDoAsaas(cycle: unknown): string | null {
  switch (cycle) {
    case "WEEKLY":
      return "semanal";
    case "BIWEEKLY":
      return "quinzenal";
    case "MONTHLY":
      return "mensal";
    case "BIMONTHLY":
      return "bimestral";
    case "QUARTERLY":
      return "trimestral";
    case "SEMIANNUALLY":
      return "semestral";
    case "YEARLY":
      return "anual";
    default:
      return null;
  }
}

/** `Ativa | Suspensa | Cancelada` — o vocabulário que o MRR já lê. */
export function statusDaAssinatura(evento: string, statusAsaas: unknown): string {
  if (evento === "SUBSCRIPTION_INACTIVATED" || evento === "SUBSCRIPTION_DELETED") {
    return "Cancelada";
  }
  if (statusAsaas === "INACTIVE") return "Cancelada";
  if (statusAsaas === "EXPIRED") return "Cancelada";
  return "Ativa";
}

async function aplicarAssinatura(
  supabase: SupabaseClient,
  env: EnvelopeAsaas
): Promise<Desfecho> {
  const o = env.objeto as Record<string, unknown>;
  const asaasId = typeof o.id === "string" ? o.id : null;
  if (!asaasId) return { estado: "failed", motivo: "assinatura sem id" };

  const ciclo = cicloDoAsaas(o.cycle);
  const linha: Record<string, unknown> = {
    asaas_subscription_id: asaasId,
    direcao: "receber",
    descricao:
      (typeof o.description === "string" && o.description.trim()) || `Assinatura Asaas ${asaasId}`,
    valor: dinheiro(o.value),
    status: statusDaAssinatura(env.event, o.status),
    proximo_venc: asaasParaDataLocal(o.nextDueDate),
  };
  if (ciclo) linha.ciclo = ciclo;

  const clienteId = await resolverCliente(supabase, o.customer);
  if (clienteId) linha.cliente_id = clienteId;

  const { data: existente } = await supabase
    .from("assinaturas")
    .select("id")
    .eq("asaas_subscription_id", asaasId)
    .maybeSingle();

  if (existente) {
    const { error } = await supabase
      .from("assinaturas")
      .update(linha)
      .eq("id", (existente as { id: string }).id);
    if (error) return { estado: "failed", motivo: error.message };
  } else {
    const { error } = await supabase
      .from("assinaturas")
      .insert({ ...linha, inicio: asaasParaDataLocal(o.dateCreated) ?? new Date().toISOString().slice(0, 10) });
    if (error) return { estado: "failed", motivo: error.message };
  }

  const avisos: string[] = [];
  if (!ciclo) avisos.push(`ciclo "${String(o.cycle)}" desconhecido — não gravado, MRR não usa palpite`);
  if (!clienteId) avisos.push("customer desconhecido aqui — assinatura sem cliente vinculado");
  return { estado: "done", detalhe: avisos.length ? avisos.join(" · ") : undefined };
}

// ════════════════════════════════════════════════════════════════════
//  Notas fiscais — `INVOICE_*`
// ════════════════════════════════════════════════════════════════════

async function aplicarNotaFiscal(
  supabase: SupabaseClient,
  env: EnvelopeAsaas
): Promise<Desfecho> {
  const o = env.objeto as Record<string, unknown>;
  const asaasId = typeof o.id === "string" ? o.id : null;
  if (!asaasId) return { estado: "failed", motivo: "nota sem id" };

  const status =
    env.event === "INVOICE_AUTHORIZED"
      ? "Emitida"
      : env.event === "INVOICE_CANCELED"
        ? "Cancelada"
        : env.event === "INVOICE_ERROR"
          ? "Erro"
          : "Pendente";

  const linha: Record<string, unknown> = {
    asaas_invoice_id: asaasId,
    descricao_servico: typeof o.serviceDescription === "string" ? o.serviceDescription : null,
    valor: dinheiro(o.value),
    status,
    numero: typeof o.number === "string" ? o.number : null,
    data_emissao: asaasParaDataLocal(o.effectiveDate ?? o.dateCreated),
    pdf_url: typeof o.pdfUrl === "string" ? o.pdfUrl : null,
    xml_url: typeof o.xmlUrl === "string" ? o.xmlUrl : null,
    // O objeto inteiro fica na nota também: quando o fiscal perguntar por que
    // uma nota saiu como saiu, a resposta é este campo, não uma reconstituição.
    payload: o,
    erro: env.event === "INVOICE_ERROR" ? JSON.stringify(o.errors ?? o.status ?? "erro") : null,
  };

  const clienteId = await resolverCliente(supabase, o.customer);
  if (clienteId) linha.cliente_id = clienteId;

  if (typeof o.payment === "string") {
    const { data: conta } = await supabase
      .from("contas_receber")
      .select("id")
      .eq("asaas_payment_id", o.payment)
      .maybeSingle();
    if (conta) linha.conta_receber_id = (conta as { id: string }).id;
  }

  const { data: existente } = await supabase
    .from("notas_fiscais")
    .select("id")
    .eq("asaas_invoice_id", asaasId)
    .maybeSingle();

  const { error } = existente
    ? await supabase.from("notas_fiscais").update(linha).eq("id", (existente as { id: string }).id)
    : await supabase.from("notas_fiscais").insert(linha);

  if (error) return { estado: "failed", motivo: error.message };
  return { estado: "done" };
}

// ════════════════════════════════════════════════════════════════════
//  Checkout — só `CHECKOUT_PAID` é P0
// ════════════════════════════════════════════════════════════════════

/**
 * `CHECKOUT_PAID` é conversão de link de pagamento.
 *
 * ⚖️ Ele **não** cria cobrança aqui: o Asaas emite `PAYMENT_CREATED` /
 * `PAYMENT_RECEIVED` para a cobrança que o checkout gerou, e é esse evento
 * que carrega o `payment` com valor, vencimento e líquido. Criar a conta
 * pelos dois caminhos produziria duas linhas para o mesmo dinheiro.
 *
 * O que se faz aqui é o que só este evento sabe: registrar que o link
 * converteu. O restante chega pelo caminho de cobrança.
 */
async function aplicarCheckout(
  supabase: SupabaseClient,
  env: EnvelopeAsaas
): Promise<Desfecho> {
  const o = env.objeto as Record<string, unknown>;
  const asaasId = typeof o.id === "string" ? o.id : null;
  if (!asaasId) return { estado: "failed", motivo: "checkout sem id" };

  // O evento fica guardado com o payload cru na caixa de entrada — que é o
  // registro da conversão. Nada mais a escrever sem duplicar a cobrança.
  void supabase;
  return {
    estado: "done",
    detalhe: "conversão registrada; a cobrança chega pelos eventos PAYMENT_*",
  };
}

// ════════════════════════════════════════════════════════════════════
//  A rede de segurança do §4.5 e o alerta do §4.9
// ════════════════════════════════════════════════════════════════════

export interface ResultadoVarredura {
  examinados: number;
  concluidos: number;
  falhos: number;
  ignorados: number;
}

/** Tentativas por evento antes de ele parar de ser varrido. */
export const MAX_TENTATIVAS_EVENTO = 5;

/**
 * Reprocessa o que ficou para trás — o `after()` que morreu no meio, e o
 * evento que falhou por causa transitória.
 *
 * ⚖️ **Por que existe, mesmo com o caminho principal funcionando:** em
 * serverless a função morre ao responder. `after()` mantém a função viva
 * depois da resposta, mas não promete que ela sobreviva a um encerramento
 * abrupto da instância. Sem esta varredura, um evento gravado e não
 * processado ficaria `pending` para sempre — e `pending` não acende luz
 * nenhuma.
 */
export async function processarPendentes(
  supabase: SupabaseClient,
  limite = 100
): Promise<ResultadoVarredura> {
  const r: ResultadoVarredura = { examinados: 0, concluidos: 0, falhos: 0, ignorados: 0 };

  const { data } = await supabase
    .from("asaas_webhook_events")
    .select("id, event_type, entity_type, entity_id, payload, attempts")
    .in("process_status", ["pending", "failed"])
    .lt("attempts", MAX_TENTATIVAS_EVENTO)
    .order("received_at", { ascending: true })
    .limit(limite);

  for (const linha of (data ?? []) as Array<Record<string, unknown>>) {
    r.examinados++;
    const bruto = (linha.payload ?? {}) as Record<string, unknown>;
    const desfecho = await processarEvento(
      supabase,
      {
        id: String(linha.id),
        event: String(linha.event_type),
        entity_type: (linha.entity_type ?? null) as EnvelopeAsaas["entity_type"],
        entity_id: (linha.entity_id ?? null) as string | null,
        objeto: extrairObjeto(bruto, linha.entity_type as string | null),
        bruto,
      },
      Number(linha.attempts ?? 0)
    );
    if (desfecho.estado === "done") r.concluidos++;
    else if (desfecho.estado === "ignored") r.ignorados++;
    else r.falhos++;
  }

  return r;
}

function extrairObjeto(
  bruto: Record<string, unknown>,
  entidade: string | null
): Record<string, unknown> | null {
  if (!entidade) return null;
  const o = bruto[entidade];
  return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
}

export interface SaudeFilaAsaas {
  ultimo_evento_em: string | null;
  horas_sem_evento: number | null;
  pendentes: number;
  falhos: number;
  /** `true` quando o silêncio já é longo o bastante para ser sinal. */
  alerta: boolean;
  motivo: string;
}

/** Quantas horas de silêncio já significam "alguma coisa parou". */
export const HORAS_SILENCIO_ALERTA = 48;

/**
 * O healthcheck do §4.9 — **ausência de dado tem que ser um sinal ativo.**
 *
 * ⚖️ O Asaas manda e-mail quando a fila pausa, mas 14 dias passam rápido e
 * e-mail se perde. Esta é a mesma classe de defeito do §0.1 e do `ESTADO §6.1`:
 * a integração morre, a tela fica verde, e ninguém descobre por dias. Silêncio
 * se parece demais com "está tudo calmo".
 */
export async function saudeDaFila(supabase: SupabaseClient): Promise<SaudeFilaAsaas> {
  const { data: ultimo } = await supabase
    .from("asaas_webhook_events")
    .select("received_at")
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { count: pendentes } = await supabase
    .from("asaas_webhook_events")
    .select("id", { count: "exact", head: true })
    .eq("process_status", "pending");

  const { count: falhos } = await supabase
    .from("asaas_webhook_events")
    .select("id", { count: "exact", head: true })
    .eq("process_status", "failed");

  const recebidoEm = (ultimo as { received_at: string } | null)?.received_at ?? null;
  const horas = recebidoEm
    ? (Date.now() - new Date(recebidoEm).getTime()) / 3_600_000
    : null;

  // ⚠️ Nunca recebemos evento nenhum é estado DIFERENTE de "parou de chegar",
  // e só o segundo é alerta de fila. O primeiro é integração ainda não
  // plugada — dizer "alerta" nele treinaria quem olha a ignorar o vermelho.
  const alerta = horas !== null && horas > HORAS_SILENCIO_ALERTA;

  return {
    ultimo_evento_em: recebidoEm,
    horas_sem_evento: horas === null ? null : Math.round(horas * 10) / 10,
    pendentes: pendentes ?? 0,
    falhos: falhos ?? 0,
    alerta,
    motivo: alerta
      ? `nenhum evento do Asaas há ${Math.round(horas as number)}h — confira se a fila foi pausada (RN-AS-04) ou se a URL do webhook mudou`
      : recebidoEm
        ? "a fila entregou recentemente"
        : "nenhum evento recebido ainda — o webhook do Asaas ainda não foi apontado para cá",
  };
}
