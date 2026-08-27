/**
 * Verificação mecânica do sistema de design — ScopeFinance.
 *
 * ⚠️ PORTE da trava da Scope Dashboard (`scripts/lint-design.mjs` de lá),
 * feito em 26/08/2026. É a **Onda 0** do plano de refatoração
 * (`docs/AGENTE-IDENTIDADE-VISUAL.md` §B.4, na Dashboard): a trava vem ANTES
 * da tinta, de propósito — refatorar antes de instalar o guarda é pintar sem
 * cobrir o chão, e a 13ª divergência nasce durante a própria refatoração.
 *
 * A Dashboard e o ScopeFinance são repositórios SEPARADOS (`D-42`, `D-44` —
 * CEO e CFO, poder equivalente). Este arquivo é uma **cópia versionada**, não
 * um pacote compartilhado: é a decisão `B.3(a)`/`D-47`. O detector de deriva
 * (`scripts/deriva-tokens.mjs`, na Dashboard) é quem avisa quando os dois
 * blocos de token divergirem.
 *
 * Por que Node e não `grep`: no Windows o `npm` roda script pelo `cmd.exe`,
 * que não tem `grep` nem o `!` de negação do shell POSIX. Uma trava que não
 * roda é pior que trava nenhuma, porque dá a sensação de estar protegido.
 *
 * ⚠️ Este arquivo varre `.ts`/`.tsx` de `app/` e `components/`. O tema mora em
 * `app/globals.css`, que é a ÚNICA fonte legítima de hex — a mesma regra de
 * ouro da Dashboard. `_reference/` é o protótipo original e fica de fora.
 *
 * Escape: uma linha com o comentário `design-token-exempt` é ignorada. Use
 * só onde a API de destino não aceita `var(--…)`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const RAIZ = process.cwd();
const ALVOS = ["app", "components"];
const EXTENSOES = [".ts", ".tsx"];
const ESCAPE = "design-token-exempt";

const REGRAS = [
  {
    // 6 ou 8 dígitos apenas. `#4412` num texto de ajuda ("ticket #4412") não
    // é cor, e a regra que o pega perde a autoridade que deveria ter.
    nome: "hex literal",
    re: /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6})\b/,
    dica: "use var(--token) de app/globals.css",
  },
  {
    nome: "rgb()/rgba()",
    re: /\brgba?\s*\(/,
    dica: "use var(--token) de app/globals.css",
  },
  {
    nome: "hsl()/hsla()",
    re: /\bhsla?\s*\(/,
    dica: "use var(--token) de app/globals.css",
  },
  {
    nome: "paleta padrão de framework",
    re: /\b(?:bg|text|border|from|via|to)-(?:slate|gray|grey|zinc|neutral|stone|blue|indigo|violet|purple|emerald|teal|rose|amber)-\d{2,3}\b/,
    dica: "a paleta do projeto é a de globals.css; não existe slate/gray/blue aqui",
  },
  {
    nome: "sombra de framework",
    re: /\bshadow-(?:sm|md|lg|xl|2xl)\b/,
    dica: "use var(--sombra-1|2|3)",
  },
  {
    nome: "emoji decorativo em texto de UI",
    re: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u,
    dica: "sem emoji decorativo na interface",
    // Comentário é documentação: a regra vale para o que o usuário lê na
    // tela, não para o que o próximo dev lê no código.
    soComando: true,
    // O vocabulário de status do projeto (00-LEVANTAMENTO ✅.md) é sistema
    // documentado, não enfeite — e `comissionamento/page.tsx` mostra o 🔴
    // na tela de propósito, para o bloqueio não viver só no backlog.
    // Proibir isso seria a trava brigando com a disciplina que ela serve.
    permitidos: new Set([
      "🔴", "🟡", "🟢", "⚠", "⛔", "✅", "🚧", "⬜", "📝",
    ]),
  },
];

function arquivos(dir) {
  const saida = [];
  let entradas;
  try {
    entradas = readdirSync(dir);
  } catch {
    return saida;
  }
  for (const nome of entradas) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      if (nome === "node_modules" || nome === ".next") continue;
      saida.push(...arquivos(caminho));
    } else if (EXTENSOES.some((e) => nome.endsWith(e))) {
      saida.push(caminho);
    }
  }
  return saida;
}

/**
 * ─── TOKEN FANTASMA ───────────────────────────────────────────────────────
 * `var(--token)` apontando para um token que **não existe** em `globals.css`.
 *
 * ⚖️ **Por que esta regra nasceu, e por que ela é a mais importante daqui.**
 * A Onda 1 renomeou a camada inteira de token (`--green` → `--ok`, `--text2`
 * → `--tinta-2`, `--border` → `--linha`…) no CSS, e **23 `var()` em 9 arquivos
 * ficaram apontando para os nomes velhos**. CSS não reclama de propriedade
 * customizada inexistente: a declaração é simplesmente descartada, e o texto
 * renderiza **sem cor nenhuma**, herdando.
 *
 * ⛔ O detalhe que faz esta regra existir: aquilo passou por `lint:design`,
 * `tsc --noEmit`, **123 testes** e `next build` — todos verdes. Um lint de
 * design que só caça hex literal declara vitória exatamente quando a tela
 * está sem cor, porque `var(--green)` **não é um hex**. É a mesma família de
 * `L-64`: falha atrás de indicador verde.
 *
 * ⚠️ Interpolação é ignorada de propósito: `var(--s${i + 1})` monta o nome em
 * tempo de execução e não há como conferir estaticamente. O sinal é o `$`
 * logo depois do trecho casado.
 */
