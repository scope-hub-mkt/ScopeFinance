import { beforeEach, describe, expect, it, vi } from "vitest";
import { BancoFake } from "./fakes/supabase-fake";
import { reconciliarServicos } from "@/lib/integracao/sincronia";

/**
 * **A reconciliação que também PODA** — `D-90` (30/08/2026).
 *
 * ⚠️ **O estado real que originou tudo isto**, medido em produção em
 * 30/08/2026:
 *
 * | | Catálogo da Dashboard | `servicos_espelho` aqui |
 * |---|---|---|
 * | serviços | 20 | 15 |
 * | produtos do CRM | 11 | **0** |
 * | linhas `[DEMO]` | 0 (apagadas lá) | **7** |
 * | linhas de teste | 0 | **3** |
 * | última escrita | — | 28/08 15:58 |
 *
 * O espelho só era escrito por evento empurrado, e evento **não cobre o que
 * foi apagado**. A tela `Serviços` daqui mostrava, sem nenhum aviso, um
 * catálogo de dois dias antes cheio de dado de demonstração.
 *
 * ⛔ **A poda é a metade perigosa desta função** — apagar por engano é o único
 * erro daqui que não se desfaz sozinho na próxima passada. Os casos abaixo
 * travam as três condições que a autorizam.
 */

let banco: BancoFake;

function novoBanco(seed: Record<string, Record<string, unknown>[]> = {}) {
  banco = new BancoFake({ servicos_espelho: [], ...seed }, {});
  return banco;
}

const GERADO_EM = "2026-08-30T12:00:00.000Z";

/** Um item como a Dashboard exporta em `/api/v1/servicos-catalogo`. */
const item = (over: Record<string, unknown> = {}) => ({
  servico_id: "s-1",
  nome: "Tráfego pago",
  slug: "trafego-pago",
  area: "Mídia",
  preco_tabela: 4000,
  custo: null,
  recorrencia: "recorrente",
  tipo_cobranca: "fixo",
  ativo: true,
  fonte: "dashboard",
  ...over,
});

/** Uma linha como o espelho a guarda. */
const espelhada = (over: Record<string, unknown> = {}) => ({
  id: "s-velho",
  nome: "[DEMO] Tráfego pago",
  slug: "demo-trafego-pago",
  ativo: true,
  fonte: "dashboard",
  sincronizado_em: "2026-08-28T15:58:00.000Z",
  ...over,
});

function respondeCom(corpo: Record<string, unknown>, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(corpo), { status }))
  );
}

const exportacao = (itens: Record<string, unknown>[], over: Record<string, unknown> = {}) => ({
  dados: itens,
  total: itens.length,
  completo: true,
  gerado_em: GERADO_EM,
  idade_s: 4,
  ...over,
});

beforeEach(() => {
  novoBanco();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.stubEnv("SCOPE_DASHBOARD_API_BASE", "https://dashboard-oficial-scope.vercel.app/api/v1");
  vi.stubEnv("SCOPE_DASHBOARD_API_KEY_OUT", "sk-teste");
});

describe("sem credencial, a reconciliação NOMEIA o que falta", () => {
  it("não tenta a rede e devolve o motivo com o nome das variáveis", async () => {
    vi.stubEnv("SCOPE_DASHBOARD_API_BASE", "");
    const espiao = vi.fn();
    vi.stubGlobal("fetch", espiao);

    const r = await reconciliarServicos(banco as never);

    expect(r.motivo).toContain("SCOPE_DASHBOARD_API_BASE");
    expect(espiao).not.toHaveBeenCalled();
  });
});

describe("conciliar — o que a Dashboard tem passa a existir aqui", () => {
  it("serviço novo entra no espelho com o MESMO id dos dois lados", async () => {
    respondeCom(exportacao([item()]));

    const r = await reconciliarServicos(banco as never);

    expect(r.criados).toBe(1);
    const s = banco.tabela("servicos_espelho")[0];
    // 📐 `ESTADO §8.4`: é o mesmo id que mantém cobrança já gravada apontando
    // para serviço válido.
    expect(s.id).toBe("s-1");
    expect(s.preco_tabela).toBe(4000);
    expect(s.fonte).toBe("dashboard");
  });

  it("serviço que já existia é atualizado, não duplicado", async () => {
    novoBanco({ servicos_espelho: [espelhada({ id: "s-1", nome: "Nome antigo" })] });
    respondeCom(exportacao([item({ preco_tabela: 4500 })]));

    const r = await reconciliarServicos(banco as never);

    expect(r.atualizados).toBe(1);
    expect(banco.tabela("servicos_espelho")).toHaveLength(1);
    expect(banco.tabela("servicos_espelho")[0].preco_tabela).toBe(4500);
    expect(banco.tabela("servicos_espelho")[0].nome).toBe("Tráfego pago");
  });

  it("INATIVO continua no espelho — a exportação o inclui de propósito", async () => {
    // Há cobrança histórica apontando para ele. Se a Dashboard o omitisse, a
    // poda apagaria justamente o que `servico.encerrado` preserva.
    respondeCom(exportacao([item({ ativo: false })]));

    await reconciliarServicos(banco as never);

    expect(banco.tabela("servicos_espelho")).toHaveLength(1);
    expect(banco.tabela("servicos_espelho")[0].ativo).toBe(false);
  });

  it("a idade do retrato é repassada — quem chama declara o que leu", async () => {
    respondeCom(exportacao([item()], { idade_s: 97 }));
    expect((await reconciliarServicos(banco as never)).retrato_idade_s).toBe(97);
  });
});

