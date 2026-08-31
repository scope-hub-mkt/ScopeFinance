import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ATTR_PRIVACIDADE,
  CHAVE_PRIVACIDADE,
  MODO_PADRAO,
  SCRIPT_PRIVACIDADE,
  alternarModo,
  normalizarModo,
  rotuloAcao,
} from "@/lib/privacidade";

/**
 * `RF-90` — Modo Corporativo × Modo Privacidade no ScopeFinance (`D-92`).
 *
 * ⚠️ **Estes casos são estáticos de propósito, e o motivo é uma restrição
 * real, não preferência.** A suíte daqui roda em `node`, sem jsdom e sem
 * `@testing-library` — `vitest.config.ts` inclui só `tests/**\/*.test.ts`.
 * Trazer as duas dependências para montar um botão seria a decisão certa se
 * o risco morasse na renderização; ele mora em outro lugar.
 *
 * O modo é uma **regra de CSS acionada por um atributo**. As três coisas que
 * podem quebrá-lo em silêncio são:
 *
 *   1. o botão escrever num atributo/chave que o CSS não lê — a tela *parece*
 *      protegida e não está, que é o pior modo de falha desta feature;
 *   2. o script inline sair do `<head>` — e o saldo real piscar antes do
 *      borrão, com a tela já compartilhada;
 *   3. dinheiro novo entrar na tela **sem passar por `<Dinheiro>`** — nada
 *      quebra, nada fica vermelho, e o valor aparece nítido no meio de uma
 *      tabela borrada.
 *
 * As três são verificáveis lendo arquivo. A quarta — "o borrão de fato
 * borra" — não é verificável nem com jsdom, porque ele não aplica folha de
 * estilo; quem responde por ela é a captura de tela (item 7 do DoD).
 */

const RAIZ = process.cwd();
const CSS = readFileSync(join(RAIZ, "app", "globals.css"), "utf8");

describe("RF-90 · o contrato do modo", () => {
  it("lixo guardado cai no padrão, nunca num terceiro estado", () => {
    expect(normalizarModo("privacidade")).toBe("privacidade");
    expect(normalizarModo("corporativo")).toBe("corporativo");
    expect(normalizarModo("PRIVACIDADE")).toBe(MODO_PADRAO);
    expect(normalizarModo(null)).toBe(MODO_PADRAO);
    expect(normalizarModo("")).toBe(MODO_PADRAO);
  });

  it("é interruptor, não caminho só de ida", () => {
    expect(alternarModo("corporativo")).toBe("privacidade");
    expect(alternarModo(alternarModo("corporativo"))).toBe("corporativo");
  });

  it("o rótulo diz a AÇÃO, não o estado — é o que vai no aria-label", () => {
    expect(rotuloAcao("corporativo")).toContain("Entrar no Modo Privacidade");
    expect(rotuloAcao("privacidade")).toContain("Sair do Modo Privacidade");
  });

  it("abre em Corporativo — o padrão é decisão, não descuido (`D-92`)", () => {
    expect(MODO_PADRAO).toBe("corporativo");
  });
});

describe("RF-90 · o CSS lê exatamente o que o botão escreve", () => {
  it("o seletor da folha casa com o atributo e o valor do contrato", () => {
    expect(CSS).toContain(`[${ATTR_PRIVACIDADE}="privacidade"]`);
  });

  it("a máscara alcança as classes de valor que as telas emitem", () => {
    const bloco = CSS.slice(CSS.indexOf("MODO PRIVACIDADE"));
    for (const classe of [".sigilo", ".met-v", ".delta", ".gr-valor"]) {
      expect(bloco, `a §Modo Privacidade deixou de cobrir ${classe}`).toContain(classe);
    }
    expect(bloco).toContain("blur(var(--sigilo-borrao))");
  });

  it("o raio do borrão é relativo ao corpo do texto, nunca em pixel", () => {
    /* Em pixel, o raio calibrado para o KPI de 32px deixaria legível o
       dígito de 12,5px da tabela — o vazamento com cara de proteção. */
    const m = CSS.match(/--sigilo-borrao:\s*([^;]+);/);
    expect(m, "o token --sigilo-borrao sumiu do :root").not.toBeNull();
    expect(m![1].trim()).toMatch(/em$/);
  });
});