const CSS_TEMA = join(RAIZ, "app", "globals.css");
const TOKENS_DEFINIDOS = new Set(
  [
    ...readFileSync(CSS_TEMA, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .matchAll(/(--[a-z0-9-]+)\s*:/gi),
  ].map((m) => m[1])
);

function fantasmas(linha) {
  const achados = [];
  for (const m of linha.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
    const seguinte = linha[m.index + m[0].length];
    if (seguinte === "$") continue; // var(--s${i}) — nome montado em runtime
    if (!TOKENS_DEFINIDOS.has(m[1])) achados.push(m[1]);
  }
  // ⚠️ SEGUNDA CLASSE, e ela escapou da primeira: o nome do token vindo de uma
  // STRING dentro da interpolação —
  //     color: `var(${lucro >= 0 ? "--green" : "--red"})`
  // Ali o `var(` é seguido de `${`, então a varredura acima pula a linha
  // inteira, de propósito. Só que os dois nomes são literais estáticos e
  // estavam MORTOS: foi assim que dois `--green`/`--red` sobreviveram à
  // primeira correção em massa da Onda 1.
  for (const m of linha.matchAll(/["'](--[a-z0-9-]+)["']/g)) {
    if (!TOKENS_DEFINIDOS.has(m[1])) achados.push(m[1]);
  }
  return achados;
}

const faltas = [];
for (const alvo of ALVOS) {
  for (const arquivo of arquivos(join(RAIZ, alvo))) {
    const linhas = readFileSync(arquivo, "utf8").split(/\r?\n/);
    linhas.forEach((linha, i) => {
      if (linha.includes(ESCAPE)) return;

      for (const token of fantasmas(linha)) {
        faltas.push({
          arquivo: relative(RAIZ, arquivo).split(sep).join("/"),
          linha: i + 1,
          regra: "token fantasma",
          trecho: `var(${token})`,
          dica: `${token} não existe em app/globals.css — a declaração é descartada e a cor some`,
        });
      }

      const ehComentario = /^\s*(?:\/\/|\/\*|\*)/.test(linha);
      for (const regra of REGRAS) {
        if (regra.soComando && ehComentario) continue;
        let achou = linha.match(regra.re);
        if (achou && regra.permitidos) {
          // Varre a linha inteira: um glifo permitido não pode blindar um
          // decorativo que venha depois dele.
          achou = null;
          for (const ch of linha) {
            if (regra.re.test(ch) && !regra.permitidos.has(ch)) {
              achou = [ch];
              break;
            }
          }
        }
        if (achou) {
          faltas.push({
            arquivo: relative(RAIZ, arquivo).split(sep).join("/"),
            linha: i + 1,
            regra: regra.nome,
            trecho: achou[0],
            dica: regra.dica,
          });
          break;
        }
      }
    });
  }
}

if (faltas.length === 0) {
  console.log("lint:design — nenhuma violação em app/ e components/.");
  process.exit(0);
}

console.error(`lint:design — ${faltas.length} violação(ões):\n`);
for (const f of faltas) {
  console.error(`  ${f.arquivo}:${f.linha}  [${f.regra}] ${f.trecho}`);
  console.error(`      ${f.dica}`);
}
console.error(
  "\nFonte de verdade: app/globals.css (tema) e, na Dashboard, docs/DESIGN-TOKENS ✅.md." +
    "\nEscape legítimo: comentar a linha com `design-token-exempt`."
);
process.exit(1);
