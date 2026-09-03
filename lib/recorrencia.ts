import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { competencia, today } from "./format";
import { avancar, lerCiclos, resolverCiclo } from "./ciclos";

export interface RecorrenciaResult {
  geradas: number;
  receber: number;
  pagar: number;
  detalhes: {
    assinatura_id: string;
    tabela: "contas_receber" | "contas_pagar";
    competencia: string;
    valor: number;
  }[];
}

const MAX_CICLOS = 60; // trava de segurança contra loop em assinaturas muito antigas

function isDuplicate(err: { code?: string; message?: string }): boolean {
  return err.code === "23505" || (err.message || "").includes("duplicate key");
}

/**
 * Motor de recorrência das assinaturas.
 *
 * Para cada assinatura ATIVA cuja `proximo_venc` <= data de referência:
 *  - direcao = 'receber' → cria uma cobrança em CONTAS A RECEBER
 *  - direcao = 'pagar'   → cria uma conta em CONTAS A PAGAR
 *  - avança `proximo_venc` pelo ciclo CADASTRADO (`RF-63`), caindo nos três
 *    embutidos quando não há cadastro
 *
 * Idempotente: a constraint UNIQUE(assinatura_id, competencia) evita duplicar
 * a conta do mesmo período, então rodar duas vezes não gera cobranças repetidas.
 */
export async function gerarRecorrencias(
  supabase: SupabaseClient,
  ref: string = today()
): Promise<RecorrenciaResult> {
  const result: RecorrenciaResult = { geradas: 0, receber: 0, pagar: 0, detalhes: [] };

  // `RF-63` — os ciclos vêm do cadastro, e são lidos UMA vez por execução.
  // Ler por assinatura faria N consultas para responder sempre o mesmo; ler
  // aqui também garante que todas as assinaturas de uma mesma rodada usem a
  // mesma definição, mesmo que alguém edite um ciclo no meio dela.
  const ciclos = await lerCiclos(supabase);

  const { data: assinaturas, error } = await supabase
    .from("assinaturas")
    .select("*")
    .eq("status", "Ativa")
    .not("proximo_venc", "is", null)
    .lte("proximo_venc", ref);
  if (error) throw new Error(error.message);
  if (!assinaturas?.length) return result;

  for (const a of assinaturas) {
    let prox: string = a.proximo_venc;
    let guard = 0;

    while (prox && prox <= ref && guard < MAX_CICLOS) {
      guard++;
      if (a.fim && prox > a.fim) break;
      const comp = competencia(prox);

      if (a.direcao === "pagar") {
        const { error: insErr } = await supabase.from("contas_pagar").insert({
          fornecedor: a.fornecedor || a.descricao || "Assinatura",
          assinatura_id: a.id,
          descricao: a.descricao || `Assinatura ${a.fornecedor || ""}`.trim(),
          valor: a.valor,
          vencimento: prox,
          categoria: a.categoria || "Software/SaaS",
          status: "Pendente",
          conta_id: a.conta_id,
          competencia: comp,
        });
        if (!insErr) {
          result.geradas++;
          result.pagar++;
          result.detalhes.push({ assinatura_id: a.id, tabela: "contas_pagar", competencia: comp, valor: a.valor });
        } else if (!isDuplicate(insErr)) {
          throw new Error(insErr.message);
        }
      } else {
        const { error: insErr } = await supabase.from("contas_receber").insert({
          cliente_id: a.cliente_id,
          assinatura_id: a.id,
          descricao: a.descricao || `Assinatura ${a.plano || "CRM"}`,
          valor: a.valor,
          vencimento: prox,
          status: "Pendente",
          forma_pagamento: "PIX",
          conta_id: a.conta_id,
          competencia: comp,
          // ⛔ **A recorrência INTERNA não é o gateway** (`RF-93`, `D-100`).
          //
          // Esta linha nasce de uma assinatura cadastrada aqui, não de uma
          // `subscription` do Asaas — o Asaas cobra as dele sozinho e as
          // devolve pelo webhook. Sem esta marcação a parcela entraria no
          // faturamento e atravessaria a ponte como se o dinheiro tivesse
          // entrado, quando ninguém pagou nada ainda.
          //
          // ⚖️ Explícito mesmo coincidindo com o default da coluna: o default
          // protege contra o esquecimento, e a linha escrita declara a
          // intenção. Se o default mudar um dia, este caminho continua certo.
          origem_lancamento: "manual",
        });
        if (!insErr) {
          result.geradas++;
          result.receber++;
          result.detalhes.push({ assinatura_id: a.id, tabela: "contas_receber", competencia: comp, valor: a.valor });
        } else if (!isDuplicate(insErr)) {
          throw new Error(insErr.message);
        }
      }

      prox = avancar(prox, resolverCiclo(a.ciclo, ciclos));
    }

    if (prox !== a.proximo_venc) {
      await supabase.from("assinaturas").update({ proximo_venc: prox }).eq("id", a.id);
    }
  }

  return result;
}
