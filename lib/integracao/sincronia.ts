import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assinarEstiloHub } from "./auth";
import { estadoIntegracao } from "./config";
import { interpretarEvento, normalizarDoc, type Envelope } from "./contrato";

/**
 * A via de mão dupla com a Scope Dashboard.
 *
 * ⚖️ **Decisão do dono, 25/08/2026:** Dashboard (CEO) e ScopeFinance (CFO)
 * têm poder equivalente e papéis distintos; o cadastro de cliente é núcleo
 * **compartilhado**. Cliente nasce em qualquer um dos dois e replica para o
 * outro com o **mesmo `id`**.
 *
 * Três mecanismos, e cada um existe porque os outros dois falham de um jeito
 * diferente:
 *
 * 1. **Entrada** (`aplicarEvento`) — a Dashboard nos manda o evento assinado.
 *    Idempotente por `evento_id`: a escada de retry de lá garante que receber
 *    o mesmo evento duas vezes seja rotina, não exceção.
 * 2. **Saída** (`enfileirarEvento` + `entregarFila`) — mesmo padrão outbox da
 *    Dashboard, e pela mesma razão: gravar e entregar são passos distintos,
 *    senão a Dashboard fora do ar trava o cadastro de cliente daqui.
 * 3. **Reconciliação** (`reconciliarComDashboard`) — a rede de segurança das
 *    outras duas. Evento perdido some sem barulho; a reconciliação é o que
 *    transforma "sumiu" em "aparece na próxima passada".
 *
 * ⛔ **Supressão de eco.** Aplicar um evento da Dashboard NUNCA enfileira
 * evento de volta. Sem essa regra, um cadastro geraria ping-pong infinito
 * entre os dois sistemas — e cada volta gravaria linha nas duas outbox.
 */

/** Escada de retry — os mesmos números que a Dashboard usa (`D-35`). */
export const ESCADA_RETRY_MS = [0, 60_000, 300_000, 1_800_000, 7_200_000];
export const MAX_TENTATIVAS = ESCADA_RETRY_MS.length;

// ─── ENTRADA: eventos que a Dashboard nos manda ─────────────────────

export type ResultadoAplicacao =
  | { estado: "aplicado"; acao: "criar" | "atualizar"; cliente_id: string }
  | { estado: "espelhado"; servico_id: string; acao: "criar" | "atualizar" | "encerrar" }
  | { estado: "duplicado" }
  | { estado: "ignorado"; motivo: string }
  | { estado: "erro"; motivo: string };

/**
 * Registra e aplica um evento recebido.
 *
 * Grava na caixa de entrada **antes** de processar: se o processamento
 * quebrar, o evento continua ali para ser reprocessado. Perder o evento
 * porque o processamento falhou seria trocar um erro visível por um silêncio.
 */
