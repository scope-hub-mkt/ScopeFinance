import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **A carga sob demanda** — `D-91` (30/08/2026).
 *
 * ⚠️ **O que era medido antes.** `StoreProvider` mora em `AppFrame`, e o
 * `useEffect` de montagem dele buscava `RESOURCE_KEYS` inteiro: **10
 * requisições, cada uma trazendo uma tabela completa com todas as colunas, em
 * TODA navegação** — inclusive em `/bancos`, que usa uma só, e em
 * `/integracao`, que não usa nenhuma.
 *
 * O dono nomeou o defeito: *"o /clientes do ScopeFinance continua baixando
 * tudo no navegador"*, contra o pedido de *"exportar o json clean tratado com
 * ETL e sendo consumido pelo front, deixando ele extremamente leve"*.
 *
 * ⛔ **Estes casos são estruturais de propósito.** O custo não aparece em
 * asserção de valor — ele aparece na aba de rede. O que dá para travar é a
 * forma: o provider não busca sozinho, e toda tela que lê `db` declara o que
 * precisa. Uma tela que esqueça a declaração renderiza lista vazia sem erro
 * nenhum — exatamente o tipo de falha silenciosa que só um teste de forma pega.
 */

const RAIZ = process.cwd();
const STORE = readFileSync(join(RAIZ, "lib", "store.tsx"), "utf8");

function telasQueLeemDb(): string[] {
  const achados: string[] = [];
  const andar = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const completo = join(dir, e.name);
      if (e.isDirectory()) andar(completo);
      else if (/\.tsx?$/.test(e.name)) {
        const src = readFileSync(completo, "utf8");
        if (/\bdb\.[a-z_]+/.test(src) && src.includes("useStore")) achados.push(completo);
      }
    }
  };
  andar(join(RAIZ, "app"));
  andar(join(RAIZ, "components"));
  return achados;
}

describe("o provider não carrega mais o catálogo inteiro sozinho", () => {
  it("⛔ `RESOURCE_KEYS` não é mais o argumento de uma busca de montagem", () => {
    // A forma antiga era `const keys = key ? [key] : RESOURCE_KEYS;` dentro do
    // `refresh` chamado por um `useEffect` sem argumento. Hoje o fallback é o
    // que a sessão PEDIU.
    expect(STORE).toContain("[...pedidos.current]");
    expect(STORE).not.toMatch(/keys\s*=\s*key\s*\?\s*\[key\]\s*:\s*RESOURCE_KEYS/);
  });

  it("expõe `garantir` e o gancho `useRecursos`", () => {
    expect(STORE).toContain("export function useRecursos");
    expect(STORE).toMatch(/garantir:\s*\(\.\.\.keys: ResourceKey\[\]\)/);
  });

  it("`loading` nasce falso — tela sem recurso não fica presa no spinner", () => {
    // Nascer `true` deixaria `/integracao`, que não lê `db`, carregando para
    // sempre: ninguém chamaria `garantir` para desligar.
    expect(STORE).toMatch(/useState\(false\);\s*\n?\s*\/\/|const \[loading, setLoading\] = useState\(false\)/);
  });

  it("não sobrou `useEffect` de montagem buscando tudo no provider", () => {
    const corpoProvider = STORE.split("export function StoreProvider")[1] ?? "";
    const ateOFim = corpoProvider.split("export function useStore")[0] ?? "";
    // O único `useEffect` do arquivo é o de `useRecursos`, que fica DEPOIS de
    // `useStore` — dentro do provider não pode haver nenhum.
    expect(ateOFim).not.toContain("useEffect(");
  });
});

describe("toda tela que lê `db` declara o que precisa", () => {
  const telas = telasQueLeemDb();

  it("há telas para conferir — senão este teste passa vazio", () => {
    // ♻️ Era 10 até 02/09/2026, quando `/cartoes` deixou de ler `db`: os
    // cartões passaram a ser lidos do Asaas por Server Component, e a tabela
    // `cartoes` (vazia desde sempre) foi derrubada. ⚖️ O piso continua sendo
    // um sentinela contra a guarda vazia — ele desce quando uma tela sai do
    // navegador, que é a direção certa, e nunca por uma tela ter esquecido
    // de declarar o que lê.
    expect(telas.length).toBeGreaterThanOrEqual(9);
  });

  it("⛔ nenhuma lê `db` sem chamar `useRecursos`", () => {
    const mudas = telas
      .filter((p) => !readFileSync(p, "utf8").includes("useRecursos("))
      .map((p) => p.replace(RAIZ, "").replace(/\\/g, "/"));
    expect(
      mudas,
      `estas telas leem db e não pedem nada — renderizariam vazias: ${mudas.join(", ")}`
    ).toEqual([]);
  });

  it("cada tela pede pelo menos os recursos que lê", () => {
    const faltas: string[] = [];
    for (const p of telas) {
      const src = readFileSync(p, "utf8");
      const lidos = new Set([...src.matchAll(/\bdb\.([a-z_]+)/g)].map((m) => m[1]));
      const bloco = /useRecursos\(([^)]*)\)/.exec(src)?.[1] ?? "";
      const pedidos = new Set([...bloco.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
      for (const l of lidos) {
        if (!pedidos.has(l)) faltas.push(`${p.replace(RAIZ, "").replace(/\\/g, "/")} lê db.${l}`);
      }
    }
    expect(faltas, `recursos lidos sem serem pedidos: ${faltas.join(" · ")}`).toEqual([]);
  });
});

describe("a tela de Clientes saiu do navegador", () => {
  it("`/clientes` é componente de servidor e lê o retrato do ETL", () => {
    const page = readFileSync(join(RAIZ, "app", "(app)", "clientes", "page.tsx"), "utf8");
    expect(page).not.toContain('"use client"');
    expect(page).toContain("clientesViaEtl");
  });

  it("a ilha de cliente NÃO recarrega a tabela pelo navegador", () => {
    // Depois de gravar, quem repõe a lista é o servidor (`router.refresh()`).
    // `useStore().refresh("clientes")` traria a tabela inteira de volta —
    // desfazendo, na escrita, o que a leitura acabou de economizar.
    const ilha = readFileSync(
      join(RAIZ, "app", "(app)", "clientes", "ClientesTabela.tsx"),
      "utf8"
    );
    expect(ilha).toContain("router.refresh()");
    expect(ilha).not.toMatch(/refresh\(\s*"clientes"\s*\)/);
  });

  it("o alimentador escolhe colunas e declara o teto", () => {
    const alim = readFileSync(join(RAIZ, "lib", "etl", "alimentadores.ts"), "utf8");
    // `select("*")` aqui devolveria a tabela inteira de novo, só que pelo
    // servidor — o mesmo desperdício com outro endereço.
    expect(alim).not.toContain('.select("*")');
    expect(alim).toContain("TETO_CLIENTES");
    expect(alim).toContain("truncado");
  });
});
