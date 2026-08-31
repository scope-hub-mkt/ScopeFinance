#!/usr/bin/env node
/**
 * Varredura do Modo Privacidade — `RF-90`, `D-92`. **Mede, não olha.**
 *
 * ─── O defeito que este script existe para não repetir ────────────────────
 * Em 31/08/2026 a feature foi reportada como "auditada": três capturas, laudo
 * escrito, testes verdes. Duas das três capturas tinham sido abertas. A que
 * ficou fechada era o modo **Corporativo** — e nela havia uma regressão de
 * layout que eu mesmo tinha introduzido, no modo que todo mundo usa todo dia.
 *
 * Depois, a varredura de verdade achou **13 vazamentos** em telas que o laudo
 * dava por cobertas: nome de cliente dentro da coluna *Descrição*, dinheiro
 * na prosa gerada pela IA, o valor de cada fatia na legenda da rosca, o
 * ranque "Top clientes por receita" do ScopeFinance.
 *
 * ⚖️ **Olho humano em 50 capturas não é auditoria — é sorteio.** Aqui quem
 * julga é o navegador.
 *
 * ─── Como ele decide ──────────────────────────────────────────────────────
 * Para cada nó de texto da página em Modo Privacidade, sobe a árvore
 * procurando um ancestral com `filter` aplicado. Não achou → o texto está
 * **nítido**, e aí só falta perguntar se ele é sensível:
 *
 *   1. **Por padrão** — R$/US$, CNPJ, CPF, e-mail, telefone. Regex resolve.
 *   2. **Por identidade** — nome de cliente. Regex NÃO resolve, então a lista
 *      real vem do banco (service role) e vira busca literal. É isto que
 *      troca *"acho que cobri"* por *"conferido contra os 37 nomes que
 *      existem"*.
 *
 * ⛔ **O que ele NÃO prova.** Que o borrão é forte o bastante (isso é o
 * token `--sigilo-borrao`, medido à parte), nem que a tela ficou bonita —
 * ele afirma só que nenhum dado sensível chegou à tela sem máscara. E não
 * alcança `<option>` de `<select>` nativo, que o CSS da página não pinta:
 * está declarado no código, não ignorado em silêncio.
 *
 * Uso:  node --env-file=.env.local scripts/varredura-privacidade.mjs
 *       node --env-file=.env.local scripts/varredura-privacidade.mjs finance
 *
 * Sai **1** quando acha vazamento — serve de trava, não só de relatório.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/* ⚠️ O Playwright é dependência da Dashboard, não deste repositório —
   instalá-lo aqui só para a varredura acrescentaria ~300 MB a um projeto
   que não tem e2e. O caminho absoluto declara a dependência entre os dois
   repositórios em vez de escondê-la num `package.json`. */
const pw = await import(
  pathToFileURL(
    "../Dashboard_Oficial_Scope/node_modules/playwright/index.js"
  ).href
);
const chromium = pw.chromium ?? pw.default?.chromium;

const SISTEMA = process.argv.includes("finance") ? "finance" : "dashboard";

/**
 * `--modo=corporativo` — a **prova de que a trava trava**.
 *
 * Um varredor que devolve "limpo" pode estar certo ou pode estar cego, e de
 * fora os dois casos são idênticos. Rodando em Corporativo, onde nada
 * deveria estar mascarado, ele TEM de acusar em cheio. Zero achado nesse
 * modo significa que o medidor quebrou — não que a tela está limpa.
 *
 * É o `L-71` deste projeto aplicado à própria ferramenta: trava que erra o
 * alvo é pior que trava nenhuma, porque dá sensação de proteção.
 */
const MODO =
  process.argv.find((a) => a.startsWith("--modo="))?.slice(7) === "corporativo"
    ? "corporativo"
    : "privacidade";

