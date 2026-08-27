import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clienteDoCrm, ehGatilho, type PayloadCrm } from "./contrato";

/**
 * O que a entrada do CRM escreve no ScopeFinance — §2.3, §3.4 e §3.5 do plano.
 *
 * ⚖️ **A seção mais importante do plano inteiro está aqui**, e é a que, se
 * errar, não tem conserto: duplicata de cliente com nota fiscal emitida **não
 * se desfaz**. Por isso as três chaves do §2.1 são usadas cada uma no seu
 * papel, e nunca uma no lugar da outra:
 *
 *   `documento_principal` → "esta empresa já é nossa cliente?"  (identidade)
 *   `crm_id`              → "este card já foi processado?"      (anti-reprocessamento)
 *   `asaas_customer_id`   → "que cadastro do gateway é este?"   (vínculo)
 *
 * ⛔ **`crm_id` não deduplica identidade.** Dois cards diferentes da mesma
 * empresa têm `crm_id` diferentes e **são o mesmo cliente**. Deduplicar só por
 * ele produz exatamente a duplicata que o documento existe para impedir.
 */

export type ResultadoCrm =
  | { estado: "ignorado"; motivo: string }
  | { estado: "aplicado"; acao: "criado" | "atualizado"; cliente_id: string; status_cadastro: string }
  | { estado: "conflito"; cliente_id_existente: string; documento: string; motivo: string }
  | { estado: "erro"; motivo: string };

/**
 * Registra o evento na caixa de entrada e aplica.
 *
 * Grava **antes** de processar, como as outras duas caixas deste sistema: se o
 * processamento quebrar, o evento continua ali para ser reprocessado. Perder o
 * evento porque o processamento falhou seria trocar um erro visível por um
 * silêncio.
 *
 * ⚠️ Diferente da caixa do Asaas, aqui **não** há deduplicação por id de
 * evento: o mesmo card pode entrar legitimamente várias vezes (reenvio manual
 * do `RF-CRM-04`, card que sai da coluna e volta). Quem garante que isso não
 * cria um segundo cliente é o índice único de `crm_id` (§3.5), não a caixa.
 */
export async function aplicarEventoCrm(
  supabase: SupabaseClient,
  payload: PayloadCrm,
  bruto: unknown
): Promise<ResultadoCrm> {
  const { data: registro } = await supabase
    .from("crm_webhook_events")
    .insert({
      id_externo_crm: payload.id_externo_crm,
      event_type: payload.evento,
      payload: bruto,
    })
    .select("id")
    .single();

  const registroId = (registro as { id: string } | null)?.id ?? null;
  const desfecho = await decidir(supabase, payload);

  if (registroId) {
    const estado =
      desfecho.estado === "aplicado"
        ? "done"
        : desfecho.estado === "ignorado"
          ? "ignored"
          : desfecho.estado === "conflito"
            ? "conflito"
            : "failed";
    await supabase
      .from("crm_webhook_events")
      .update({
        process_status: estado,
        processed_at: new Date().toISOString(),
        process_error: desfecho.estado === "aplicado" ? null : descreverDesfecho(desfecho),
        cliente_id: desfecho.estado === "aplicado" ? desfecho.cliente_id : null,
      })
      .eq("id", registroId);
  }

  return desfecho;
}

function descreverDesfecho(d: ResultadoCrm): string | null {
  if (d.estado === "ignorado" || d.estado === "erro") return d.motivo;
  if (d.estado === "conflito") return d.motivo;
  return null;
}

