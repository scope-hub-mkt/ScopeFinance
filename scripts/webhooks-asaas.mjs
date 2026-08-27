/**
 * Configura os **dois** webhooks do Asaas — §4.2 do plano de implementação.
 *
 * ⛔ **O ganho da separação, dito sem rodeio:** com um webhook só, se o handler
 * de `ACCESS_TOKEN_EXPIRING_SOON` quebrar 15 vezes, **você para de receber
 * pagamento junto** (`RN-AS-04`). Monitoramento não pode ter poder de derrubar
 * a fila que carrega o financeiro.
 *
 * ⚖️ **E por que Sequencial no de negócio:** uma cobrança percorre
 * `CREATED → OVERDUE → CONFIRMED → RECEIVED`, e o Finance executa regra
 * diferente em cada status. Receber `RECEIVED` antes de `CREATED` obriga a
 * escrever uma reconciliação de ordem por conta própria — código novo, com bug
 * novo, para resolver um problema que a configuração resolve de graça.
 *
 * ⚠️ **A ORDEM importa, e o Asaas obriga a pior das duas.** O certo seria criar
 * o operacional ANTES de reduzir o de negócio: a janela produziria entrega
 * dupla, inócua, porque a caixa de entrada deduplica pelo `id` do evento
 * (`RN-AS-02`). **Mas o Asaas recusa isso** — medido em 28/08/2026:
 *
 *     HTTP 400 · "Já existe uma configuração para os eventos com os mesmos
 *                 atributos."
 *
 * Ele não aceita dois webhooks assinando o mesmo evento. Então a única ordem
 * possível é **reduzir primeiro, criar depois** — e existe uma janela de
 * segundos em que os 24 eventos operacionais não estão assinados em lugar
 * nenhum. Evento gerado nessa janela **não chega**.
 *
 * ⛔ Por isso as duas chamadas ficam **coladas, sem nada entre elas**, e a
 * conferência do fim **exige que a soma feche 73**. Se a segunda falhar, o
 * script sai diferente de zero e o operacional precisa ser criado na mão —
 * rodar de novo resolve, porque a sobreposição já não existe.
 *
 * ⚖️ A janela cai sobre `ACCOUNT_STATUS_*` e `ACCESS_TOKEN_*`, que são
 * monitoramento. Se ela caísse sobre `PAYMENT_*` a conta seria outra, e a
 * ordem teria de ser negociada com o suporte do Asaas em vez de aceita.
 *
 * ⛔ **A URL e o token não mudam**, e este script não os toca.
 *
 * Uso:
 *   node scripts/webhooks-asaas.mjs            # mostra o que faria
 *   node scripts/webhooks-asaas.mjs --aplicar  # aplica
 */
import { readFileSync } from "node:fs";

const APLICAR = process.argv.includes("--aplicar");

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

if (!env.ASAAS_API_KEY || !env.ASAAS_WEBHOOK_TOKEN) {
  console.error("webhooks-asaas: faltam ASAAS_API_KEY e/ou ASAAS_WEBHOOK_TOKEN no .env.local.");
  process.exit(1);
}

const BASE = env.ASAAS_API_BASE || "https://api.asaas.com/v3";
const H = {
  access_token: env.ASAAS_API_KEY,
  "User-Agent": "ScopeFinance",
  "Content-Type": "application/json",
};

/**
 * As duas listas saem de `lib/asaas/eventos.ts`, lidas do próprio código.
 *
 * ⚖️ **Por que ler o arquivo e não digitar as listas aqui.** São 73 eventos, e
 * duas cópias divergiriam na primeira vez que alguém acrescentasse um tipo
 * novo ao catálogo e esquecesse do script. O erro seria silencioso do pior
 * jeito: o evento existe no código, não está assinado no painel, e **nunca
 * chega** — sem nada ficar vermelho.
 */