const CFG = {
  dashboard: {
    raiz: "C:/Users/aikol/Documents/ScopeHub_Projects/Scope_projects/Dashboard_Oficial_Scope",
    porta: 4397,
    email: process.env.SHOT_EMAIL,
    senha: process.env.SHOT_SENHA,
    campos: { email: "#email", senha: "#senha" },
    tabelaClientes: "clientes",
    colunaNome: "nome",
    rotas: [
      "/", "/clientes", "/clientes/novo", "/clientes/duplicidades", "/clientes/excluidos",
      "/servicos", "/insights", "/marketing", "/vendas", "/comissionamento",
      "/quadros", "/prancheta", "/agenda", "/widgets", "/notificacoes", "/perfil",
      "/admin/api", "/admin/cargos", "/admin/contas-anuncio", "/admin/custos",
      "/admin/dados-demo", "/admin/dominios", "/admin/entradas", "/admin/fiscal",
      "/admin/gravacao", "/admin/ia", "/admin/integracoes", "/admin/usuarios",
      "/admin/webhooks-entrada",
    ],
  },
  finance: {
    raiz: "C:/Users/aikol/Documents/ScopeHub_Projects/Scope_projects/ScopeFinance",
    porta: 4396,
    email: process.env.FIN_EMAIL,
    senha: process.env.FIN_SENHA,
    campos: { email: 'input[type="email"]', senha: 'input[type="password"]' },
    tabelaClientes: "clientes",
    colunaNome: "nome",
    rotas: [
      "/", "/relatorios", "/clientes", "/servicos", "/revisao",
      "/vendas", "/vendas/avulsas", "/contratos", "/assinaturas",
      "/receber", "/pagar", "/bancos", "/cartoes",
      "/notas-fiscais", "/fiscal", "/integracao", "/alertas",
    ],
  },
}[SISTEMA];

const RAIZ = CFG.raiz;
const SAIDA = join(RAIZ, ".screenshots", "varredura");
mkdirSync(SAIDA, { recursive: true });

/* ─── 1. Os nomes reais, do banco ───────────────────────────────────── */
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
let nomesCliente = [];
try {
  const r = await fetch(
    `${SUPA_URL}/rest/v1/${CFG.tabelaClientes}?select=${CFG.colunaNome}&limit=2000`,
    { headers: { apikey: SUPA_KEY, Authorization: "Bearer " + SUPA_KEY } }
  );
  const linhas = await r.json();
  nomesCliente = (Array.isArray(linhas) ? linhas : [])
    .map((l) => String(l[CFG.colunaNome] ?? "").trim())
    /* Nomes de 1–3 letras dariam falso positivo em qualquer texto. */
    .filter((n) => n.length >= 5);
  console.log(`nomes de cliente carregados do banco: ${nomesCliente.length}`);
} catch (e) {
  console.error("⚠ não consegui ler os clientes do banco:", e.message);
}

/* ─── 1b. As rotas dinâmicas, com id real ───────────────────────────────
   ⚠️ Sem isto a varredura anuncia "todas as rotas" e mede só as estáticas —
   e a ficha do cliente, que é a tela mais carregada de identidade que
   existe, ficaria fora. É a mesma armadilha da trava que não mede. */
async function primeiroId(tabela, coluna = "id", filtro = "") {
  try {
    const r = await fetch(
      `${SUPA_URL}/rest/v1/${tabela}?select=${coluna}&limit=1${filtro}`,
      { headers: { apikey: SUPA_KEY, Authorization: "Bearer " + SUPA_KEY } }
    );
    const j = await r.json();
    return Array.isArray(j) && j[0] ? j[0][coluna] : null;
  } catch {
    return null;
  }
}

if (SISTEMA === "dashboard") {
  /* ⚠️ `clientes.id`, não `cliente_id`: a primeira versão pediu a coluna
     errada, recebeu null e SEGUIU — a ficha do cliente ficou fora da
     varredura que se anunciava completa. Agora a ausência é ruidosa. */
  const cli = await primeiroId("clientes", "id");
  const quadro = await primeiroId("quadros");
  const widget = await primeiroId("widgets");
  const tpl = await primeiroId("templates");
  const dinamicas = [
    cli && `/clientes/${cli}`,
    cli && `/insights?cliente=${cli}`,
    quadro && `/quadros/${quadro}`,
    widget && `/widgets/${widget}`,
    tpl && `/marketing/templates/${tpl}`,
  ].filter(Boolean);
  CFG.rotas.push(...dinamicas);
  console.log(`rotas dinâmicas resolvidas: ${dinamicas.length}`);
  for (const [rot, id] of [["/clientes/[id]", cli], ["/quadros/[id]", quadro], ["/widgets/[id]", widget], ["/marketing/templates/[id]", tpl]]) {
    if (!id) console.log(`  ⚠ ${rot} NÃO medida — nenhum registro para resolver o id`);
  }
} else {
  /* ⛔ O ScopeFinance NÃO tem ficha de cliente — `/clientes/<id>` devolve
     404, medido em 31/08/2026. A lista dinâmica é vazia, e isso é fato
     do sistema, não lacuna da varredura. */
  const dinamicas = [];
  CFG.rotas.push(...dinamicas);
  console.log(`rotas dinâmicas resolvidas: ${dinamicas.length}`);
}

