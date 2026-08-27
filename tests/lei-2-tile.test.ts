import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { lerDelta, pctDelta } from "@/lib/kpi";

/**
 * ─── Onda 4 — a Lei 2 no tile ─────────────────────────────────────────────
 *
 * `docs/AGENTE-IDENTIDADE-VISUAL.md` §B.4 (na Dashboard) descreve o tile como
 * cinco camadas: rótulo · valor 32px · delta com direção e período nomeado ·
 * forma · **procedência**. O diagnóstico `B-7` media o componente daqui como
 * *"um número sozinho"*.
 *
 * ⚖️ **O que este arquivo prova, e o que ele deliberadamente NÃO prova.**
 * Não há jsdom nem testing-library neste repositório, e instalar os dois para
 * conferir marcação seria pagar caro pela prova mais fraca. As duas coisas que
 * realmente podem estar erradas não são a árvore de DOM:
 *
 *   1. **A cor do delta**, que é regra de negócio disfarçada de estilo —
 *      pintar de verde uma despesa que subiu é o painel afirmando o contrário
 *      do que aconteceu, e nada quebra.
 *   2. **A procedência**, que é `RNF-19` e o item que mais some quando alguém
 *      acrescenta um KPI com pressa.
 */

describe("Lei 2 — o delta lê significado, não direção", () => {
  it("subir é bom quando o KPI é receita", () => {
    expect(lerDelta(12.5).classe).toBe("delta-bom");
    expect(lerDelta(12.5).icone).toBe("ti-arrow-up-right");
    expect(lerDelta(12.5).sinal).toBe("+");
  });

  it("subir é RUIM quando o KPI é despesa — a inversão é o motivo do parâmetro", () => {
    expect(lerDelta(12.5, false).classe).toBe("delta-ruim");
    // A direção continua sendo para cima: o ícone conta o FATO, a cor conta o
    // julgamento. Trocar o ícone junto esconderia que a despesa subiu.
    expect(lerDelta(12.5, false).icone).toBe("ti-arrow-up-right");
  });

  it("descer é bom quando o KPI é despesa", () => {
    expect(lerDelta(-8, false).classe).toBe("delta-bom");
    expect(lerDelta(-8, false).icone).toBe("ti-arrow-down-right");
    expect(lerDelta(-8, false).sinal).toBe("−");
  });

  it("descer é ruim quando o KPI é receita", () => {
    expect(lerDelta(-8).classe).toBe("delta-ruim");
  });

  it("zero é NEUTRO nos dois regimes — não mudou não é vitória", () => {
    expect(lerDelta(0).classe).toBe("delta-neutro");
    expect(lerDelta(0, false).classe).toBe("delta-neutro");
    expect(lerDelta(0).icone).toBe("ti-minus");
    expect(lerDelta(0).sinal).toBe("");
  });

  it("o número sai sem sinal e em pt-BR — quem assina é lerDelta", () => {
    expect(pctDelta(-12.5)).toBe("12,5");
    expect(pctDelta(3)).toBe("3");
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   A catraca de procedência.

   ⚠️ O TypeScript já recusa `ItemMetrica` sem `fonte`. Esta guarda existe
   para o que o compilador NÃO alcança: um `as ItemMetrica`, um `any` no meio
   do caminho, ou um KPI montado fora do tipo. É a mesma doutrina da catraca
   de consumo da Dashboard (`PBI-049`) — não confie em disciplina, conte.
   ───────────────────────────────────────────────────────────────────────── */

function fontesTsx(dir: string, achados: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) fontesTsx(p, achados);
    else if (nome.endsWith(".tsx")) achados.push(p);
  }
  return achados;
}

describe("RNF-19 — nenhum KPI sem procedência", () => {
  const arquivos = fontesTsx("app").filter((p) =>
    readFileSync(p, "utf8").includes("MetricGrid")
  );

  it("existe pelo menos uma tela com KPI — senão a guarda não guarda nada", () => {
    expect(arquivos.length).toBeGreaterThan(0);
  });

  it.each(arquivos)("%s: todo item de KPI declara fonte", (arquivo) => {
    const src = readFileSync(arquivo, "utf8");
    // Um item de KPI é reconhecível por `l: "…"` — o rótulo. Cada um deles
    // precisa de um `fonte:` no mesmo arquivo, um para um.
    const rotulos = src.match(/\bl:\s*"/g)?.length ?? 0;
    const fontes = src.match(/\bfonte:\s*"/g)?.length ?? 0;
    expect(rotulos).toBeGreaterThan(0);
    expect(fontes).toBe(rotulos);
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   Regressões das Ondas 2 e 3 que o `lint:design` não enxerga.

   ⚖️ `lint:design` varre `.ts`/`.tsx` atrás de literal proibido; o CSS do
   tema é a fonte legítima e por isso **não é varrido**. Então nada impede
   alguém de reintroduzir caixa alta ou o glow laranja direto no
   `globals.css` — que é exatamente de onde eles saíram.
   ───────────────────────────────────────────────────────────────────────── */

describe("Ondas 2 e 3 — o que saiu não volta pelo CSS", () => {
  const css = readFileSync("app/globals.css", "utf8");

  it("B-1: nenhuma regra de caixa alta", () => {
    expect(css.match(/text-transform\s*:\s*uppercase/g)).toBeNull();
  });

  it("B-3: nenhum glow laranja — o valor exato que o §2.4 manda sair", () => {
    expect(css).not.toContain("0 0 40px");
    expect(css.match(/drop-shadow\(0 0 \d+px/g)).toBeNull();
  });

  it("Onda 3: os dois temas existem, e o claro é o padrão", () => {
    expect(css).toContain("color-scheme: light");
    expect(css).toContain('[data-tema="escuro"]');
    // A escolha explícita precisa ganhar do sistema nas DUAS direções, senão
    // quem escolhe claro num sistema escuro não consegue.
    expect(css).toContain(':root:not([data-tema="claro"]):not([data-tema="escuro"])');
  });

  it("B-13: borda laranja não veste superfície neutra", () => {
    // `--marca-borda` continua legítima em superfície TINGIDA (o badge de
    // acento). O que saiu foi o contorno laranja em sidebar, modal, cartão,
    // toast e caixa de login — cromo de tema escuro que no claro vira
    // decoração disputando com o dado (Lei 6).
    for (const seletor of [".sb{", ".mbox{", ".toast{", ".login-box{"]) {
      const i = css.indexOf(seletor);
      expect(i, `${seletor} sumiu do CSS`).toBeGreaterThan(-1);
      const regra = css.slice(i, css.indexOf("}", i));
      expect(regra, `${seletor} voltou a usar borda de marca`).not.toContain("--marca-borda");
    }
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   Onda 6 — a pílula de status para de depender de capitalização.
   ───────────────────────────────────────────────────────────────────────── */

describe("Onda 6 — Badge indexa por status, não por capitalização", () => {
  it("acha a cor independente da caixa", async () => {
    const { classeBadge } = await import("@/components/ui");
    for (const escrita of ["Pago", "pago", "PAGO", "PaGo"]) {
      expect(classeBadge(escrita), escrita).toBe("bdg-g");
    }
  });

  it("estado crítico não cai no cinza neutro", async () => {
    const { classeBadge } = await import("@/components/ui");
    // O defeito real: `VENCIDO` vindo do banco em caixa alta caía no bdg-x e
    // um atraso de pagamento ficava com cara de estado neutro.
    expect(classeBadge("VENCIDO")).toBe("bdg-r");
    expect(classeBadge("Inadimplente")).toBe("bdg-r");
  });

  it("status desconhecido continua caindo no neutro, e isso é o certo", () => {
    // Inventar cor para status não mapeado seria pior: melhor cinza honesto
    // que verde adivinhado.
    return import("@/components/ui").then(({ classeBadge }) => {
      expect(classeBadge("Coisa nova")).toBe("bdg-x");
      expect(classeBadge("")).toBe("bdg-x");
    });
  });
});
