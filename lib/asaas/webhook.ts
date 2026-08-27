import { timingSafeEqual } from "node:crypto";
import { definicaoDoEvento, entidadePorPrefixo, type EntidadeAsaas } from "./eventos";

/**
 * A camada pura do webhook do Asaas: autenticação, leitura do envelope,
 * fuso horário e dinheiro.
 *
 * ⚖️ **Por que pura.** As duas armadilhas do §4.10 do plano — o fuso e o
 * ponto flutuante — não quebram nada: elas produzem **números errados que
 * parecem certos**, que é a categoria de defeito mais cara que existe, porque
 * só aparece no fechamento do mês depois de já ter contaminado comissão paga.
 * Defeito que não levanta exceção só é pego por teste, e teste que precisa de
 * banco para rodar é teste que não roda.
 *
 * Nada aqui toca banco, rede ou `process.env`.
 */

// ════════════════════════════════════════════════════════════════════
//  Autenticação — `RN-AS-01`
// ════════════════════════════════════════════════════════════════════

export type VereditoAsaas = { ok: true } | { ok: false; motivo: string; status: 401 | 503 };

/**
 * Confere o header `asaas-access-token`.
 *
 * ⛔ **Esta é a única credencial que o Asaas apresenta, e ela NÃO é a API
 * Key.** São duas coisas diferentes, e trocá-las é comum:
 *
 *   `access_token`        → header das chamadas que **nós** fazemos ao Asaas
 *   `asaas-access-token`  → header das chamadas que o **Asaas** faz para nós
 *
 * Usar a API Key como token de webhook, além de não funcionar, a faria
 * trafegar em toda entrega — e a API Key é a credencial que movimenta
 * dinheiro.
 *
 * Token não configurado devolve **503, não 401**, pela mesma razão que
 * `lib/integracao/auth.ts`: 401 diz "sua credencial está errada" e manda
 * conferir o lado errado; 503 diz "este servidor ainda não foi provisionado".
 */
export function autenticarAsaas(
  esperado: string | null,
  recebido: string | null
): VereditoAsaas {
  if (!esperado) {
    return {
      ok: false,
      status: 503,
      motivo:
        "Webhook do Asaas não provisionado: defina ASAAS_WEBHOOK_TOKEN no ambiente do ScopeFinance. " +
        "É o token definido na criação do webhook no painel do Asaas — NÃO é a API Key.",
    };
  }
  const token = (recebido ?? "").trim();
  if (!token) {
    return { ok: false, status: 401, motivo: "header asaas-access-token ausente" };
  }
  const a = Buffer.from(esperado);
  const b = Buffer.from(token);
  // Comprimento diferente já vaza por si; comparar mesmo assim evita que o
  // tempo de resposta conte quanto do prefixo estava certo.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, motivo: "asaas-access-token não confere" };
  }
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════
//  O envelope — parser PERMISSIVO, e isso é regra, não estilo
// ════════════════════════════════════════════════════════════════════

export interface EnvelopeAsaas {
  /** O `id` do evento (evt_…) — a chave de idempotência do `RN-AS-02`. */
  id: string;
  event: string;
  entity_type: EntidadeAsaas | null;
  entity_id: string | null;
  /** O objeto da entidade, cru, como veio. */
  objeto: Record<string, unknown> | null;
  /** O corpo inteiro, cru, íntegro — é ele que vai para a coluna `payload`. */
  bruto: Record<string, unknown>;
}

export type LeituraEnvelope =
  | { ok: true; envelope: EnvelopeAsaas }
  | { ok: false; motivo: string };

/**
 * Lê o corpo de um evento sem nunca lançar por campo desconhecido.
 *
 * ⛔ **O Asaas adiciona atributos novos ao payload sem aviso.** Um parser
 * estrito funciona hoje e quebra no próximo release deles — e "quebra" aqui
 * significa `RN-AS-04` (15 falhas pausam a fila), `RN-AS-05` (14 dias) e
 * perda permanente. Validamos **só os campos que usamos**; todo o resto passa
 * e fica gravado no cru.
 *
 * A única coisa realmente obrigatória é o `id` do evento: sem ele não há
 * idempotência, e sem idempotência a mesma cobrança é contada duas vezes.
 * Mesmo esse caso não vira `400` — quem decide isso é a rota (`RN-AS-06`).
 */