export async function aplicarEvento(
  supabase: SupabaseClient,
  env: Envelope
): Promise<ResultadoAplicacao> {
  const { error: insErr } = await supabase.from("integracao_recebidos").insert({
    evento_id: env.id,
    evento_tipo: env.evento,
    payload: env,
  });

  if (insErr) {
    // 23505 = já recebemos este evento. Não é falha: é a escada de retry da
    // Dashboard funcionando. Responder "ok" faz ela parar de tentar.
    if (insErr.code === "23505") return { estado: "duplicado" };
    return { estado: "erro", motivo: insErr.message };
  }

  // §5.2: o catálogo é da Dashboard e aqui fica um espelho SOMENTE LEITURA.
  // ⛔ Nenhuma tela deste sistema escreve em `servicos_espelho` — dois
  // catálogos editáveis seriam dois preços para o mesmo serviço, e a
  // divergência só apareceria meses depois, num relatório, com proposta
  // comercial e comissão já contaminadas.
  if (env.evento.startsWith("servico.")) {
    const r = await espelharServico(supabase, env);
    await marcarProcessado(supabase, env.id, r.estado === "erro" ? r.motivo : null);
    return r;
  }

  const leitura = interpretarEvento(env);

  if (leitura.acao === "ignorar") {
    await marcarProcessado(supabase, env.id, null);
    return { estado: "ignorado", motivo: leitura.motivo };
  }

  const cliente = leitura.cliente as Record<string, unknown> & { id: string; doc: string | null };

  // Documento repetido em OUTRO id é a colisão que o índice único pega. Ela
  // significa que a mesma empresa foi cadastrada duas vezes com identidades
  // diferentes — exatamente o conflito 4.3 do `00-LEVANTAMENTO` da Dashboard.
  // Reportar é o certo: resolver sozinho escolheria qual das duas verdades
  // apagar, e essa escolha não é do código.
  const docNorm = normalizarDoc(cliente.doc);
  if (docNorm) {
    const { data: colidente } = await supabase
      .from("clientes")
      .select("id, nome, doc")
      .neq("id", cliente.id)
      .limit(200);
    const conflito = (colidente ?? []).find((c) => normalizarDoc(c.doc) === docNorm);
    if (conflito) {
      const motivo =
        `documento ${cliente.doc} já pertence ao cliente ${conflito.id} ("${conflito.nome}") ` +
        `neste sistema — a mesma empresa tem duas identidades e alguém precisa decidir qual vale`;
      await marcarProcessado(supabase, env.id, motivo);
      return { estado: "erro", motivo };
    }
  }

  const { error: upErr } = await supabase
    .from("clientes")
    .upsert({ ...cliente, sincronizado_em: new Date().toISOString() }, { onConflict: "id" });

  if (upErr) {
    await marcarProcessado(supabase, env.id, upErr.message);
    return { estado: "erro", motivo: upErr.message };
  }

  await marcarProcessado(supabase, env.id, null);
  return { estado: "aplicado", acao: leitura.acao, cliente_id: cliente.id };
}

/**
 * Aplica `servico.criado` / `servico.atualizado` / `servico.encerrado`.
 *
 * 📐 O `id` é o MESMO dos dois lados (`ESTADO §8.4`) — é isso que mantém
 * cobrança já gravada apontando para serviço válido, e é por isso que o upsert
 * usa o `servico_id` que veio, e não um uuid próprio.
 *
 * ⛔ **`encerrado` marca inativo; NUNCA apaga.** Há cobrança histórica
 * apontando para o serviço, e apagá-lo a deixaria órfã — o mesmo raciocínio da
 * exclusão lógica de `ESTADO §5.4`.
 */
async function espelharServico(
  supabase: SupabaseClient,
  env: Envelope
): Promise<ResultadoAplicacao> {
  const d = (env.dados ?? {}) as Record<string, unknown>;
  const servicoId = typeof d.servico_id === "string" ? d.servico_id : null;
  const nome = typeof d.nome === "string" ? d.nome.trim() : "";

  if (!servicoId || !nome) {
    return { estado: "ignorado", motivo: "evento de serviço sem `servico_id` ou `nome`" };
  }

  const encerrado = env.evento === "servico.encerrado";
  const texto = (v: unknown) => (typeof v === "string" && v ? v : null);
  const numero = (v: unknown) => (v === null || v === undefined ? null : Number(v));

  const { error } = await supabase.from("servicos_espelho").upsert(
    {
      id: servicoId,
      nome,
      slug: texto(d.slug),
      area: texto(d.area),
      tipo_cobranca: texto(d.tipo_cobranca),
      preco_tabela: numero(d.preco_tabela),
      custo: numero(d.custo),
      recorrencia: texto(d.recorrencia),
      // Encerrado sai do catálogo ativo e permanece na tabela.
      ativo: encerrado ? false : d.ativo !== false,
      encerrado_em: encerrado ? new Date().toISOString() : null,
      sincronizado_em: new Date().toISOString(),
      fonte: "dashboard",
    },
    { onConflict: "id" }
  );

  if (error) return { estado: "erro", motivo: error.message };

  return {
    estado: "espelhado",
    servico_id: servicoId,
    acao: encerrado ? "encerrar" : env.evento === "servico.criado" ? "criar" : "atualizar",
  };
}

async function marcarProcessado(supabase: SupabaseClient, eventoId: string, erro: string | null) {
  await supabase
    .from("integracao_recebidos")
    .update({ processado: erro === null, processado_em: new Date().toISOString(), erro })
    .eq("evento_id", eventoId);
}

// ─── SAÍDA: eventos que mandamos para a Dashboard ───────────────────