/* ─── 2. O servidor ─────────────────────────────────────────────────── */
const NEXT_BIN = resolve(RAIZ, "node_modules", "next", "dist", "bin", "next");
const servidor = spawn(process.execPath, [NEXT_BIN, "start", "-p", String(CFG.porta)], {
  cwd: RAIZ,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, NODE_ENV: "production" },
});
const encerrar = () => servidor.killed || servidor.kill();
process.on("exit", encerrar);

const base = `http://127.0.0.1:${CFG.porta}`;
const limite = Date.now() + 60000;
while (Date.now() < limite) {
  try {
    const r = await fetch(base + "/login", { redirect: "manual" });
    if (r.status > 0) break;
  } catch {
    await new Promise((r) => setTimeout(r, 300));
  }
}

/* ─── 3. O medidor, dentro da página ────────────────────────────────── */
const MEDIR = (nomes) => {
  const PADROES = [
    ["dinheiro", /R\$\s?[\d.]+,\d{2}|US\$\s?[\d,]+\.\d{2}/],
    ["cnpj", /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/],
    ["cpf", /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/],
    ["email", /[\w.+-]+@[\w-]+\.[\w.]{2,}/],
    ["telefone", /\(\d{2}\)\s?\d{4,5}-?\d{4}/],
  ];

  /** Mascarado = ele ou qualquer ancestral tem `filter` diferente de none. */
  const mascarado = (no) => {
    for (let el = no.parentElement; el; el = el.parentElement) {
      const f = getComputedStyle(el).filter;
      if (f && f !== "none") return true;
    }
    return false;
  };

  const visivel = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
  };

  const achados = [];
  const it = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let no = it.nextNode(); no; no = it.nextNode()) {
    const txt = (no.textContent || "").trim();
    if (!txt) continue;
    const pai = no.parentElement;
    if (!pai || !visivel(pai)) continue;
    /* O <select> nativo não é pintável pelo CSS da página — declarado, não
       ignorado em silêncio. */
    if (pai.closest("select, option")) continue;
    if (mascarado(no)) continue;

    for (const [tipo, re] of PADROES) {
      const m = txt.match(re);
      if (m) achados.push({ tipo, trecho: m[0], contexto: txt.slice(0, 90), classe: pai.className });
    }
    for (const nome of nomes) {
      if (txt.includes(nome)) {
        achados.push({ tipo: "nome-de-cliente", trecho: nome, contexto: txt.slice(0, 90), classe: pai.className });
        break;
      }
    }
  }
  return achados;
};