export function lerEnvelope(bruto: unknown): LeituraEnvelope {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) {
    return { ok: false, motivo: "corpo não é um objeto JSON" };
  }
  const corpo = bruto as Record<string, unknown>;

  const event = typeof corpo.event === "string" ? corpo.event : "";
  if (!event) return { ok: false, motivo: "campo `event` ausente" };

  const id = typeof corpo.id === "string" && corpo.id ? corpo.id : null;
  if (!id) return { ok: false, motivo: "campo `id` do evento ausente — sem ele não há idempotência" };

  // A chave do objeto muda conforme a categoria. Usa o catálogo quando o
  // evento é conhecido, e o prefixo quando não é — um evento novo do Asaas
  // ainda cai na entidade certa.
  const entidade = definicaoDoEvento(event)?.entidade ?? entidadePorPrefixo(event);

  let objeto: Record<string, unknown> | null = null;
  if (entidade && entidade !== "token") {
    const candidato = corpo[entidade];
    if (candidato && typeof candidato === "object" && !Array.isArray(candidato)) {
      objeto = candidato as Record<string, unknown>;
    }
  }

  const entityId = objeto && typeof objeto.id === "string" ? objeto.id : null;

  return {
    ok: true,
    envelope: { id, event, entity_type: entidade, entity_id: entityId, objeto, bruto: corpo },
  };
}

// ════════════════════════════════════════════════════════════════════
//  Armadilha 1 — o fuso horário
// ════════════════════════════════════════════════════════════════════

/**
 * O fuso em que o Asaas emite suas datas.
 *
 * ⚠️ O Asaas manda `"dateCreated": "2026-06-19 14:30:00"` — **sem fuso**. Os
 * sistemas da Scope trabalham em UTC (os crons são declarados em UTC e os
 * carimbos são ISO-8601 com `Z`). Um pagamento recebido dia **31 às 22:00**
 * em horário de Brasília é dia **1º às 01:00 UTC**: interpretado errado, ele
 * **muda de mês** — e mudar de mês aqui significa faturamento errado nos dois
 * meses, meta batida que não foi batida, e comissão apurada sobre a
 * competência errada.
 */
export const FUSO_ASAAS = "America/Sao_Paulo";

/**
 * O deslocamento de `America/Sao_Paulo` em minutos, para um instante dado.
 *
 * ⚖️ **Por que não `-03:00` fixo.** O Brasil aboliu o horário de verão em
 * 2019, então hoje o offset é constante — mas cravá-lo faria o código dar
 * resposta errada em silêncio se a decisão for revertida, e uma hora de erro
 * atravessa a virada do mês do mesmo jeito. O `Intl` responde pela regra
 * vigente na data, que é a pergunta certa.
 */
function offsetMinutos(instanteUtc: Date): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: FUSO_ASAAS,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(fmt.formatToParts(instanteUtc).map((x) => [x.type, x.value]));
  // `hour` volta como "24" à meia-noite em algumas plataformas; `% 24` evita
  // que isso vire um dia inteiro de erro.
  const comoUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second)
  );
  return (comoUtc - instanteUtc.getTime()) / 60_000;
}

/**
 * Converte uma data do Asaas para ISO-8601 em UTC.
 *
 * Aceita os dois formatos que ele usa: `"2026-06-19 14:30:00"` (data e hora,
 * sem fuso) e `"2026-08-21"` (só data). O segundo vira meia-noite de Brasília,
 * que é o instante que a data significa lá.
 *
 * ⛔ Devolve `null` para entrada que não reconhece, **nunca a data de hoje**.
 * Um carimbo inventado é indistinguível de um real na tela.
 */