async function decidir(supabase: SupabaseClient, p: PayloadCrm): Promise<ResultadoCrm> {
  // ⛔ `RN-02`: só a entrada em `Validação Contratual` dispara. Card em outra
  // coluna é recebido de propósito e não vira cliente — ligar qualquer coluna
  // criaria cliente a partir de prospect, e das 38 negociações do CRM apenas
  // 12 estão ganhas.
  if (!ehGatilho(p.funil.coluna)) {
    return {
      estado: "ignorado",
      motivo: `coluna "${p.funil.coluna ?? "(vazia)"}" não é o gatilho — só "Validação Contratual" cria cliente`,
    };
  }

  // ♻️ §3.6 / `P-03`: `lead.revertido` **não desfaz nada**. O cliente já pode
  // ter cobrança gerada e nota emitida em segundos; apagar em cascata
  // destruiria histórico fiscal que não pertence ao CRM. O efeito é anotação e
  // alerta na ficha — nunca exclusão, nunca cancelamento de cobrança.
  if (p.evento === "lead.revertido") {
    const { data } = await supabase
      .from("clientes")
      .select("id")
      .eq("crm_id", p.id_externo_crm)
      .maybeSingle();
    return {
      estado: "ignorado",
      motivo: data
        ? `lead revertido no CRM — o cliente ${(data as { id: string }).id} PERMANECE (§3.6). Cancelar cobrança é ato humano aqui.`
        : "lead revertido no CRM e nenhum cliente correspondente aqui",
    };
  }

  const linha = clienteDoCrm(p);

  // 1. Este card já foi processado? Então é atualização, não cliente novo.
  const { data: porCrm } = await supabase
    .from("clientes")
    .select("id, status_cadastro")
    .eq("crm_id", p.id_externo_crm)
    .maybeSingle();

  if (porCrm) {
    const alvo = porCrm as { id: string; status_cadastro: string };
    // ⛔ Se o documento agora chega e já pertence a OUTRO cadastro, isto virou
    // conflito — mesmo sendo o mesmo card. Deixar passar sobrescreveria a
    // identidade de outra empresa.
    if (p.documento) {
      const colisao = await colidente(supabase, p.documento, alvo.id);
      if (colisao) return conflito(colisao, p.documento);
    }
    const { error } = await supabase.from("clientes").update(linha).eq("id", alvo.id);
    if (error) return { estado: "erro", motivo: error.message };
    return {
      estado: "aplicado",
      acao: "atualizado",
      cliente_id: alvo.id,
      status_cadastro: String(linha.status_cadastro),
    };
  }

  // 2. Esta empresa já é nossa cliente, por outro caminho?
  if (p.documento) {
    const { data: porDoc } = await supabase
      .from("clientes")
      .select("id, nome, crm_id")
      .eq("documento_principal", p.documento)
      .maybeSingle();

    if (porDoc) {
      const alvo = porDoc as { id: string; nome: string; crm_id: string | null };
      // ⛔ O documento pertence a um cadastro que JÁ tem outro card do CRM.
      // Dois cards distintos reivindicando a mesma identidade é decisão
      // humana (§2.4) — o sistema não escolhe qual verdade apagar.
      if (alvo.crm_id && alvo.crm_id !== p.id_externo_crm) {
        return conflito(alvo, p.documento);
      }
      // Mesmo documento, sem card ainda: é o cliente que nasceu na Dashboard,
      // no financeiro ou pelo gateway. Ganha o vínculo do CRM, não uma segunda
      // linha — é o `ESTADO §8.3` funcionando.
      const { error } = await supabase
        .from("clientes")
        .update({ ...linha, status_cadastro: "efetivo" })
        .eq("id", alvo.id);
      if (error) return { estado: "erro", motivo: error.message };
      return {
        estado: "aplicado",
        acao: "atualizado",
        cliente_id: alvo.id,
        status_cadastro: "efetivo",
      };
    }
  }

  // 3. Cliente novo. Sem documento ele nasce PROVISÓRIO — e o §2.3 é o que
  // torna isso mais que um rótulo: provisório não cria customer no Asaas, não
  // emite NFS-e, não entra em faturamento/MRR nem em Metas e Comissão, e
  // APARECE na Dashboard marcado, porque esconder seria pior.
  const { data: criado, error } = await supabase
    .from("clientes")
    .insert(linha)
    .select("id")
    .single();

  if (error) {
    // 23505 no índice de documento é a colisão que escapou da consulta acima
    // por concorrência. O índice é a trava real; esta é a tradução dela.
    if (error.code === "23505") {
      const colisao = await colidentePorDocumento(supabase, p.documento);
      if (colisao && p.documento) return conflito(colisao, p.documento);
    }
    return { estado: "erro", motivo: error.message };
  }

  return {
    estado: "aplicado",
    acao: "criado",
    cliente_id: (criado as { id: string }).id,
    status_cadastro: String(linha.status_cadastro),
  };
}

async function colidente(
  supabase: SupabaseClient,
  documento: string,
  exceto: string
): Promise<{ id: string; nome: string } | null> {
  const { data } = await supabase
    .from("clientes")
    .select("id, nome")
    .eq("documento_principal", documento)
    .neq("id", exceto)
    .maybeSingle();
  return (data as { id: string; nome: string } | null) ?? null;
}

async function colidentePorDocumento(
  supabase: SupabaseClient,
  documento: string | null
): Promise<{ id: string; nome: string } | null> {
  if (!documento) return null;
  const { data } = await supabase
    .from("clientes")
    .select("id, nome")
    .eq("documento_principal", documento)
    .maybeSingle();
  return (data as { id: string; nome: string } | null) ?? null;
}

function conflito(alvo: { id: string; nome: string }, documento: string): ResultadoCrm {
  return {
    estado: "conflito",
    cliente_id_existente: alvo.id,
    documento,
    motivo:
      `o documento ${documento} já pertence ao cliente ${alvo.id} ("${alvo.nome}"). ` +
      `Nada foi fundido: qual dos dois cadastros vale é decisão humana (§2.4).`,
  };
}

// ════════════════════════════════════════════════════════════════════
//  As filas do §2.3 e §2.4 — sem elas, o estado provisório é só um rótulo
// ════════════════════════════════════════════════════════════════════

export interface ClienteEmRevisao {
  id: string;
  nome: string;
  documento_principal: string | null;
  status_cadastro: string;
  origem: string;
  crm_id: string | null;
  email: string | null;
  tel: string | null;
  created_at: string;
  /** Há quantos dias espera. É o que transforma a fila em urgência visível. */
  dias_esperando: number;
}

/**
 * Os cadastros que esperam alguém — provisórios e em conflito.
 *
 * ⚖️ **Por que esta consulta existe, e ordenada pelo mais antigo.** Sem uma
 * tela, o estado provisório vira *"um cemitério silencioso de cadastros pela
 * metade"* — que é o modo de falha que este projeto já pagou para aprender
 * duas vezes. Um estado que bloqueia cobrança e nota fiscal e que ninguém vê é
 * pior que não ter estado nenhum: o comercial acha que vendeu, o financeiro não
 * cobra, e não há onde olhar para descobrir por quê.
 */
export async function clientesEmRevisao(
  supabase: SupabaseClient,
  estado?: "provisorio" | "em_conflito"
): Promise<ClienteEmRevisao[]> {
  let consulta = supabase
    .from("clientes")
    .select("id, nome, documento_principal, status_cadastro, origem, crm_id, email, tel, created_at")
    .order("created_at", { ascending: true })
    .limit(500);

  consulta = estado
    ? consulta.eq("status_cadastro", estado)
    : consulta.in("status_cadastro", ["provisorio", "em_conflito"]);

  const { data } = await consulta;
  const agora = Date.now();

  return ((data ?? []) as Array<Omit<ClienteEmRevisao, "dias_esperando">>).map((c) => ({
    ...c,
    dias_esperando: Math.floor((agora - new Date(c.created_at).getTime()) / 86_400_000),
  }));
}