/* ─── 4. A varredura ────────────────────────────────────────────────── */
const navegador = await chromium.launch();
const relatorio = [];
try {
  const ctx = await navegador.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
    colorScheme: "light",
  });
  await ctx.addInitScript((modo) => {
    try {
      localStorage.setItem("scope-tema", "claro");
      localStorage.setItem("scope-privacidade", modo);
    } catch {}
    document.documentElement.dataset.tema = "claro";
    document.documentElement.setAttribute("data-privacidade", modo);
  }, MODO);

  const page = await ctx.newPage();
  await page.goto(base + "/login", { waitUntil: "networkidle", timeout: 30000 });
  await page.fill(CFG.campos.email, CFG.email);
  await page.fill(CFG.campos.senha, CFG.senha);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }),
    page.click('button[type="submit"], .btn-p'),
  ]);
  console.log("sessão estabelecida\n");

  for (const rota of CFG.rotas) {
    try {
      const resp = await page.goto(base + rota, { waitUntil: "networkidle", timeout: 45000 });
      const status = resp ? resp.status() : 0;
      if (status >= 400) {
        relatorio.push({ rota, erro: `HTTP ${status}` });
        console.log(`  ${rota}  ⚠ HTTP ${status}`);
        continue;
      }
      await page.waitForTimeout(600);

      const modo = await page.evaluate(() =>
        document.documentElement.getAttribute("data-privacidade")
      );
      if (modo !== MODO) {
        relatorio.push({ rota, erro: `modo veio "${modo}", esperado "${MODO}"` });
        console.log(`  ${rota}  ⚠ o modo não pegou (${modo})`);
        continue;
      }

      const achados = await page.evaluate(MEDIR, nomesCliente);
      relatorio.push({ rota, achados });
      /* ⚠️ `?` e `=` são inválidos em nome de arquivo no Windows, e a
         exceção estourava DEPOIS da medição — o achado se perdia e a
         rota era contada como "não medida". Sanitizado. */
      const nome = (rota.replace(/[^\w-]/g, "_") || "_raiz").slice(0, 80);
      await page.screenshot({ path: join(SAIDA, `${SISTEMA}${nome}.png`), fullPage: true });
      console.log(
        `  ${rota.padEnd(28)} ${achados.length === 0 ? "limpo" : `${achados.length} NÍTIDO(S)`}`
      );
    } catch (e) {
      relatorio.push({ rota, erro: e.message.slice(0, 120) });
      console.log(`  ${rota}  ⚠ ${e.message.slice(0, 80)}`);
    }
  }
} finally {
  await navegador.close();
  encerrar();
}

writeFileSync(join(SAIDA, `relatorio-${SISTEMA}.json`), JSON.stringify(relatorio, null, 2));

/**
 * ⚖️ Isenções **declaradas**, com motivo. Sem elas o relatório nunca fecha em
 * zero, e um relatório que sempre acusa algo é um relatório que ninguém lê —
 * o sinal se perde no ruído conhecido.
 */
const ISENTOS = [
  {
    rota: "/marketing",
    trecho: "R$ 5,18",
    padrao: /^R\$ \d+,\d{2}$/,
    motivo: "cotação do dia (R$ por dólar) — preço público de câmbio, não número da Scope; escondê-la deixaria o custo convertido inconferível",
  },
];
for (const r of relatorio) {
  if (!r.achados) continue;
  r.isentos = r.achados.filter((a) =>
    ISENTOS.some((e) => e.rota === r.rota && e.padrao.test(a.trecho))
  );
  r.achados = r.achados.filter((a) => !r.isentos.includes(a));
}

const comVazamento = relatorio.filter((r) => r.achados?.length);
console.log(`\n═══ ${SISTEMA}: ${relatorio.length} rotas · ${comVazamento.length} com vazamento ═══`);
for (const r of comVazamento) {
  console.log(`\n${r.rota}`);
  const porTipo = {};
  for (const a of r.achados) (porTipo[a.tipo] ??= []).push(a);
  for (const [tipo, lista] of Object.entries(porTipo)) {
    console.log(`  ${tipo} (${lista.length}): ${lista.slice(0, 4).map((a) => `"${a.trecho}" [${a.classe || "sem classe"}]`).join(" · ")}`);
  }
}
const erros = relatorio.filter((r) => r.erro);
if (erros.length) {
  console.log(`\n⚠ ${erros.length} rota(s) não medida(s):`);
  for (const e of erros) console.log(`  ${e.rota} — ${e.erro}`);
}

/**
 * ⛔ Sai != 0 com vazamento OU com rota não medida. Uma rota que não abriu é
 * uma rota **não conferida**, e tratá-la como "limpa" seria a mesma mentira
 * que motivou este arquivo.
 */
if (MODO === "corporativo") {
  /* Aqui a lógica se INVERTE: em Corporativo nada deveria estar mascarado,
     então achado é sinal de saúde e silêncio é sinal de medidor cego. */
  console.log("");
  console.log(
    comVazamento.length
      ? `[ok] o medidor enxerga: ${comVazamento.length} rota(s) acusadas em Corporativo, como deve ser.`
      : "[FALHA] MEDIDOR CEGO - em Corporativo nada esta mascarado e ele nao acusou NADA."
  );
  process.exit(comVazamento.length ? 0 : 1);
}

if (comVazamento.length || erros.length) process.exit(1);
console.log("");
console.log("nenhum dado sensivel chegou a tela sem mascara.");