/**
 * Enfileira um evento. **Nunca** faz `fetch` — se fizesse, uma Dashboard lenta
 * passaria a atrasar o cadastro de cliente que originou o evento.
 *
 * Devolve o id da linha para que a rota possa cutucar a entrega logo em
 * seguida (quase-síncrono) sem que a gravação dependa disso.
 */
export async function enfileirarEvento(
  supabase: SupabaseClient,
  tipo: string,
  dados: Record<string, unknown>
): Promise<string | null> {
  const { data } = await supabase
    .from("integracao_enviados")
    .insert({ evento_tipo: tipo, payload: { evento: tipo, dados } })
    .select("id")
    .single();
  return data?.id ?? null;
}

export interface ResultadoEntrega {
  processados: number;
  entregues: number;
  falhas: number;
  em_dead_letter: number;
  motivo?: string;
}

/**
 * Entrega a fila para o webhook de entrada da Dashboard.
 *
 * Assina no dialeto `X-Hub-Signature-256` (corpo puro), que é o que a tela de
 * Webhooks de entrada de lá valida — falar o dialeto do receptor é o que
 * dispensa qualquer mudança do lado da Dashboard para nos aceitar.
 */
export async function entregarFila(
  supabase: SupabaseClient,
  limite = 50
): Promise<ResultadoEntrega> {
  const vazio: ResultadoEntrega = {
    processados: 0,
    entregues: 0,
    falhas: 0,
    em_dead_letter: 0,
  };

  const { dashboardWebhookUrl: url, dashboardWebhookSecret: segredo } = estadoIntegracao();
  if (!url || !segredo) {
    return {
      ...vazio,
      motivo:
        "Saída não provisionada: defina SCOPE_DASHBOARD_WEBHOOK_URL e SCOPE_DASHBOARD_WEBHOOK_SECRET.",
    };
  }

  const agora = new Date().toISOString();
  const { data: pendentes } = await supabase
    .from("integracao_enviados")
    .select("*")
    .eq("entregue", false)
    .lt("tentativas", MAX_TENTATIVAS)
    .lte("proxima_tentativa_em", agora)
    .order("criado_em", { ascending: true })
    .limit(limite);

  const r = { ...vazio };

  for (const evento of pendentes ?? []) {
    r.processados++;
    const corpo = JSON.stringify({
      ...(evento.payload as Record<string, unknown>),
      id: evento.id,
      criado_em: evento.criado_em,
      origem: "scopefinance",
    });

    let status = 0;
    let erro: string | null = null;
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Scope-Event": evento.evento_tipo,
          "X-Hub-Signature-256": assinarEstiloHub(segredo, corpo),
        },
        body: corpo,
        signal: AbortSignal.timeout(10_000),
      });
      status = resp.status;
      // Mesmo motivo do `descreverResposta` da reconciliação: `ultimo_erro`
      // fica gravado na fila e é o que alguém vai ler daqui a uma semana
      // para descobrir por que a entrega parou. "HTTP 401" não diz se o
      // segredo está errado ou se a URL caiu numa rota protegida.
      if (!resp.ok) {
        let corpo = "";
        try {
          corpo = (await resp.text()).replace(/\s+/g, " ").trim().slice(0, 200);
        } catch {
          corpo = "";
        }
        erro = corpo ? `HTTP ${resp.status} — ${corpo}` : `HTTP ${resp.status}`;
      }
    } catch (e) {
      erro = e instanceof Error ? e.message : "erro de rede";
    }

    const tentativa = evento.tentativas + 1;

    if (!erro) {
      await supabase
        .from("integracao_enviados")
        .update({
          entregue: true,
          entregue_em: new Date().toISOString(),
          tentativas: tentativa,
          ultimo_status: status,
        })
        .eq("id", evento.id);
      r.entregues++;
      continue;
    }

    await supabase
      .from("integracao_enviados")
      .update({
        tentativas: tentativa,
        ultimo_erro: erro,
        ultimo_status: status || null,
        proxima_tentativa_em: new Date(
          Date.now() + (ESCADA_RETRY_MS[tentativa] ?? 0)
        ).toISOString(),
      })
      .eq("id", evento.id);

    r.falhas++;
    // Esgotou as tentativas: sai da fila ativa mas fica consultável. Apagar
    // seria perder a evidência de que a integração do outro lado quebrou.
    if (tentativa >= MAX_TENTATIVAS) r.em_dead_letter++;
  }

  return r;
}

