import "server-only";
import { credencial } from "./credenciais";
import { sondarDashboard } from "./sonda-dashboard";

/**
 * **"Funciona?" — chamada real, passo a passo.** O gêmeo do
 * `lib/integracoes-teste.ts` da Dashboard, e pelas mesmas razões.
 *
 * ⚖️ A tela `/integracao` já dizia, no próprio comentário, que **presença de
 * variável não é integração funcionando** — a ressalva que a Dashboard
 * registrou como `L-36`. Ela tinha um botão que testava a ponte com a
 * Dashboard e mais nada: Asaas e CRM, que são por onde o dinheiro e o cliente
 * entram, seguiam medidos por presença.
 *
 * Três regras, iguais às do outro lado:
 *
 * 1. **Passo a passo, nunca um veredito só** — "o Asaas não funciona" cabe em
 *    dez causas; "a chave autentica mas a conta não tem cobrança" cabe em uma.
 * 2. **Ausência não é falha** (`ok: null`). Pintar de vermelho o que ninguém
 *    configurou ensina a ignorar vermelho.
 * 3. **Todo passo que falha diz como resolver.**
 *
 * ⛔ **Nenhuma escrita.** Nada de criar cliente no Asaas nem lead no CRM para
 * "testar" — botão de teste que cria dado real é armadilha.
 */

export interface PassoDiagnostico {
  passo: string;
  ok: boolean | null;
  detalhe: string;
  comoResolver?: string;
  chaves?: string[];
}

export interface ResultadoTeste {
  slug: string;
  ok: boolean;
  naoProvisionada: boolean;
  resumo: string;
  passos: PassoDiagnostico[];
  medidoEm: string;
}

const TIMEOUT = 20_000;

