import "server-only";
import { createSupabaseAdmin } from "../supabase/admin";

/**
 * Motor de retratos do ScopeFinance — `D-91` (30/08/2026).
 *
 * ⚖️ **Portado da Dashboard de propósito, não reinventado.** Lá ele existe
 * desde `RNF-25`/`D-81` e já provou a forma; escrever um segundo mecanismo
 * daria duas semânticas de "retrato datado" no mesmo ecossistema, e a
 * divergência apareceria no dia em que alguém comparasse a idade de dois
 * números lado a lado.
 *
 * **O problema que ele resolve aqui é maior que o de lá.** Até 30/08/2026,
 * toda página deste sistema baixava **10 tabelas inteiras no navegador** —
 * `StoreProvider` monta em `AppFrame`, o `useEffect` dispara `/api/clientes`,
 * `/api/contratos`, `/api/assinaturas`… e o browser recebe cada tabela
 * completa, em toda navegação, inclusive nas telas que usam uma só delas.
 *
 * **A forma: Extract-Transform-Load com leitura stale-while-revalidate.** O
 * JSON pronto de exibição vira uma linha em `etl_snapshots`, e a tela passa a
 * custar **uma consulta por chave primária**. Vencido o prazo, a tela ainda
 * responde na hora com o retrato anterior e a atualização roda fora do caminho
 * da resposta.
 *
 * ⛔ **Ausência da tabela NÃO derruba nada.** Aplicar SQL aqui é ato do dono
 * (a senha de banco não vive neste repositório). Sem a tabela, `comSnapshot`
 * degrada para o comportamento antigo — produzir a cada leitura — sem nenhum
 * erro visível. É a mesma escolha da Dashboard, e é o que permite o código
 * subir antes da migração.
 */

/** O retrato que a tela recebe: os dados MAIS a honestidade sobre eles. */
export interface Snapshot<T> {
  dados: T;
  /** ISO — quando este JSON foi produzido. A tela declara isso. */
  gerado_em: string;
  /** Idade em segundos no momento da leitura. */
  idade_s: number;
  /**
   * - `gerado_agora` — não havia retrato utilizável; produziu na hora.
   * - `snapshot` — retrato dentro do prazo; nenhuma consulta de origem rodou.
   * - `snapshot_vencido` — retrato vencido servido mesmo assim; a atualização
   *   ficou rodando fora do caminho da resposta.
   */
  origem: "gerado_agora" | "snapshot" | "snapshot_vencido";
}

export interface OpcoesSnapshot {
  /** Por quanto tempo o retrato vale sem ninguém reproduzi-lo. */
  ttlSegundos: number;
  /**
   * Versão do FORMATO do JSON. Suba quando a forma mudar: versão diferente da
   * gravada é tratada como ausência, nunca como dado a interpretar.
   */
  versao?: number;
}

interface LinhaSnapshot {
  dados: unknown;
  gerado_em: string;
  versao: number;
}

/**
 * Produções em voo, por chave — o que impede a estourada de manada: dez
 * navegações simultâneas sobre o mesmo retrato frio produzem UMA vez e as dez
 * recebem o mesmo resultado. Por instância serverless, e é o suficiente: a
 * segunda instância no pior caso produz uma vez a mais, nunca dez.
 */
const emVoo = new Map<string, Promise<unknown>>();

async function gravar(chave: string, versao: number, dados: unknown, duracaoMs: number) {
  try {
    const supabase = createSupabaseAdmin();
    await supabase
      .from("etl_snapshots")
      .upsert(
        { chave, dados, versao, gerado_em: new Date().toISOString(), duracao_ms: duracaoMs },
        { onConflict: "chave" }
      );
  } catch {
    // Tabela ausente ou banco fora: o retrato não persiste, a tela funciona.
    // Falhar aqui transformaria uma otimização em indisponibilidade.
  }
}

function produzirEGravar<T>(
  chave: string,
  versao: number,
  produzir: () => Promise<T>
): Promise<T> {
  const jaEmVoo = emVoo.get(chave) as Promise<T> | undefined;
  if (jaEmVoo) return jaEmVoo;

  const t0 = Date.now();
  const p = produzir()
    .then(async (dados) => {
      await gravar(chave, versao, dados, Date.now() - t0);
      return dados;
    })
    .finally(() => emVoo.delete(chave));

  emVoo.set(chave, p);
  return p;
}

/**
 * A porta única do ETL: devolve o retrato da chave, produzindo só quando
 * preciso — e nunca no caminho da resposta quando existe retrato para servir.
 */
export async function comSnapshot<T>(
  chave: string,
  opcoes: OpcoesSnapshot,
  produzir: () => Promise<T>
): Promise<Snapshot<T>> {
  const versao = opcoes.versao ?? 1;

  let linha: LinhaSnapshot | null = null;
  try {
    const supabase = createSupabaseAdmin();
    const { data } = await supabase
      .from("etl_snapshots")
      .select("dados, gerado_em, versao")
      .eq("chave", chave)
      .maybeSingle();
    linha = (data as LinhaSnapshot | null) ?? null;
  } catch {
    linha = null;
  }

  if (linha && Number(linha.versao) === versao && linha.gerado_em) {
    const dados = linha.dados as T;
    const idadeMs = Date.now() - new Date(linha.gerado_em).getTime();

    if (idadeMs <= opcoes.ttlSegundos * 1000 && idadeMs >= 0) {
      return {
        dados,
        gerado_em: linha.gerado_em,
        idade_s: Math.round(idadeMs / 1000),
        origem: "snapshot",
      };
    }

    // Vencido: responde JÁ com o que há, e atualiza fora do caminho.
    void produzirEGravar(chave, versao, produzir).catch(() => {});
    return {
      dados,
      gerado_em: linha.gerado_em,
      idade_s: Math.max(0, Math.round(idadeMs / 1000)),
      origem: "snapshot_vencido",
    };
  }

  // Frio (sem retrato, sem tabela, ou versão de formato diferente): produz já.
  const dados = await produzirEGravar(chave, versao, produzir);
  return {
    dados,
    gerado_em: new Date().toISOString(),
    idade_s: 0,
    origem: "gerado_agora",
  };
}

/**
 * Apaga retratos por prefixo (ou todos) — a invalidação de quem SABE que a
 * origem mudou. Nunca lança: invalidação é conveniência; o TTL é a garantia.
 */
export async function apagarSnapshots(prefixo?: string): Promise<void> {
  try {
    const supabase = createSupabaseAdmin();
    await supabase
      .from("etl_snapshots")
      .delete()
      .like("chave", prefixo ? `${prefixo}%` : "%");
  } catch {
    /* ver `gravar` */
  }
}