// ─── RECONCILIAÇÃO: a rede de segurança das outras duas ─────────────

/**
 * Descreve uma resposta HTTP que não veio `ok`, **com o corpo junto**.
 *
 * ⚖️ **Por que o status sozinho não bastava** — 26/08/2026, sintoma real. A
 * reconciliação vinha reportando `"Dashboard respondeu 401"`, e esse texto
 * cabe em três causas com correções completamente diferentes:
 *
 *   1. a nossa chave não confere com nenhuma da Dashboard;
 *   2. a URL caiu numa implantação com Vercel Authentication ligada, e quem
 *      recusou foi a Vercel, não a aplicação;
 *   3. a chave é válida mas foi revogada lá.
 *
 * O corpo distingue as três na primeira leitura: a aplicação responde
 * `{"error":{"code":"unauthorized","message":"API key ausente ou inválida"}}`,
 * a Vercel responde HTML. Sem ele, depurar exige refazer a chamada à mão —
 * que é precisamente o trabalho que um campo `motivo` existe para poupar.
 *
 * É a mesma lição de `descreverFalha` em `config.ts`, aplicada à outra ponta:
 * **relatório de falha que omite a evidência não é relatório.**
 */
async function descreverResposta(resp: Response): Promise<string> {
  let corpo = "";
  try {
    corpo = (await resp.text()).replace(/\s+/g, " ").trim();
  } catch {
    corpo = "";
  }
  // Teto de 300: o corpo pode ser uma página HTML inteira, e o `motivo` vai
  // para a tela. O suficiente para identificar quem recusou, sem despejar
  // um documento dentro de um campo de diagnóstico.
  if (corpo.length > 300) corpo = corpo.slice(0, 300) + "…";
  return corpo ? `Dashboard respondeu ${resp.status} — ${corpo}` : `Dashboard respondeu ${resp.status}`;
}


export interface ResultadoReconciliacao {
  lidos: number;
  criados: number;
  atualizados: number;
  conflitos: { cliente_id: string; nome: string; motivo: string }[];
  motivo?: string;
}

/**
 * Puxa o cadastro mestre da Dashboard e fecha buracos.
 *
 * Evento perdido some sem barulho — esta função é o que transforma "sumiu"
 * em "aparece na próxima passada". Roda no cron e pelo botão da tela.
 *
 * ⚠️ Só **acrescenta e atualiza**; nunca apaga. Cliente que existe aqui e não
 * lá pode ser um cadastro legítimo nascido deste lado (a via de mão dupla
 * permite isso) — apagá-lo por ausência seria a reconciliação destruindo
 * exatamente o dado que a decisão do dono autorizou a existir.
 */