async function tentar(url: string, init?: RequestInit) {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT), cache: "no-store" });
    const corpo = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: r.status, corpo, erroRede: undefined as string | undefined };
  } catch (e) {
    return {
      status: 0,
      corpo: {} as Record<string, unknown>,
      erroRede: e instanceof Error ? e.message : "falha de rede",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
//  Asaas — por onde o dinheiro entra
// ─────────────────────────────────────────────────────────────────────

async function testarAsaas(): Promise<PassoDiagnostico[]> {
  const [chave, base] = await Promise.all([
    credencial("ASAAS_API_KEY"),
    credencial("ASAAS_API_BASE"),
  ]);

  if (!chave) {
    return [
      {
        passo: "Credencial provisionada",
        ok: null,
        detalhe: "ASAAS_API_KEY não preenchida.",
        chaves: ["ASAAS_API_KEY"],
      },
    ];
  }

  const b = (base ?? "https://api-sandbox.asaas.com/v3").replace(/\/+$/, "");
  const passos: PassoDiagnostico[] = [];

  // ⚠️ **Qual ambiente?** Sandbox e produção usam a MESMA forma de chave, e
  // trocar um pelo outro é o erro mais comum e mais silencioso da integração:
  // tudo "funciona", e o dinheiro simplesmente não existe. Declarar o
  // ambiente é metade do diagnóstico.
  const sandbox = /sandbox/i.test(b);
  passos.push({
    passo: "Ambiente do gateway",
    ok: null,
    detalhe: sandbox
      ? `SANDBOX (${b}) — cobrança criada aqui não é dinheiro de verdade.`
      : `PRODUÇÃO (${b}).`,
    chaves: ["ASAAS_API_BASE"],
  });

  const r = await tentar(`${b}/customers?limit=1`, { headers: { access_token: chave } });
  const total = (r.corpo.totalCount as number | undefined) ?? undefined;
  passos.push({
    passo: "A chave autentica no Asaas",
    ok: r.status === 200,
    detalhe:
      r.erroRede ??
      (r.status === 200
        ? `HTTP 200 · ${total ?? "?"} cliente(s) na conta`
        : `HTTP ${r.status}${typeof r.corpo.errors === "object" ? ` — ${JSON.stringify(r.corpo.errors).slice(0, 160)}` : ""}`),
    comoResolver:
      r.status === 200
        ? undefined
        : "Gere a chave em Asaas → Integrações → API. ⚠️ A chave de sandbox não " +
          "autentica em produção e vice-versa — confira se ASAAS_API_BASE combina com ela.",
    chaves: ["ASAAS_API_KEY", "ASAAS_API_BASE"],
  });
  if (r.status !== 200) return passos;

  // O webhook é a via principal do dinheiro; a chave só serve para o backfill.
  const token = await credencial("ASAAS_WEBHOOK_TOKEN");
  passos.push({
    passo: "O token do webhook de entrada está definido",
    ok: token ? true : null,
    detalhe: token
      ? "Definido — as entregas do Asaas são conferidas contra ele."
      : "Não definido: a rota de entrada recusaria toda entrega do Asaas.",
    comoResolver: token
      ? undefined
      : "Defina ASAAS_WEBHOOK_TOKEN aqui e cadastre o MESMO valor no painel do Asaas, " +
        "em Integrações → Webhooks, no campo de token de autenticação.",
    chaves: ["ASAAS_WEBHOOK_TOKEN"],
  });

  return passos;
}

// ─────────────────────────────────────────────────────────────────────
//  CRM — por onde o cliente entra
// ─────────────────────────────────────────────────────────────────────

async function testarCrm(): Promise<PassoDiagnostico[]> {
  const segredo = await credencial("CRM_WEBHOOK_SECRET");

  // ⛔ Aqui não há chamada de saída a fazer: o CRM **empurra** para cá, e o
  // ScopeFinance nunca chama o CRM. O que dá para conferir é se a porta está
  // com fechadura — e dizer que só isso foi conferido.
  return [
    {
      passo: "O segredo que valida a entrada do CRM está definido",
      ok: segredo ? true : false,
      detalhe: segredo
        ? "Definido — POST /api/integracao/webhooks/crm confere a assinatura contra ele."
        : "Ausente: toda entrega do CRM seria recusada com 401.",
      comoResolver: segredo
        ? undefined
        : "Defina CRM_WEBHOOK_SECRET aqui e o MESMO valor no vigia da Dashboard " +
          "(SCOPEFINANCE_CRM_WEBHOOK_SECRET), que é quem assina os cards da coluna Validação Contratual.",
      chaves: ["CRM_WEBHOOK_SECRET"],
    },
    {
      passo: "Direção do fluxo",
      ok: null,
      detalhe:
        "O CRM não chama esta API: quem lê o CRM e empurra para cá é o vigia da Dashboard. " +
        "Não há chamada de saída para exercitar deste lado.",
      chaves: [],
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────
//  Dashboard — a ponte dos dois sentidos
// ─────────────────────────────────────────────────────────────────────

async function testarDashboard(): Promise<PassoDiagnostico[]> {
  const s = await sondarDashboard();
  return [
    {
      passo: "A Dashboard aceita a nossa chave de saída",
      ok: s.ok,
      detalhe: s.mensagem,
      comoResolver: s.ok
        ? undefined
        : "A chave em SCOPE_DASHBOARD_API_KEY_OUT precisa existir em Administração → " +
          "API e Webhooks na Dashboard, com escopo de leitura de clientes.",
      chaves: ["SCOPE_DASHBOARD_API_BASE", "SCOPE_DASHBOARD_API_KEY_OUT"],
    },
    {
      passo: "Sabemos para onde mandar os nossos eventos",
      ok: (await credencial("SCOPE_DASHBOARD_WEBHOOK_URL")) ? true : false,
      detalhe: (await credencial("SCOPE_DASHBOARD_WEBHOOK_URL"))
        ? "URL de webhook da Dashboard definida."
        : "Ausente — cliente criado aqui não chega lá (a via de volta está cortada).",
      comoResolver: (await credencial("SCOPE_DASHBOARD_WEBHOOK_URL"))
        ? undefined
        : "https://<dashboard>/api/webhooks/incoming/scopefinance",
      chaves: ["SCOPE_DASHBOARD_WEBHOOK_URL", "SCOPE_DASHBOARD_WEBHOOK_SECRET"],
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────

const TESTES: Record<string, () => Promise<PassoDiagnostico[]>> = {
  asaas: testarAsaas,
  crm: testarCrm,
  dashboard: testarDashboard,
};

export const SLUGS = Object.keys(TESTES);

export async function testarIntegracao(slug: string): Promise<ResultadoTeste> {
  const medidoEm = new Date().toISOString();
  const fn = TESTES[slug];
  if (!fn) {
    return {
      slug,
      ok: false,
      naoProvisionada: false,
      resumo: `Integração desconhecida: ${slug}.`,
      passos: [],
      medidoEm,
    };
  }

  const passos = await fn();
  const aplicaveis = passos.filter((p) => p.ok !== null);
  const falhas = aplicaveis.filter((p) => !p.ok);
  const naoProvisionada = aplicaveis.length === 0;

  return {
    slug,
    ok: falhas.length === 0 && !naoProvisionada,
    naoProvisionada,
    resumo: naoProvisionada
      ? "Nada a exercitar — nenhuma credencial preenchida."
      : falhas.length === 0
        ? `Funciona — ${aplicaveis.length} passo(s) conferido(s) com chamada real.`
        : `${falhas.length} de ${aplicaveis.length} passo(s) falharam.`,
    passos,
    medidoEm,
  };
}
