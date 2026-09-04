/**
 * Conduz o backfill do Asaas, etapa por etapa, página por página.
 *
 * ⚖️ A inteligência mora na rota (`/api/integracao/backfill-asaas`), porque é
 * lá que ela compartilha `lib/asaas/mapear.ts` com o webhook — uma tradução
 * só. Este arquivo é o **condutor**: chama a rota na ordem certa, retoma pelo
 * `proximo_offset` e soma o placar. Ele não sabe nada sobre Asaas.
 *
 * ⛔ **Seco por padrão.** Sem `--gravar`, nada é escrito: a passada lê tudo,
 * decide tudo, reporta os conflitos e não toca no banco. É a única forma de
 * saber o que a importação faria com dado real **antes** de ela fazer.
 *
 * Uso:
 *   node scripts/backfill-asaas.mjs                    # seco, contra produção
 *   node scripts/backfill-asaas.mjs --gravar           # grava
 *   node scripts/backfill-asaas.mjs --etapa=cobrancas  # só uma etapa
 *   node scripts/backfill-asaas.mjs --base=http://localhost:3000
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (nome, padrao = null) => {
  const a = args.find((x) => x.startsWith(`--${nome}=`));
  return a ? a.slice(nome.length + 3) : padrao;
};

const GRAVAR = args.includes("--gravar");
const BASE = flag("base", "https://finance.scopecompany.com.br");
const SO_ETAPA = flag("etapa");

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

if (!env.CRON_SECRET) {
  console.error("backfill: CRON_SECRET ausente no .env.local — a rota é protegida.");
  process.exit(1);
}

// ⚖️ A ordem não é arbitrária: as três do meio resolvem `cliente_id` por
// vínculo já gravado, então `clientes` precisa vir antes. `religar` fecha,
// pegando o que o webhook tenha gravado órfão durante a importação.
const ETAPAS = [
  "clientes",
  "assinaturas",
  "cobrancas",
  "notas",
  // Depois das cobranças de propósito: esta etapa descobre quem importar
  // lendo as linhas que ficaram sem dono (o Asaas omite cliente excluído da
  // listagem, e 13 deles têm cobrança real aqui).
  "clientes-orfaos",
  "religar",
];

const num = (n) => String(n).padStart(4, " ");

async function chamar(etapa, offset) {
  const url =
    `${BASE}/api/integracao/backfill-asaas` +
    `?etapa=${etapa}&offset=${offset}&seco=${GRAVAR ? "false" : "true"}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    signal: AbortSignal.timeout(120_000),
  });
  const corpo = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${corpo.slice(0, 300)}`);
  return JSON.parse(corpo);
}

console.log(
  `\nbackfill do Asaas — ${GRAVAR ? "⚠️  GRAVANDO" : "passada SECA (nada será escrito)"}`
);
console.log(`destino: ${BASE}\n`);

const conflitos = [];
let houveErro = false;

for (const etapa of ETAPAS) {
  if (SO_ETAPA && etapa !== SO_ETAPA) continue;

  const total = { lidos: 0, criados: 0, vinculados: 0, atualizados: 0, ignorados: 0 };
  let offset = 0;
  let paginas = 0;

  try {
    for (;;) {
      const r = await chamar(etapa, offset);
      paginas++;

      if (etapa === "religar") {
        console.log(
          `religar      contas=${num(r.contas)} assinaturas=${num(r.assinaturas)} notas=${num(r.notas)}`
        );
        break;
      }

      for (const k of Object.keys(total)) total[k] += r[k] ?? 0;
      if (r.conflitos?.length) conflitos.push(...r.conflitos);

      if (!r.tem_mais || r.proximo_offset === null) break;
      offset = r.proximo_offset;
      // Teto de segurança: paginação que não avança viraria laço infinito
      // batendo na API do Asaas.
      if (paginas > 200) throw new Error("paginação não terminou em 200 páginas — algo está errado");
    }

    if (etapa !== "religar") {
      console.log(
        `${etapa.padEnd(12)} lidos=${num(total.lidos)} criados=${num(total.criados)} ` +
          `vinculados=${num(total.vinculados)} atualizados=${num(total.atualizados)} ` +
          `ignorados=${num(total.ignorados)}`
      );
    }
  } catch (e) {
    houveErro = true;
    console.error(`${etapa.padEnd(12)} ✗ ${e.message}`);
  }
}

if (conflitos.length) {
  // ⛔ Conflito não é ruído a esconder no fim de um log: é uma decisão humana
  // pendente (§2.4). Cada linha aqui é uma pessoa que precisa escolher qual
  // cadastro vale — e escolher sozinho seria escolher uma verdade para apagar.
  console.log(`\n${"─".repeat(72)}`);
  console.log(`${conflitos.length} CONFLITO(S) — nada foi fundido, cada um espera decisão humana:\n`);
  for (const c of conflitos) {
    console.log(`  • [${c.etapa}] ${c.nome ?? c.asaas_id}`);
    console.log(`    ${c.motivo}`);
  }
}

console.log(`\n${"─".repeat(72)}`);
if (!GRAVAR) {
  console.log("Passada seca. Nada foi gravado.");
  console.log("Para valer:  node scripts/backfill-asaas.mjs --gravar");
}

// `exitCode` e não `process.exit()`: o segundo derruba o processo com o
// `AbortSignal.timeout` do último fetch ainda vivo, e o libuv do Windows morre
// com "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)". Barulho que
// parece falha do backfill e não é.
process.exitCode = houveErro ? 1 : 0;
