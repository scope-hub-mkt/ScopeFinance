"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { apagarSnapshots } from "@/lib/etl/snapshot";

/**
 * Força a releitura dos dados de uma tela — gêmeo do `RF-103` da Dashboard.
 *
 * ⚖️ **Pedido do dono, em 03/09/2026:** *"o botão de poder atualizar os dados
 * 'forçadamente' em caso de atraso percebido"* — e, na mensagem seguinte,
 * *"confira se esse tipo de otimização foi implementada também no scope
 * finance"*.
 *
 * ⚠️ **Derruba as DUAS camadas.** O cache do Next e o retrato do ETL são
 * caches diferentes; derrubar um só produz o sintoma "mandei atualizar e não
 * mudou", que é pior que não ter o botão. É a mesma lição que a Dashboard já
 * tinha aprendido com `invalidarTela`.
 */

/** Rota → prefixos de retrato que a alimentam. Rota fora daqui é recusada. */
const PREFIXOS_POR_ROTA: Record<string, string[]> = {
  "/": ["painel:", "contas_receber:", "contas_pagar:"],
  "/clientes": ["clientes:"],
  "/servicos": ["servicos_espelho:"],
  "/servicos/entregues": ["contrato_servicos:", "contratos:", "contas_receber:"],
  "/receber": ["contas_receber:"],
  "/receber/manuais": ["contas_receber:"],
  "/pagar": ["contas_pagar:"],
  "/contratos": ["contratos:", "contrato_servicos:"],
  "/assinaturas": ["assinaturas:"],
  "/relatorios": ["painel:", "contas_receber:"],
  "/usuarios": ["usuarios:"],
};

export async function acaoAtualizarAgora(
  rota: string
): Promise<{ ok: boolean; erro?: string }> {
  try {
    await requireUser();

    // ⛔ A rota vem do cliente: sem esta conferência, um valor arbitrário
    // chegaria a `revalidatePath`.
    const prefixos = PREFIXOS_POR_ROTA[rota];
    if (!prefixos) {
      return { ok: false, erro: `Rota "${rota}" não tem retrato para atualizar.` };
    }

    revalidatePath(rota);
    await Promise.all(prefixos.map((p) => apagarSnapshots(p)));

    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "Não foi possível atualizar." };
  }
}
