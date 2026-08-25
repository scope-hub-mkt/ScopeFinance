import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Autenticação das duas pontas da integração com a Scope Dashboard.
 *
 * São **três** segredos distintos, e a separação é deliberada — um segredo
 * vazado não deve derrubar as outras duas pontas:
 *
 * | Variável | Protege | Quem apresenta |
 * |---|---|---|
 * | `SCOPE_DASHBOARD_API_KEY` | as rotas `/api/integracao/*` de leitura | a Dashboard, em `Authorization: Bearer` |
 * | `SCOPE_WEBHOOK_SECRET` | os eventos que a Dashboard nos ENVIA | assinatura `X-Scope-Signature-256` |
 * | `SCOPE_DASHBOARD_WEBHOOK_SECRET` | os eventos que ENVIAMOS para lá | assinatura `X-Hub-Signature-256` |
 *
 * ⚠️ Os dois dialetos de assinatura não são capricho: a Dashboard **emite**
 * no formato do contrato dela (`{timestamp}.{corpo}`, header `X-Scope-*`) e
 * **recebe** no formato genérico que a tela de Webhooks de entrada aceita
 * (corpo puro, header `X-Hub-Signature-256`, o formato da Meta). Falar o
 * dialeto de cada direção é o que dispensa mudança do lado de lá.
 *
 * Puro de propósito: nada aqui lê `process.env` nem toca rede — quem resolve
 * as variáveis é `config.ts`, e é isso que torna estes testes executáveis.
 */

/** Janela de tolerância do timestamp, contra replay — `03` §4.2 da Dashboard. */
export const JANELA_ASSINATURA_S = 300;

function comparaConstante(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  // Comprimento diferente já vaza por si; comparar mesmo assim evita que o
  // tempo de resposta conte quanto do prefixo estava certo.
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export type Veredito = { ok: true } | { ok: false; motivo: string; status: 401 | 503 };

/**
 * `Authorization: Bearer <chave>` das rotas de leitura.
 *
 * Chave não configurada devolve **503, não 401**: a diferença importa para
 * quem está plugando. 401 diz "sua credencial está errada" e manda conferir o
 * lado errado; 503 diz "este servidor ainda não foi provisionado".
 */
export function autenticarChave(esperada: string | null, cabecalho: string | null): Veredito {
  if (!esperada) {
    return {
      ok: false,
      status: 503,
      motivo:
        "Integração não provisionada: defina SCOPE_DASHBOARD_API_KEY no ambiente do ScopeFinance.",
    };
  }
  const recebida = (cabecalho ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!recebida) return { ok: false, status: 401, motivo: "header Authorization ausente" };
  if (!comparaConstante(esperada, recebida)) {
    return { ok: false, status: 401, motivo: "chave de API não confere" };
  }
  return { ok: true };
}

/** `X-Scope-Signature-256` = HMAC_SHA256(segredo, "{timestamp}.{corpo}"). */
export function assinarEstiloScope(segredo: string, timestamp: number, corpoBruto: string): string {
  return `sha256=${createHmac("sha256", segredo).update(`${timestamp}.${corpoBruto}`).digest("hex")}`;
}

/** `X-Hub-Signature-256` = HMAC_SHA256(segredo, corpo) — formato Meta/genérico. */
export function assinarEstiloHub(segredo: string, corpoBruto: string): string {
  return `sha256=${createHmac("sha256", segredo).update(corpoBruto).digest("hex")}`;
}

/**
 * Verifica uma entrega vinda da Dashboard.
 *
 * O timestamp entra no material assinado (não só num header próprio) para que
 * reenviar um corpo antigo com timestamp novo invalide a assinatura — é o que
 * a janela de 5 minutos sozinha não garantiria.
 */
export function verificarEntregaDaDashboard(
  segredo: string | null,
  headers: Headers,
  corpoBruto: string,
  agoraS: number = Math.floor(Date.now() / 1000)
): Veredito {
  if (!segredo) {
    return {
      ok: false,
      status: 503,
      motivo:
        "Webhook não provisionado: defina SCOPE_WEBHOOK_SECRET no ambiente do ScopeFinance.",
    };
  }

  const assinatura = headers.get("x-scope-signature-256");
  if (!assinatura) return { ok: false, status: 401, motivo: "header X-Scope-Signature-256 ausente" };

  const ts = Number(headers.get("x-scope-timestamp"));
  if (!Number.isFinite(ts)) {
    return { ok: false, status: 401, motivo: "header X-Scope-Timestamp ausente ou inválido" };
  }
  if (Math.abs(agoraS - ts) > JANELA_ASSINATURA_S) {
    return {
      ok: false,
      status: 401,
      motivo: `timestamp fora da janela de ${JANELA_ASSINATURA_S}s (proteção contra replay)`,
    };
  }
  if (!comparaConstante(assinarEstiloScope(segredo, ts, corpoBruto), assinatura)) {
    return { ok: false, status: 401, motivo: "assinatura não confere com o segredo cadastrado" };
  }
  return { ok: true };
}
