import "server-only";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Credenciais de integração pela tela — a outra ponta do `RF-58` da Dashboard.
 *
 * ⚖️ **Por que o ScopeFinance ganhou isto agora.** A decisão de 25/08/2026 foi
 * *"variável de ambiente + painel de status"*, e ela era razoável: construir
 * uma tabela de credenciais só para exibir presença seria peso sem retorno. O
 * que mudou é o uso — rotacionar uma chave passou a custar um **deploy**, e
 * deploy é exatamente o que não se quer no meio de um incidente de credencial.
 * O dono pediu, em 28/08/2026, **Gerenciar e Testar nas duas frentes**.
 *
 * ⚠️ **Degrada em vez de quebrar.** Enquanto a migração
 * `supabase/2026-08-28-credenciais-integracao.sql` não rodar, a tabela não
 * existe — e este módulo **cai no ambiente** em silêncio, exatamente como
 * antes. A tela, essa sim, diz em voz alta que a edição está indisponível: o
 * código degrada, a interface avisa. Fingir que salvou seria pior que recusar.
 */

export type OrigemCredencial = "ui" | "ambiente" | "nao_configurada";

/** A regra de resolução, pura para ser testável: UI > ambiente > nada. */
export function resolverCredencial(
  daUi: string | null | undefined,
  doAmbiente: string | null | undefined
): { valor: string | null; origem: OrigemCredencial } {
  if (daUi != null && daUi !== "") return { valor: daUi, origem: "ui" };
  if (doAmbiente != null && doAmbiente !== "") return { valor: doAmbiente, origem: "ambiente" };
  return { valor: null, origem: "nao_configurada" };
}

/** Prefixo visível + máscara — o valor inteiro nunca volta para a tela. */
export function mascarar(valor: string): string {
  if (valor.length <= 4) return "••••";
  return `${valor.slice(0, 4)}…${"•".repeat(Math.min(12, valor.length - 4))}`;
}

/** A migração já rodou? A tela precisa saber para não prometer o que não faz. */
export async function tabelaDisponivel(): Promise<boolean> {
  try {
    const supabase = createSupabaseAdmin();
    const { error } = await supabase.from("integracao_credenciais").select("chave").limit(1);
    return !error;
  } catch {
    return false;
  }
}

async function linhasDaUi(): Promise<Map<string, { valor: string; atualizado_em: string }>> {
  try {
    const supabase = createSupabaseAdmin();
    const { data } = await supabase
      .from("integracao_credenciais")
      .select("chave, valor, atualizado_em")
      .limit(200);
    return new Map(
      (data ?? []).map((l) => [
        l.chave as string,
        { valor: l.valor as string, atualizado_em: l.atualizado_em as string },
      ])
    );
  } catch {
    // ⛔ Banco inacessível NÃO derruba a integração: cai no ambiente. Uma
    // credencial é o último lugar onde falha de leitura pode virar
    // indisponibilidade em cascata.
    return new Map();
  }
}

/**
 * Resolve UMA credencial — tela primeiro, ambiente como fallback.
 *
 * É a função que todo consumidor deve usar no lugar de `process.env.X`.
 */
export async function credencial(chave: string): Promise<string | null> {
  const daUi = (await linhasDaUi()).get(chave)?.valor;
  return resolverCredencial(daUi, process.env[chave]).valor;
}

export interface EstadoCredencial {
  chave: string;
  origem: OrigemCredencial;
  /** Mascarado sempre que houver valor — nem o não-secreto precisa vazar. */
  exibicao: string | null;
  atualizado_em: string | null;
}

/** O estado de um conjunto de chaves, para a tela desenhar a tabela. */
export async function estadoDasCredenciais(chaves: string[]): Promise<EstadoCredencial[]> {
  const ui = await linhasDaUi();
  return chaves.map((chave) => {
    const linha = ui.get(chave);
    const r = resolverCredencial(linha?.valor, process.env[chave]);
    return {
      chave,
      origem: r.origem,
      exibicao: r.valor === null ? null : mascarar(r.valor),
      atualizado_em: linha?.atualizado_em ?? null,
    };
  });
}