describe("RF-90 · o modo pinta antes do React", () => {
  it("o script inline aplica a escolha guardada sem nenhum componente montado", () => {
    const atributos: Record<string, string> = {};
    const escopo = {
      localStorage: { getItem: (k: string) => (k === CHAVE_PRIVACIDADE ? "privacidade" : null) },
      document: {
        documentElement: {
          setAttribute: (k: string, v: string) => {
            atributos[k] = v;
          },
        },
      },
    };
    new Function("localStorage", "document", SCRIPT_PRIVACIDADE)(
      escopo.localStorage,
      escopo.document
    );

    expect(atributos[ATTR_PRIVACIDADE]).toBe("privacidade");
  });

  it("storage bloqueado não deixa a página sem atributo nenhum", () => {
    const atributos: Record<string, string> = {};
    const storage = {
      getItem() {
        throw new Error("storage bloqueado neste contexto");
      },
    };
    const doc = {
      documentElement: {
        setAttribute: (k: string, v: string) => {
          atributos[k] = v;
        },
      },
    };
    new Function("localStorage", "document", SCRIPT_PRIVACIDADE)(storage, doc);

    expect(atributos[ATTR_PRIVACIDADE]).toBe(MODO_PADRAO);
  });

  it("o layout carrega esse script — sem ele o valor real pisca antes do borrão", () => {
    const layout = readFileSync(join(RAIZ, "app", "layout.tsx"), "utf8");
    expect(layout).toContain("SCRIPT_PRIVACIDADE");
  });

  it("a topbar está montada na casca — sem ela não há como ligar o modo", () => {
    const frame = readFileSync(join(RAIZ, "components", "AppFrame.tsx"), "utf8");
    expect(frame).toContain("<TopBar />");
    const topbar = readFileSync(join(RAIZ, "components", "TopBar.tsx"), "utf8");
    expect(topbar).toContain("BotaoPrivacidade");
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   § dinheiro fora de cobertura
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * ⚖️ **A guarda que fecha a feature.** Este sistema é financeiro de ponta a
 * ponta: quase todo número de toda tela é dinheiro, e havia **39 pontos**
 * escrevendo `fmt(valor)` direto em JSX quando o modo nasceu, cada um com a
 * sua casca (`<td className="c-orange">`, `<strong>`, `<span className="tiny">`).
 *
 * Marcar a casca de cada um funcionaria hoje e falharia no próximo: a marca é
 * invisível na revisão, e o valor novo nasce nítido sem nada ficar vermelho.
 * Com `<Dinheiro>`, **escrever dinheiro é marcar dinheiro** — e esta guarda é
 * o que mantém isso verdadeiro.
 *
 * ⛔ Ela não olha para `lib/`: `fmt()` continua existindo para quem precisa da
 * string (um `title`, uma concatenação, um CSV), e ali não há elemento para
 * mascarar. O que ela proíbe é `{fmt(x)}` **dentro de JSX**.
 */
function telas(): string[] {
  const saida: string[] = [];
  const andar = (dir: string) => {
    for (const nome of readdirSync(dir)) {
      const alvo = join(dir, nome);
      if (statSync(alvo).isDirectory()) andar(alvo);
      else if (nome.endsWith(".tsx")) saida.push(alvo);
    }
  };
  andar(join(RAIZ, "app"));
  andar(join(RAIZ, "components"));
  return saida;
}

describe("RF-90 · dinheiro novo nasce coberto", () => {
  it("nenhuma tela escreve {fmt(...)} em JSX fora de <Dinheiro>", () => {
    const descobertos: string[] = [];

    for (const caminho of telas()) {
      const rel = relative(RAIZ, caminho).split("\\").join("/");
      /* `ui.tsx` é o único lugar legítimo: é ele que DEFINE `<Dinheiro>`. */
      if (rel.endsWith("components/ui.tsx")) continue;

      readFileSync(caminho, "utf8")
        .split(/\r?\n/)
        .forEach((linha, i) => {
          if (!/\{\s*fmt\(/.test(linha)) return;
          descobertos.push(`${rel}:${i + 1} → ${linha.trim().slice(0, 90)}`);
        });
    }

    expect(
      descobertos,
      "Dinheiro sem máscara no Modo Privacidade. Troque `{fmt(x)}` por " +
        "`<Dinheiro v={x} />`:\n" + descobertos.join("\n")
    ).toEqual([]);
  });
});