export async function reconciliarComDashboard(
  supabase: SupabaseClient
): Promise<ResultadoReconciliacao> {
  const vazio: ResultadoReconciliacao = { lidos: 0, criados: 0, atualizados: 0, conflitos: [] };
  const { dashboardBase: base, dashboardApiKey: chave } = estadoIntegracao();
  if (!base || !chave) {
    return {
      ...vazio,
      motivo:
        "Reconciliação não provisionada: defina SCOPE_DASHBOARD_API_BASE e SCOPE_DASHBOARD_API_KEY_OUT.",
    };
  }

  let remotos: Array<Record<string, unknown>>;
  try {
    const resp = await fetch(`${base}/clientes-mestre`, {
      headers: { Authorization: `Bearer ${chave}` },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!resp.ok) return { ...vazio, motivo: await descreverResposta(resp) };
    const corpo = (await resp.json()) as { dados?: Array<Record<string, unknown>> };
    remotos = corpo.dados ?? [];
  } catch (e) {
    return { ...vazio, motivo: e instanceof Error ? e.message : "erro de rede" };
  }

  const { data: locais } = await supabase.from("clientes").select("id, doc, nome");
  type Local = { id: string; doc: string | null; nome: string };
  const porId = new Map<string, Local>(((locais ?? []) as Local[]).map((c) => [c.id, c]));
  const porDoc = new Map<string, Local>();
  for (const c of (locais ?? []) as Local[]) {
    const d = normalizarDoc(c.doc);
    if (d) porDoc.set(d, c);
  }

  const r: ResultadoReconciliacao = { ...vazio, lidos: remotos.length, conflitos: [] };

  for (const remoto of remotos) {
    const id = remoto.cliente_id ?? remoto.id;
    const nome = typeof remoto.nome === "string" ? remoto.nome.trim() : "";
    if (typeof id !== "string" || !nome) continue;

    const doc = typeof remoto.doc === "string" ? remoto.doc : null;
    const docNorm = normalizarDoc(doc);
    const colidente = docNorm ? porDoc.get(docNorm) : undefined;
    if (colidente && colidente.id !== id) {
      r.conflitos.push({
        cliente_id: id,
        nome,
        motivo: `documento já pertence ao cliente ${colidente.id} ("${colidente.nome}") aqui`,
      });
      continue;
    }

    const existia = porId.has(id);
    const { error } = await supabase.from("clientes").upsert(
      {
        id,
        nome,
        doc,
        email: typeof remoto.email === "string" ? remoto.email : null,
        tel: typeof remoto.tel === "string" ? remoto.tel : null,
        tipo: docNorm?.length === 14 ? "Pessoa Jurídica" : "Pessoa Física",
        origem: "dashboard",
        sincronizado_em: new Date().toISOString(),
      },
      { onConflict: "id" }
    );

    if (error) {
      r.conflitos.push({ cliente_id: id, nome, motivo: error.message });
      continue;
    }
    if (existia) r.atualizados++;
    else r.criados++;
  }

  return r;
}

// ─── RECONCILIAÇÃO DO CATÁLOGO: a que também PODA ───────────────────

export interface ResultadoReconciliacaoServicos {
  lidos: number;
  criados: number;
  atualizados: number;
  /** Linhas apagadas do espelho por não existirem mais na Dashboard. */
  podados: number;
  /** Nomes do que foi podado — some da tela, aparece no relatório. */
  podados_nomes: string[];
  /** Idade do retrato lido, em segundos. `null` se a Dashboard não a declarou. */
  retrato_idade_s: number | null;
  motivo?: string;
}

/**
 * Puxa o catálogo inteiro da Dashboard, concilia o espelho **e poda o que não
 * existe mais lá** — `D-90` (30/08/2026).
 *
 * ⚠️ **Por que precisou existir, medido em 30/08/2026.** O espelho só era
 * escrito por evento empurrado. Evento cobre o que muda depois que ele passou
 * a existir; **não cobre o que foi apagado**. O estado encontrado:
 *
 * | | Catálogo da Dashboard | `servicos_espelho` aqui |
 * |---|---|---|
 * | serviços | 20 | 15 |
 * | produtos do CRM | 11 | **0** |
 * | linhas `[DEMO]` | 0 (apagadas lá) | **7** |
 * | linhas de teste (`PROBE`, `Prova`) | 0 | **3** |
 * | última escrita | — | 28/08 15:58 |
 *
 * O dono via, na tela `Serviços`, um catálogo de dois dias antes cheio de
 * dado de demonstração que ele mandou apagar. Nada estava quebrado: o espelho
 * fazia exatamente o que sabia fazer — **acrescentar**.
 *
 * ⛔ **A poda é a metade perigosa, e por isso ela tem três travas:**
 *
 * 1. **`completo: false` cancela a poda.** Lista truncada pelo teto não é
 *    retrato do catálogo; podar por ela apagaria serviço vivo.
 * 2. **Só poda linha sincronizada ANTES de `gerado_em`.** O retrato é uma foto
 *    de um instante; serviço que chegou por evento **depois** dela é
 *    informação mais nova, e uma foto velha não desfaz o que veio depois.
 *    Sem esta regra, um serviço criado na Dashboard entre a produção do
 *    retrato e a leitura dele seria criado por evento e apagado pela poda —
 *    o clássico ir-e-voltar que ninguém consegue reproduzir.
 * 3. **Só poda o que é `fonte = 'dashboard'`.** Linha de outra origem não é
 *    espelho de nada que esta lista represente.
 *
 * ⚖️ **E poda de verdade, não marca inativo.** `servico.encerrado` é que marca
 * inativo, e o encerrado **continua vindo nesta lista** (a Dashboard exporta
 * inativo também). Chegar aqui como ausente significa que a linha não existe
 * mais no cadastro de origem — não que ela saiu do catálogo vendável.
 */
export async function reconciliarServicos(
  supabase: SupabaseClient
): Promise<ResultadoReconciliacaoServicos> {
  const vazio: ResultadoReconciliacaoServicos = {
    lidos: 0,
    criados: 0,
    atualizados: 0,
    podados: 0,
    podados_nomes: [],
    retrato_idade_s: null,
  };
  const { dashboardBase: base, dashboardApiKey: chave } = estadoIntegracao();
  if (!base || !chave) {
    return {
      ...vazio,
      motivo:
        "Reconciliação do catálogo não provisionada: defina SCOPE_DASHBOARD_API_BASE e SCOPE_DASHBOARD_API_KEY_OUT.",
    };
  }

  interface Exportado {
    dados?: Array<Record<string, unknown>>;
    completo?: boolean;
    gerado_em?: string;
    idade_s?: number;
  }

  let corpo: Exportado;
  try {
    const resp = await fetch(`${base}/servicos-catalogo`, {
      headers: { Authorization: `Bearer ${chave}` },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!resp.ok) return { ...vazio, motivo: await descreverResposta(resp) };
    corpo = (await resp.json()) as Exportado;
  } catch (e) {
    return { ...vazio, motivo: e instanceof Error ? e.message : "erro de rede" };
  }

  const remotos = corpo.dados ?? [];
  const geradoEm = typeof corpo.gerado_em === "string" ? corpo.gerado_em : null;
  const r: ResultadoReconciliacaoServicos = {
    ...vazio,
    lidos: remotos.length,
    retrato_idade_s: typeof corpo.idade_s === "number" ? corpo.idade_s : null,
    podados_nomes: [],
  };

  const { data: locais } = await supabase
    .from("servicos_espelho")
    .select("id, nome, fonte, sincronizado_em");
  type Local = { id: string; nome: string; fonte: string | null; sincronizado_em: string | null };
  const antes = new Set(((locais ?? []) as Local[]).map((s) => s.id));

  const texto = (v: unknown) => (typeof v === "string" && v ? v : null);
  const numero = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const agora = new Date().toISOString();
  const vistos = new Set<string>();

  for (const remoto of remotos) {
    const id = texto(remoto.servico_id) ?? texto(remoto.id);
    const nome = typeof remoto.nome === "string" ? remoto.nome.trim() : "";
    if (!id || !nome) continue;
    vistos.add(id);

    const ativo = remoto.ativo !== false;
    const { error } = await supabase.from("servicos_espelho").upsert(
      {
        id,
        nome,
        slug: texto(remoto.slug),
        area: texto(remoto.area),
        tipo_cobranca: texto(remoto.tipo_cobranca),
        preco_tabela: numero(remoto.preco_tabela),
        custo: numero(remoto.custo),
        recorrencia: texto(remoto.recorrencia),
        ativo,
        // Reconciliação não inventa data de encerramento: ela não sabe QUANDO
        // o serviço saiu do catálogo, só que ele está inativo agora. Quem sabe
        // a data é o evento `servico.encerrado`, e ele já a gravou.
        sincronizado_em: agora,
        fonte: "dashboard",
      },
      { onConflict: "id" }
    );
    if (error) continue;
    if (antes.has(id)) r.atualizados++;
    else r.criados++;
  }

  // ── A poda, com as três travas ────────────────────────────────────
  if (corpo.completo === true && geradoEm) {
    for (const local of (locais ?? []) as Local[]) {
      if (vistos.has(local.id)) continue;
      if ((local.fonte ?? "dashboard") !== "dashboard") continue;
      // Trava 2: nascido depois do retrato → informação mais nova que a foto.
      if (local.sincronizado_em && local.sincronizado_em > geradoEm) continue;
      const { error } = await supabase.from("servicos_espelho").delete().eq("id", local.id);
      if (error) continue;
      r.podados++;
      r.podados_nomes.push(local.nome);
    }
  } else if (corpo.completo !== true) {
    r.motivo =
      "A Dashboard declarou a lista INCOMPLETA (bateu no teto) — conciliei o que veio e NÃO podei: " +
      "apagar por lista truncada removeria serviço vivo.";
  }

  return r;
}