function listasDoCatalogo() {
  const src = readFileSync("lib/asaas/eventos.ts", "utf8");
  const negocio = [];
  const operacional = [];
  for (const m of src.matchAll(/^ {2}([A-Z][A-Z_]+):\s*([PSICAT])\(?/gm)) {
    const [, evento, fabrica] = m;
    (fabrica === "A" || fabrica === "T" ? operacional : negocio).push(evento);
  }
  return { negocio, operacional };
}

const { negocio, operacional } = listasDoCatalogo();

if (negocio.length + operacional.length !== 73) {
  console.error(
    `webhooks-asaas: li ${negocio.length + operacional.length} eventos do catálogo, esperava 73. ` +
      `O formato de lib/asaas/eventos.ts mudou — conserte o leitor antes de aplicar.`
  );
  process.exit(1);
}

const URL_DESTINO = "https://scopefinance-chi.vercel.app/api/integracao/webhooks/asaas";

const DESEJADO = [
  {
    name: "Scope Finance — negócio",
    sendType: "SEQUENTIALLY",
    events: negocio,
    porque: "alimenta o financeiro; a ordem dos status importa",
  },
  {
    name: "Scope Finance — operacional",
    sendType: "NON_SEQUENTIALLY",
    events: operacional,
    porque: "monitoramento; não pode derrubar a fila do dinheiro",
  },
];

const atuais = await (await fetch(`${BASE}/webhooks`, { headers: H })).json();

console.log(`\nANTES — ${atuais.totalCount} webhook(s):`);
for (const w of atuais.data) {
  console.log(
    `  "${w.name}" · ${w.sendType} · ${w.events.length} eventos · ` +
      `enabled=${w.enabled} interrupted=${w.interrupted} penalizados=${w.penalizedRequestsCount}`
  );
}

console.log("\nDEPOIS:");
for (const d of DESEJADO) {
  console.log(`  "${d.name}" · ${d.sendType} · ${d.events.length} eventos — ${d.porque}`);
}
console.log("\n  A URL e o token não mudam.");

if (!APLICAR) {
  console.log("\nNada foi aplicado. Para valer:  node scripts/webhooks-asaas.mjs --aplicar\n");
}

const corpo = (d) => ({
  name: d.name,
  url: URL_DESTINO,
  email: atuais.data[0]?.email ?? undefined,
  enabled: true,
  interrupted: false,
  authToken: env.ASAAS_WEBHOOK_TOKEN,
  sendType: d.sendType,
  events: d.events,
});

if (APLICAR) {
  console.log("\n─── aplicando ───");

  // ⚠️ **Negócio primeiro, e não por escolha** — ver o topo. O Asaas recusa
  // dois webhooks assinando o mesmo evento, então o de negócio precisa largar
  // os 24 operacionais ANTES de eles poderem ser assinados em outro lugar.
  // As duas chamadas ficam coladas para a janela ser a menor possível.
  const existePorNome = new Map(atuais.data.map((w) => [w.name, w]));
  const reaproveitar = atuais.data[0];

  for (const d of [DESEJADO[0], DESEJADO[1]]) {
    const jaExiste = existePorNome.get(d.name);

    // O de negócio reaproveita o webhook que já está no ar — assim o histórico
    // de entregas dele não é perdido, e não há instante sem cobertura.
    const alvo = jaExiste ?? (d === DESEJADO[0] ? reaproveitar : null);

    if (alvo) {
      const r = await fetch(`${BASE}/webhooks/${alvo.id}`, {
        method: "PUT",
        headers: H,
        body: JSON.stringify(corpo(d)),
      });
      const j = await r.json().catch(() => ({}));
      console.log(
        `  atualizado "${d.name}" → HTTP ${r.status}` +
          (r.ok ? ` · ${j.events?.length} eventos · ${j.sendType}` : ` · ${JSON.stringify(j).slice(0, 200)}`)
      );
    } else {
      const r = await fetch(`${BASE}/webhooks`, {
        method: "POST",
        headers: H,
        body: JSON.stringify(corpo(d)),
      });
      const j = await r.json().catch(() => ({}));
      console.log(
        `  criado     "${d.name}" → HTTP ${r.status}` +
          (r.ok ? ` · ${j.events?.length} eventos · ${j.sendType}` : ` · ${JSON.stringify(j).slice(0, 200)}`)
      );
    }
  }

  const depois = await (await fetch(`${BASE}/webhooks`, { headers: H })).json();
  console.log(`\nCONFERÊNCIA — ${depois.totalCount} webhook(s):`);
  let soma = 0;
  for (const w of depois.data) {
    soma += w.events.length;
    console.log(
      `  "${w.name}" · ${w.sendType} · ${w.events.length} eventos · ` +
        `enabled=${w.enabled} interrupted=${w.interrupted} · token=${w.hasAuthToken}`
    );
  }
  // ⛔ A soma tem de fechar 73. Um evento que sumiu da configuração nunca mais
  // chega, e nada fica vermelho por causa disso.
  console.log(`  soma dos eventos: ${soma} ${soma === 73 ? "✓" : "✗ ESPERAVA 73"}`);
  process.exitCode = soma === 73 ? 0 : 1;
}