export type Resultado = { ok: true } | { ok: false; erro: string };

const NOME_VALIDO = /^[A-Z][A-Z0-9_]*$/;

export async function salvarCredencial(
  chave: string,
  valor: string,
  usuarioId: string | null
): Promise<Resultado> {
  if (!NOME_VALIDO.test(chave)) {
    return { ok: false, erro: "Nome inválido — use MAIÚSCULAS, dígitos e sublinhado." };
  }
  if (!valor.trim()) return { ok: false, erro: "Valor vazio. Para limpar, use Remover." };

  if (!(await tabelaDisponivel())) {
    return {
      ok: false,
      erro:
        "A tabela integracao_credenciais ainda não existe neste banco. Aplique " +
        "supabase/2026-08-28-credenciais-integracao.sql — até lá, o valor se troca no ambiente da Vercel.",
    };
  }

  const supabase = createSupabaseAdmin();
  const { error } = await supabase.from("integracao_credenciais").upsert(
    {
      chave,
      valor: valor.trim(),
      atualizado_por: usuarioId,
      atualizado_em: new Date().toISOString(),
    },
    { onConflict: "chave" }
  );
  if (error) return { ok: false, erro: error.message };
  return { ok: true };
}

/** Remove a linha — a resolução volta ao ambiente, sem deploy. */
export async function removerCredencial(chave: string): Promise<Resultado> {
  if (!(await tabelaDisponivel())) {
    return { ok: false, erro: "Tabela de credenciais ainda não existe neste banco." };
  }
  const supabase = createSupabaseAdmin();
  const { error } = await supabase.from("integracao_credenciais").delete().eq("chave", chave);
  return error ? { ok: false, erro: error.message } : { ok: true };
}

/**
 * Move o valor de uma chave para outra.
 *
 * ⛔ Recusa se o destino já tem valor: sobrescrever em silêncio destruiria uma
 * credencial que alguém preencheu, e o sintoma apareceria longe daqui.
 *
 * ⛔ O valor **não trafega**: quem move é o servidor. Mandar o segredo ao
 * cliente só para ele devolvê-lo com outro nome seria expô-lo à toa.
 */
export async function renomearCredencial(
  de: string,
  para: string,
  usuarioId: string | null
): Promise<Resultado> {
  const destino = para.trim();
  if (destino === de) return { ok: true };
  if (!NOME_VALIDO.test(destino)) {
    return { ok: false, erro: "Nome inválido — use MAIÚSCULAS, dígitos e sublinhado." };
  }
  if (!(await tabelaDisponivel())) {
    return { ok: false, erro: "Tabela de credenciais ainda não existe neste banco." };
  }

  const supabase = createSupabaseAdmin();
  const { data: origem } = await supabase
    .from("integracao_credenciais")
    .select("valor")
    .eq("chave", de)
    .maybeSingle();
  if (!origem?.valor) return { ok: false, erro: `${de} não tem valor preenchido pela tela.` };

  const { data: ocupado } = await supabase
    .from("integracao_credenciais")
    .select("chave")
    .eq("chave", destino)
    .maybeSingle();
  if (ocupado) {
    return {
      ok: false,
      erro: `${destino} já tem valor. Remova-o antes — sobrescrever apagaria uma credencial que alguém preencheu.`,
    };
  }

  const { error } = await supabase.from("integracao_credenciais").insert({
    chave: destino,
    valor: origem.valor,
    atualizado_por: usuarioId,
    atualizado_em: new Date().toISOString(),
  });
  if (error) return { ok: false, erro: error.message };

  await supabase.from("integracao_credenciais").delete().eq("chave", de);
  return { ok: true };
}
