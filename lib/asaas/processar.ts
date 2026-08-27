import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { definicaoDoEvento } from "./eventos";
import { asaasParaDataLocal, type EnvelopeAsaas } from "./webhook";
import {
  linhaDaAssinatura,
  linhaDaCobranca,
  linhaDaNota,
} from "./mapear";

// Reexportados porque a suíte e o backfill os leem daqui desde a primeira
// versão. O lugar onde eles MORAM é `mapear.ts` — puro, e único.
export {
  cicloDoAsaas,
  foiRecebido,
  statusDaAssinatura,
  statusDaCobranca,
  tipoDaVenda,
} from "./mapear";

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
//  Cobranças, assinaturas e notas — `PAYMENT_*`, `SUBSCRIPTION_*`, `INVOICE_*`
// ════════════════════════════════════════════════════════════════════
//
// ⚖️ Estes três handlers fazem **só o que exige banco**: resolver vínculo,
// decidir entre inserir e atualizar, e gravar. A tradução do objeto do Asaas
// para a linha mora em `mapear.ts`, e é a MESMA que o backfill usa. Duas
// traduções do mesmo dado divergiriam no primeiro campo que alguém corrigisse
// num lado só — e a divergência apareceria meses depois, num relatório em que
// a cobrança importada e a recebida ao vivo não batem.

async function aplicarCobranca(
  supabase: SupabaseClient,
  env: EnvelopeAsaas
): Promise<Desfecho> {
  const mapeada = linhaDaCobranca(env.objeto as Record<string, unknown>, env.event);
  if (!mapeada) return { estado: "failed", motivo: "cobrança sem id" };

  const { linha, vinculos } = mapeada;

  const clienteId = await resolverCliente(supabase, vinculos.customer);
  if (clienteId) linha.cliente_id = clienteId;

  const assinaturaId = await resolverAssinatura(supabase, vinculos.subscription);
  if (assinaturaId) linha.assinatura_id = assinaturaId;

  const { data: existente } = await supabase
    .from("contas_receber")
    .select("id")
    .eq("asaas_payment_id", linha.asaas_payment_id as string)
    .maybeSingle();

  if (existente) {
    // ⛔ `valor_contratado` NÃO entra no update — `mapear.ts` nem o produz.
    // Ele é o que foi combinado com o cliente, e `RN-03` diz que é editável
    // aqui. Sobrescrevê-lo com o valor do gateway apagaria a edição de um
    // humano, que é o conflito que o §4.7 resolve separando os dois fatos.
    const { error } = await supabase
      .from("contas_receber")
      .update(linha)
      .eq("id", (existente as { id: string }).id);
    if (error) return { estado: "failed", motivo: error.message };
  } else {
    // Na criação o contratado nasce igual ao cobrado: ainda não houve edição
    // humana para preservar.
    const { error } = await supabase
      .from("contas_receber")
      .insert({ ...linha, valor_contratado: linha.valor_cobrado });
    if (error) return { estado: "failed", motivo: error.message };
  }

  return {
    estado: "done",
    detalhe: clienteId ? undefined : "cobrança sem cliente vinculado — customer desconhecido aqui",
  };
}

async function aplicarAssinatura(
  supabase: SupabaseClient,
  env: EnvelopeAsaas
): Promise<Desfecho> {
  const mapeada = linhaDaAssinatura(env.objeto as Record<string, unknown>, env.event);
  if (!mapeada) return { estado: "failed", motivo: "assinatura sem id" };

  const { linha, vinculos, cicloDesconhecido } = mapeada;

  const clienteId = await resolverCliente(supabase, vinculos.customer);
  if (clienteId) linha.cliente_id = clienteId;

  const { data: existente } = await supabase
    .from("assinaturas")
    .select("id")
    .eq("asaas_subscription_id", linha.asaas_subscription_id as string)
    .maybeSingle();

  const { error } = existente
    ? await supabase.from("assinaturas").update(linha).eq("id", (existente as { id: string }).id)
    : await supabase.from("assinaturas").insert({
        ...linha,
        inicio:
          asaasParaDataLocal((env.objeto as Record<string, unknown>).dateCreated) ??
          new Date().toISOString().slice(0, 10),
      });

  if (error) return { estado: "failed", motivo: error.message };

  const avisos: string[] = [];
  if (cicloDesconhecido) {
    avisos.push(`ciclo "${cicloDesconhecido}" desconhecido — não gravado, o MRR não usa palpite`);
  }
  if (!clienteId) avisos.push("customer desconhecido aqui — assinatura sem cliente vinculado");
  return { estado: "done", detalhe: avisos.length ? avisos.join(" · ") : undefined };
}

async function aplicarNotaFiscal(
  supabase: SupabaseClient,
  env: EnvelopeAsaas
): Promise<Desfecho> {
  const mapeada = linhaDaNota(env.objeto as Record<string, unknown>, env.event);
  if (!mapeada) return { estado: "failed", motivo: "nota sem id" };

  const { linha, vinculos } = mapeada;

  const clienteId = await resolverCliente(supabase, vinculos.customer);
  if (clienteId) linha.cliente_id = clienteId;

  if (vinculos.payment) {
    const { data: conta } = await supabase
      .from("contas_receber")
      .select("id")
      .eq("asaas_payment_id", vinculos.payment)
      .maybeSingle();
    if (conta) linha.conta_receber_id = (conta as { id: string }).id;
  }

  const { data: existente } = await supabase
    .from("notas_fiscais")
    .select("id")
    .eq("asaas_invoice_id", linha.asaas_invoice_id as string)
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
 * `PAYMENT_RECEIVED` para a cobrança que o checkout gerou, e é esse evento que
 * carrega o `payment` com valor, vencimento e líquido. Criar a conta pelos
 * dois caminhos produziria duas linhas para o mesmo dinheiro.
 *
 * O que este evento sabe e nenhum outro sabe — que o link converteu — já está
 * guardado no payload cru da caixa de entrada.
 */
async function aplicarCheckout(_supabase: SupabaseClient, env: EnvelopeAsaas): Promise<Desfecho> {
  const o = env.objeto as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id) return { estado: "failed", motivo: "checkout sem id" };
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