export function asaasParaUtc(texto: unknown): string | null {
  if (typeof texto !== "string") return null;
  const t = texto.trim();
  if (!t) return null;

  // Já veio com fuso? Então o Asaas já respondeu a pergunta; respeitamos.
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(t)) {
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const [, ano, mes, dia, hora = "00", min = "00", seg = "00"] = m;

  // Primeiro assume que os componentes são UTC, mede o offset naquele
  // instante aproximado e corrige. Duas passadas bastam: o erro da primeira é
  // de no máximo o próprio offset, que nunca cruza uma mudança de regra.
  const ingenuo = Date.UTC(+ano, +mes - 1, +dia, +hora, +min, +seg);
  let instante = ingenuo - offsetMinutos(new Date(ingenuo)) * 60_000;
  instante = ingenuo - offsetMinutos(new Date(instante)) * 60_000;

  const d = new Date(instante);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** A data-calendário (YYYY-MM-DD) em Brasília — o que vai em coluna `date`. */
export function asaasParaDataLocal(texto: unknown): string | null {
  if (typeof texto !== "string") return null;
  const t = texto.trim();
  // Só data já É a data local; convertê-la para UTC e cortar daria o dia
  // anterior, que é exatamente o erro de virada de mês descrito acima.
  const so = t.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (so) return so[1];

  const iso = asaasParaUtc(t);
  if (!iso) return null;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_ASAAS,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date(iso));
}

// ════════════════════════════════════════════════════════════════════
//  Armadilha 2 — dinheiro como ponto flutuante
// ════════════════════════════════════════════════════════════════════

/**
 * O valor em **centavos inteiros**.
 *
 * ⛔ O Asaas manda `"value": 150.00` e `"netValue": 148.35`, que em JSON são
 * **float**. `150.00 - 148.35` dá `1.6500000000000057` em JavaScript. Em cima
 * de centenas de cobranças, o total do relatório diverge do extrato por
 * centavos — e ninguém consegue explicar por quê.
 *
 * A conversão acontece **uma vez, na entrada**, e depois disso toda conta é
 * de inteiro. Nenhuma soma de dinheiro acontece em JavaScript neste código:
 * as que existem são do Postgres, sobre `numeric`.
 */
export function centavos(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/**
 * Centavos de volta para o texto que a coluna `numeric(14,2)` recebe.
 *
 * ⚖️ Vai como **string**, não como número: entregar `1.65` ao driver o faz
 * viajar como double de novo, e o arredondamento que acabamos de fazer é
 * desfeito no último metro.
 */
export function deCentavos(c: number | null | undefined): string | null {
  if (c === null || c === undefined || !Number.isFinite(c)) return null;
  const sinal = c < 0 ? "-" : "";
  const abs = Math.abs(c);
  return `${sinal}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Atalho para gravar um valor do Asaas direto numa coluna `numeric`. */
export function dinheiro(v: unknown): string | null {
  return deCentavos(centavos(v));
}

/**
 * A dedução implícita de uma cobrança: o que o gateway reteve.
 *
 * 📐 `RN-04` da Dashboard calcula a comissão sobre `valor_pago − deducoes`.
 * Gravando `valor_pago = value` e `deducoes = value − netValue`, a base de
 * comissão **passa a ser exatamente o `netValue`** — que é o que o §4.10
 * manda — sem que uma linha sequer mude do lado da Dashboard.
 *
 * ⛔ A subtração é feita em centavos inteiros, nunca em float.
 */
export function deducaoDoGateway(value: unknown, netValue: unknown): string | null {
  const bruto = centavos(value);
  const liquido = centavos(netValue);
  if (bruto === null || liquido === null) return null;
  const d = bruto - liquido;
  // Negativo significaria líquido maior que bruto — dado incoerente do
  // gateway. Zerar é a leitura conservadora: nunca inventa desconto.
  return deCentavos(d > 0 ? d : 0);
}