describe("podar — o defeito de 30/08/2026, e as três travas que o cercam", () => {
  it("apaga o que a Dashboard não tem mais, e diz o NOME do que apagou", async () => {
    // As 7 linhas `[DEMO]` e as 3 de teste. "3 podados" sem os nomes não
    // deixaria ninguém conferir se o que sumiu era o que devia sumir.
    novoBanco({
      servicos_espelho: [
        espelhada({ id: "demo-1", nome: "[DEMO] Tráfego pago" }),
        espelhada({ id: "probe-1", nome: "PROBE CRUD 1787878182687" }),
      ],
    });
    respondeCom(exportacao([item()]));

    const r = await reconciliarServicos(banco as never);

    expect(r.podados).toBe(2);
    expect(r.podados_nomes).toEqual(["[DEMO] Tráfego pago", "PROBE CRUD 1787878182687"]);
    expect(banco.tabela("servicos_espelho").map((s) => s.id)).toEqual(["s-1"]);
  });

  it("⛔ trava 1 — lista INCOMPLETA cancela a poda inteira", async () => {
    // Lista truncada pelo teto não é retrato do catálogo, é o começo dele.
    // Podar por ela apagaria serviço vivo, e isso não se desfaz.
    novoBanco({ servicos_espelho: [espelhada({ id: "s-outro" })] });
    respondeCom(exportacao([item()], { completo: false }));

    const r = await reconciliarServicos(banco as never);

    expect(r.podados).toBe(0);
    expect(r.motivo).toContain("INCOMPLETA");
    expect(banco.tabela("servicos_espelho")).toHaveLength(2);
  });

  it("⛔ trava 2 — o que chegou DEPOIS do retrato não é podado", async () => {
    // O retrato é uma foto de um instante. Serviço que chegou por evento
    // depois dela é informação mais nova, e uma foto velha não desfaz o que
    // veio depois. Sem esta regra o serviço seria criado pelo evento e
    // apagado pela poda — o ir-e-voltar que ninguém consegue reproduzir.
    novoBanco({
      servicos_espelho: [
        espelhada({ id: "s-recem-nascido", sincronizado_em: "2026-08-30T12:00:31.000Z" }),
      ],
    });
    respondeCom(exportacao([item()]));

    const r = await reconciliarServicos(banco as never);

    expect(r.podados).toBe(0);
    expect(banco.tabela("servicos_espelho").map((s) => s.id)).toContain("s-recem-nascido");
  });

  it("⛔ trava 3 — linha de outra fonte não é espelho desta lista", async () => {
    novoBanco({ servicos_espelho: [espelhada({ id: "s-local", fonte: "manual" })] });
    respondeCom(exportacao([item()]));

    const r = await reconciliarServicos(banco as never);

    expect(r.podados).toBe(0);
    expect(banco.tabela("servicos_espelho").map((s) => s.id)).toContain("s-local");
  });

  it("Dashboard fora do ar não poda nada — falha de leitura não é lista vazia", async () => {
    // Uma resposta 500 lida como "a Dashboard não tem serviço nenhum"
    // esvaziaria o espelho inteiro. É o pior erro possível aqui.
    novoBanco({ servicos_espelho: [espelhada({ id: "s-1" })] });
    respondeCom({ erro: "boom" }, 500);

    const r = await reconciliarServicos(banco as never);

    expect(r.motivo).toContain("500");
    expect(r.podados).toBe(0);
    expect(banco.tabela("servicos_espelho")).toHaveLength(1);
  });

  it("erro de rede também não poda — e o motivo chega inteiro", async () => {
    novoBanco({ servicos_espelho: [espelhada({ id: "s-1" })] });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fetch failed");
      })
    );

    const r = await reconciliarServicos(banco as never);

    expect(r.motivo).toBe("fetch failed");
    expect(banco.tabela("servicos_espelho")).toHaveLength(1);
  });
});
