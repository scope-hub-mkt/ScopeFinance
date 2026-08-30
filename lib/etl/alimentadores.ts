import "server-only";
import { createSupabaseAdmin } from "../supabase/admin";
import { comSnapshot, type Snapshot } from "./snapshot";

/**
 * Os alimentadores do ETL do ScopeFinance — `D-91` (30/08/2026).
 *
 * Cada função aqui é um contrato: *"esta tela é alimentada por este JSON, com
 * este prazo de validade"*. É o único lugar onde a decisão de chave e prazo
 * mora, para dois consumidores da mesma seção nunca divergirem.
 *
 * ⚖️ **Como escolher o TTL.** Pela pergunta *"quanto tempo de atraso este dado
 * tolera sem virar mentira?"* — nunca pela vontade de ir mais rápido. Cadastro
 * de cliente muda poucas vezes por dia e a tela **invalida na escrita**, então
 * o prazo é generoso sem custo de frescor.
 */

/** As colunas que a tela de Clientes realmente imprime — e só elas. */
export interface ClienteLista {
  id: string;
  nome: string;
  doc: string | null;
  email: string | null;
  tel: string | null;
  tipo: string | null;
  status: string | null;
  origem: string | null;
  endereco: string | null;
  obs: string | null;
  status_cadastro: string | null;
  sincronizado_em: string | null;
}

export interface DadosClientes {
  clientes: ClienteLista[];
  /** `true` quando a lista bateu o teto — a tela declara em vez de mentir. */
  truncado: boolean;
}

export const TTL_CLIENTES_S = 300;

/**
 * O teto existe porque lista sem teto é a dívida que derruba plano gratuito —
 * a mesma doutrina de `lerComTeto` na Dashboard (`PBI-049`). 2000 está ordens
 * de grandeza acima da carteira real (37 clientes em 30/08/2026), e o dia em
 * que não estiver, a tela **diz** que a lista está cortada.
 */
export const TETO_CLIENTES = 2000;

/**
 * **A lista de Clientes, triturada no back** — `D-91`.
 *
 * ⛔ **Antes disto o navegador recebia a tabela `clientes` inteira, com TODAS
 * as colunas, em toda navegação do sistema** — não só nesta tela: o
 * `StoreProvider` carregava as 10 tabelas em qualquer página. Aqui saem 12
 * colunas escolhidas, uma vez, do servidor.
 */
export function clientesViaEtl(): Promise<Snapshot<DadosClientes>> {
  return comSnapshot("clientes:lista", { ttlSegundos: TTL_CLIENTES_S }, async () => {
    const supabase = createSupabaseAdmin();
    // Pede uma linha a mais que o teto: é assim que se distingue "exatamente
    // o teto" de "cortado", sem uma segunda consulta de contagem.
    const { data } = await supabase
      .from("clientes")
      .select(
        "id, nome, doc, email, tel, tipo, status, origem, endereco, obs, status_cadastro, sincronizado_em"
      )
      .order("nome")
      .limit(TETO_CLIENTES + 1);

    const linhas = (data ?? []) as ClienteLista[];
    return {
      clientes: linhas.slice(0, TETO_CLIENTES),
      truncado: linhas.length > TETO_CLIENTES,
    };
  });
}
