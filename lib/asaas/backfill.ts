import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarUm, listarPagina } from "../asaas";
import { clienteDoAsaas, linhaDaAssinatura, linhaDaCobranca, linhaDaNota } from "./mapear";
import { asaasParaDataLocal } from "./webhook";

/**
 * O backfill: trazer para o ScopeFinance o que o gateway já sabia antes de o
 * webhook existir.
 *
 * ⚖️ **Por que ele é obrigatório e não um extra.** Medido em 28/08/2026: a
 * conta de produção do Asaas tem **22 clientes, 180 cobranças, 7 assinaturas e
 * 51 notas autorizadas**; este banco tinha 14 contas a receber e **nenhuma**
 * linha com vínculo Asaas. O webhook resolve o futuro e não toca no passado —
 * ligar só ele deixaria faturamento, MRR e inadimplência exibidos na Dashboard
 * sem relação nenhuma com o dinheiro que passou pelo gateway. E números que
 * ninguém consegue explicar corroem a confiança no painel inteiro.
 *
 * ⛔ **As três regras que este arquivo não quebra:**
 *
 *   1. **Nunca funde cliente.** Documento que já pertence a outro cadastro é
 *      recusa declarada (§2.4), reportada linha a linha. Escolher sozinho qual
 *      dos dois vale é escolher uma verdade para apagar — e aqui a verdade
 *      apagada pode ter nota fiscal emitida contra ela.
 *   2. **Nunca apaga.** Cliente que existe aqui e não no Asaas fica. A
 *      ausência num sistema não é ordem de exclusão no outro (`ESTADO §5.4`).
 *   3. **Nunca sobrescreve `valor_contratado`.** Ele é o combinado com o
 *      cliente, dono é o ScopeFinance (`RN-03`); o gateway só informa o
 *      cobrado (§4.7).
 *
 * A tradução dos objetos é a de `mapear.ts` — a MESMA que o webhook usa. Duas
 * traduções divergiriam, e a divergência só apareceria num relatório meses
 * depois, sem ninguém saber qual das duas está certa.
 */

export type Etapa =
  | "clientes"
  | "clientes-orfaos"
  | "assinaturas"
  | "cobrancas"
  | "notas"
  | "religar";

export interface Conflito {
  etapa: Etapa;
  asaas_id: string;
  documento?: string | null;
  nome?: string;
  motivo: string;
}

export interface ResultadoEtapa {
  etapa: Etapa;
  offset: number;
  lidos: number;
  criados: number;
  vinculados: number;
  atualizados: number;
  ignorados: number;
  conflitos: Conflito[];
  /** `true` quando ainda há página depois desta. */
  tem_mais: boolean;
  proximo_offset: number | null;
  /** `true` quando nada foi gravado — a passada de conferência. */
  seco: boolean;
}

function vazio(etapa: Etapa, offset: number, seco: boolean): ResultadoEtapa {
  return {
    etapa,
    offset,
    lidos: 0,
    criados: 0,
    vinculados: 0,
    atualizados: 0,
    ignorados: 0,
    conflitos: [],
    tem_mais: false,
    proximo_offset: null,
    seco,
  };
}

/**
 * Os campos que o gateway tem autoridade para atualizar num cliente que já
 * existe: contato e vínculo. Nunca procedência, nunca estado do cadastro.
 */
function somenteContato(linha: Record<string, unknown>): Record<string, unknown> {
  const permitidos = [
    "nome",
    "cpf",
    "cnpj",
    "razao_social",
    "email",
    "tel",
    "asaas_customer_id",
    "sincronizado_em",
  ];
  const saida: Record<string, unknown> = {};
  for (const c of permitidos) if (c in linha) saida[c] = linha[c];
  return saida;
}

export interface OpcoesBackfill {
  offset?: number;
  limite?: number;
  /** `true` conta o que faria e **não grava nada** — sempre rode assim antes. */
  seco?: boolean;
}

// ════════════════════════════════════════════════════════════════════
//  1. Clientes — a etapa que exige decisão, e por isso vem primeiro
// ════════════════════════════════════════════════════════════════════

/**
 * Concilia os `customer` do Asaas com o cadastro daqui.
 *
 * Quatro desfechos possíveis, e a ordem entre eles importa:
 *
 *   **já vinculado** → o `asaas_customer_id` bate; atualiza contato e segue.
 *   **vinculado agora** → o documento existe aqui e o cadastro ainda não tinha
 *     `asaas_customer_id`; grava o vínculo. É o caso bom: reconhecemos o mesmo
 *     cliente pelos dígitos, e nenhuma linha nova nasce.
 *   **criado** → documento inédito; nasce cliente com `origem = 'asaas'`.
 *   **conflito** → o documento já pertence a um cadastro que aponta para
 *     OUTRO `customer` do Asaas. Não funde, não cria, não escolhe. Reporta.
 *
 * ⚠️ **O conflito não é hipotético: ele existe na origem.** Medido em
 * 28/08/2026, dois `customer` diferentes do Asaas carregam o mesmo CNPJ
 * `32854081000183`. O primeiro vincula; o segundo é recusado por escrito, e
 * alguém decide. O índice único de `documento_principal` recusaria de qualquer
 * forma — mas com uma mensagem de banco, não com um relatório que diz o que
 * fazer a respeito.
 */
export async function backfillClientes(
  supabase: SupabaseClient,
  opts: OpcoesBackfill = {}
): Promise<ResultadoEtapa> {
  const offset = opts.offset ?? 0;
  const seco = opts.seco ?? false;
  const r = vazio("clientes", offset, seco);

  const pagina = await listarPagina<Record<string, unknown>>("/customers", offset, opts.limite ?? 100);
  r.lidos = pagina.data.length;
  r.tem_mais = pagina.hasMore;
  r.proximo_offset = pagina.hasMore ? offset + pagina.data.length : null;

  /**
   * Documentos reivindicados **dentro desta passada**.
   *
   * ⚖️ **Sem isto, a passada seca mente por omissão — e mente justamente sobre
   * o caso que importa.** Ela não grava nada, então o segundo `customer` com
   * um documento repetido não encontra o primeiro no banco (o primeiro nunca
   * foi gravado) e é contado como "criado". Resultado: o relatório que existe
   * para dizer *o que vai acontecer* esconderia o único conflito real da
   * importação, e ele só apareceria quando o índice único recusasse — no meio
   * da gravação, com metade do lote dentro.
   *
   * Medido em 28/08/2026: dois `customer` diferentes do Asaas carregam o mesmo
   * CNPJ `32854081000183`. Não é hipótese, é o dado.
   *
   * ⚠️ O conjunto vale por página. Duplicata separada por mais de 100 cadastros
   * escaparia da passada seca — mas não da gravação, onde o índice único do
   * banco é quem responde. A trava de verdade é o índice; isto é o aviso.
   */
  const reivindicados = new Map<string, string>();

  for (const bruto of pagina.data) {
    const { linha, documento, asaasId } = clienteDoAsaas(bruto);
    if (!asaasId) {
      r.ignorados++;
      continue;
    }

    const { data: porAsaas } = await supabase
      .from("clientes")
      .select("id")
      .eq("asaas_customer_id", asaasId)
      .maybeSingle();

    if (porAsaas) {
      if (!seco) {
        // ⛔ `status_cadastro` e `origem` ficam FORA do update: o cliente já
        // existia aqui e pode ter nascido pelo CRM ou pela Dashboard.
        // Reescrever a procedência apagaria a única marca de onde ele veio —
        // é a mesma razão pela qual `lib/resources.ts` mantém `origem` fora
        // das colunas graváveis pela tela.
        await supabase
          .from("clientes")
          .update(somenteContato(linha))
          .eq("id", (porAsaas as { id: string }).id);
      }
      r.atualizados++;
      continue;
    }

    if (!documento) {
      // Sem documento não há identidade, e sem identidade não há conciliação
      // possível. Nasce provisório: aparece na fila, e o §2.3 o impede de
      // gerar cobrança ou nota até alguém completar o cadastro.
      if (!seco) {
        const { error } = await supabase.from("clientes").insert(linha);
        if (error) {
          r.conflitos.push({
            etapa: "clientes",
            asaas_id: asaasId,
            documento: null,
            nome: String(linha.nome),
            motivo: error.message,
          });
          continue;
        }
      }
      r.criados++;
      continue;
    }

    const jaReivindicado = reivindicados.get(documento);
    if (jaReivindicado && jaReivindicado !== asaasId) {
      r.conflitos.push({
        etapa: "clientes",
        asaas_id: asaasId,
        documento,
        nome: String(linha.nome),
        motivo:
          `o documento ${documento} chega DUAS VEZES nesta importação: ` +
          `pelos customers ${jaReivindicado} e ${asaasId}. São dois cadastros do ` +
          `gateway para a mesma empresa — o primeiro entrou, este espera decisão humana.`,
      });
      continue;
    }
    reivindicados.set(documento, asaasId);

    const { data: porDoc } = await supabase
      .from("clientes")
      .select("id, nome, asaas_customer_id")
      .eq("documento_principal", documento)
      .maybeSingle();

    if (porDoc) {
      const alvo = porDoc as { id: string; nome: string; asaas_customer_id: string | null };
      if (alvo.asaas_customer_id && alvo.asaas_customer_id !== asaasId) {
        // ⛔ Recusa declarada, nunca fusão silenciosa (§2.4 / `ESTADO §8.6`).
        r.conflitos.push({
          etapa: "clientes",
          asaas_id: asaasId,
          documento,
          nome: String(linha.nome),
          motivo:
            `o documento ${documento} já pertence ao cliente ${alvo.id} ("${alvo.nome}"), ` +
            `que está vinculado a OUTRO customer do Asaas (${alvo.asaas_customer_id}). ` +
            `Dois cadastros do gateway para a mesma empresa — decisão humana.`,
        });
        if (!seco) {
          await supabase.from("clientes").update({ status_cadastro: "em_conflito" }).eq("id", alvo.id);
        }
        continue;
      }

      if (!seco) {
        const { error } = await supabase
          .from("clientes")
          .update({ asaas_customer_id: asaasId, sincronizado_em: new Date().toISOString() })
          .eq("id", alvo.id);
        if (error) {
          r.conflitos.push({
            etapa: "clientes",
            asaas_id: asaasId,
            documento,
            nome: alvo.nome,
            motivo: error.message,
          });
          continue;
        }
      }
      r.vinculados++;
      continue;
    }

    if (!seco) {
      const { error } = await supabase.from("clientes").insert(linha);
      if (error) {
        r.conflitos.push({
          etapa: "clientes",
          asaas_id: asaasId,
          documento,
          nome: String(linha.nome),
          motivo: error.message,
        });
        continue;
      }
    }
    r.criados++;
  }

  return r;
}

// ════════════════════════════════════════════════════════════════════
//  1b. Os clientes que a listagem não mostra
// ════════════════════════════════════════════════════════════════════

/**
 * Importa os `customer` **excluídos no Asaas** que ainda têm cobrança aqui.
 *
 * ⚠️ **O achado que criou esta etapa, medido em 28/08/2026.** Depois de
 * importar os 22 clientes que `GET /customers` devolve, sobraram **48
 * cobranças órfãs** distribuídas em **13 customers**. Consultados um a um por
 * id, todos respondem `200` com `"deleted": true` — a listagem padrão do Asaas
 * **omite cliente excluído**, e o `deletedOnly` não os separa. Sem esta etapa,
 * R$ de receita histórica ficariam para sempre sem dono, e nenhuma tela diria
 * por quê.
 *
 * ⛔ **Excluído lá não vira excluído aqui.** É a assimetria já decidida em
 * `ESTADO §5.4`: exclusão lógica atravessa a ponte, expurgo não. O cliente
 * entra com `status = 'Inativo'` — o que liga a cobrança ao dono **sem** somar
 * ao `clientes_ativos` do painel, que conta só `'Ativo'`. Omiti-lo seria
 * perder o vínculo; importá-lo como ativo seria inflar um indicador.
 *
 * A busca é **por id, a partir das próprias órfãs** — não por listagem. Só
 * traz o que faz falta, e não depende de um filtro da API se comportar.
 */
export async function backfillClientesOrfaos(
  supabase: SupabaseClient,
  opts: OpcoesBackfill = {}
): Promise<ResultadoEtapa> {
  const seco = opts.seco ?? false;
  const r = vazio("clientes-orfaos", 0, seco);

  const alvos = new Set<string>();
  for (const tabela of ["contas_receber", "assinaturas", "notas_fiscais"] as const) {
    const { data } = await supabase
      .from(tabela)
      .select("asaas_customer_id")
      .is("cliente_id", null)
      .not("asaas_customer_id", "is", null)
      .limit(2000);
    for (const linha of (data ?? []) as Array<{ asaas_customer_id: string }>) {
      alvos.add(linha.asaas_customer_id);
    }
  }

  r.lidos = alvos.size;
  const reivindicados = new Map<string, string>();

  for (const asaasId of alvos) {
    const { data: jaTem } = await supabase
      .from("clientes")
      .select("id")
      .eq("asaas_customer_id", asaasId)
      .maybeSingle();
    if (jaTem) {
      r.ignorados++;
      continue;
    }

    let bruto: Record<string, unknown> | null = null;
    try {
      bruto = await buscarUm<Record<string, unknown>>(`/customers/${asaasId}`);
    } catch (e) {
      r.conflitos.push({
        etapa: "clientes-orfaos",
        asaas_id: asaasId,
        motivo: `o Asaas não devolveu este customer: ${e instanceof Error ? e.message : "erro"}`,
      });
      continue;
    }
    if (!bruto) {
      r.ignorados++;
      continue;
    }

    const { linha, documento } = clienteDoAsaas(bruto);
    // ⛔ Excluído no gateway entra como Inativo, nunca como Ativo: liga a
    // cobrança ao dono sem inflar `clientes_ativos`.
    if (bruto.deleted === true) linha.status = "Inativo";

    if (documento) {
      const jaNesteLote = reivindicados.get(documento);
      if (jaNesteLote && jaNesteLote !== asaasId) {
        r.conflitos.push({
          etapa: "clientes-orfaos",
          asaas_id: asaasId,
          documento,
          nome: String(linha.nome),
          motivo: `o documento ${documento} chega duas vezes nesta etapa (customers ${jaNesteLote} e ${asaasId}) — decisão humana`,
        });
        continue;
      }
      reivindicados.set(documento, asaasId);

      const { data: porDoc } = await supabase
        .from("clientes")
        .select("id, nome, asaas_customer_id")
        .eq("documento_principal", documento)
        .maybeSingle();

      if (porDoc) {
        const alvo = porDoc as { id: string; nome: string; asaas_customer_id: string | null };
        if (alvo.asaas_customer_id && alvo.asaas_customer_id !== asaasId) {
          r.conflitos.push({
            etapa: "clientes-orfaos",
            asaas_id: asaasId,
            documento,
            nome: String(linha.nome),
            motivo:
              `o documento ${documento} já pertence ao cliente ${alvo.id} ("${alvo.nome}"), ` +
              `vinculado a outro customer (${alvo.asaas_customer_id}) — decisão humana`,
          });
          continue;
        }
        // ⚠️ Só o vínculo. O cadastro que já existe aqui pode ter vindo do CRM
        // ou da tela, e um customer EXCLUÍDO no gateway não tem autoridade
        // para reescrever nome, contato nem status de um cliente vivo.
        if (!seco) {
          await supabase
            .from("clientes")
            .update({ asaas_customer_id: asaasId, sincronizado_em: new Date().toISOString() })
            .eq("id", alvo.id);
        }
        r.vinculados++;
        continue;
      }
    }

    if (!seco) {
      const { error } = await supabase.from("clientes").insert(linha);
      if (error) {
        r.conflitos.push({
          etapa: "clientes-orfaos",
          asaas_id: asaasId,
          documento,
          nome: String(linha.nome),
          motivo: error.message,
        });
        continue;
      }
    }
    r.criados++;
  }

  return r;
}

// ════════════════════════════════════════════════════════════════════
//  Resolução de vínculo — a mesma consulta que o webhook faz
// ════════════════════════════════════════════════════════════════════

async function idPorAsaas(
  supabase: SupabaseClient,
  tabela: string,
  coluna: string,
  valor: string | null
): Promise<string | null> {
  if (!valor) return null;
  const { data } = await supabase.from(tabela).select("id").eq(coluna, valor).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

// ════════════════════════════════════════════════════════════════════
//  2. Assinaturas
// ════════════════════════════════════════════════════════════════════

export async function backfillAssinaturas(
  supabase: SupabaseClient,
  opts: OpcoesBackfill = {}
): Promise<ResultadoEtapa> {
  const offset = opts.offset ?? 0;
  const seco = opts.seco ?? false;
  const r = vazio("assinaturas", offset, seco);

  // ⛔ **`includeDeleted` não é zelo, é a única forma de a listagem estar
  // completa** (`L-163`, 04/09/2026). Medido na conta de produção:
  // `/subscriptions` devolve **8** e `?includeDeleted=true` devolve **34** —
  // as 26 restantes estão `INACTIVE` com `deleted: true`, e **113 cobranças
  // reais apontam para 31 assinaturas distintas**. Sem elas aqui, 80 dessas
  // cobranças ficam com `assinatura_id` nulo, a Dashboard não tem por onde
  // ligar o pagamento a quem prestou o serviço, e o motor de comissão lê
  // pagamento e cria zero — verde, calado, todo dia.
  //
  // ⚖️ É a MESMA lição que `buscarUm` já carrega para `/customers` (§ do
  // `lib/asaas.ts`): **a listagem do Asaas omite o excluído, e o excluído tem
  // dinheiro real atrás**. Assinatura cancelada entra como `Cancelada` —
  // `statusDaAssinatura` já traduz `INACTIVE` assim —, e `calcularMrr` só
  // soma `Ativa`, então nenhum número exibido se move por causa disto.
  const pagina = await listarPagina<Record<string, unknown>>(
    "/subscriptions?includeDeleted=true",
    offset,
    opts.limite ?? 100
  );
  r.lidos = pagina.data.length;
  r.tem_mais = pagina.hasMore;
  r.proximo_offset = pagina.hasMore ? offset + pagina.data.length : null;

  for (const bruto of pagina.data) {
    const mapeada = linhaDaAssinatura(bruto);
    if (!mapeada) {
      r.ignorados++;
      continue;
    }
    const { linha, vinculos, cicloDesconhecido } = mapeada;
    const asaasId = linha.asaas_subscription_id as string;

    if (cicloDesconhecido) {
      // ⛔ Ciclo que não sabemos traduzir não vira `mensal` por conveniência:
      // uma semestral rotulada de mensal multiplica o MRR por seis.
      r.conflitos.push({
        etapa: "assinaturas",
        asaas_id: asaasId,
        motivo: `ciclo "${cicloDesconhecido}" desconhecido — a assinatura entra sem ciclo, e o MRR não a conta até alguém classificar`,
      });
    }

    const clienteId = await idPorAsaas(supabase, "clientes", "asaas_customer_id", vinculos.customer);
    if (clienteId) linha.cliente_id = clienteId;

    const existenteId = await idPorAsaas(supabase, "assinaturas", "asaas_subscription_id", asaasId);

    if (!seco) {
      const { error } = existenteId
        ? await supabase.from("assinaturas").update(linha).eq("id", existenteId)
        : await supabase.from("assinaturas").insert({
            ...linha,
            inicio: asaasParaDataLocal(bruto.dateCreated) ?? new Date().toISOString().slice(0, 10),
          });
      if (error) {
        r.conflitos.push({ etapa: "assinaturas", asaas_id: asaasId, motivo: error.message });
        continue;
      }
    }
    if (existenteId) r.atualizados++;
    else r.criados++;
  }

  return r;
}

// ════════════════════════════════════════════════════════════════════
//  3. Cobranças — a etapa grande, 180 linhas
// ════════════════════════════════════════════════════════════════════

export async function backfillCobrancas(
  supabase: SupabaseClient,
  opts: OpcoesBackfill = {}
): Promise<ResultadoEtapa> {
  const offset = opts.offset ?? 0;
  const seco = opts.seco ?? false;
  const r = vazio("cobrancas", offset, seco);

  const pagina = await listarPagina<Record<string, unknown>>("/payments", offset, opts.limite ?? 50);
  r.lidos = pagina.data.length;
  r.tem_mais = pagina.hasMore;
  r.proximo_offset = pagina.hasMore ? offset + pagina.data.length : null;

  for (const bruto of pagina.data) {
    const mapeada = linhaDaCobranca(bruto);
    if (!mapeada) {
      r.ignorados++;
      continue;
    }
    const { linha, vinculos } = mapeada;
    const asaasId = linha.asaas_payment_id as string;

    const clienteId = await idPorAsaas(supabase, "clientes", "asaas_customer_id", vinculos.customer);
    if (clienteId) linha.cliente_id = clienteId;

    const assinaturaId = await idPorAsaas(
      supabase,
      "assinaturas",
      "asaas_subscription_id",
      vinculos.subscription
    );
    if (assinaturaId) linha.assinatura_id = assinaturaId;
    // ⛔ **Cobrança que NOMEIA uma assinatura ausente vira conflito, não
    // silêncio** (`L-163`). Até 04/09/2026 este `if` sem `else` era o defeito
    // inteiro: o gateway dizia `subscription: sub_…`, a consulta não achava, a
    // linha era gravada com `assinatura_id` nulo e a importação reportava
    // `criados: 50, conflitos: []`. A perda só aparecia dois sistemas adiante,
    // como comissão que não nasce.
    //
    // ⚖️ Ele não interrompe a gravação de propósito: a cobrança é fato do
    // gateway e tem de entrar de qualquer jeito. O que muda é que a falta
    // passa a ter **nome, id e contagem** em quem roda o backfill.
    else if (vinculos.subscription) {
      r.conflitos.push({
        etapa: "cobrancas",
        asaas_id: asaasId,
        motivo:
          `a cobrança aponta para a assinatura ${vinculos.subscription}, que não existe ` +
          `neste banco — rode a etapa "assinaturas" antes desta`,
      });
    }

    const existenteId = await idPorAsaas(supabase, "contas_receber", "asaas_payment_id", asaasId);

    if (!seco) {
      const { error } = existenteId
        ? // ⛔ Sem `valor_contratado`: quem já está aqui pode ter sido editado
          // por um humano, e o gateway não tem autoridade sobre esse campo.
          await supabase.from("contas_receber").update(linha).eq("id", existenteId)
        : await supabase
            .from("contas_receber")
            .insert({ ...linha, valor_contratado: linha.valor_cobrado });
      if (error) {
        r.conflitos.push({ etapa: "cobrancas", asaas_id: asaasId, motivo: error.message });
        continue;
      }
    }
    if (existenteId) r.atualizados++;
    else r.criados++;
  }

  return r;
}

// ════════════════════════════════════════════════════════════════════
//  4. Notas fiscais
// ════════════════════════════════════════════════════════════════════

export async function backfillNotas(
  supabase: SupabaseClient,
  opts: OpcoesBackfill = {}
): Promise<ResultadoEtapa> {
  const offset = opts.offset ?? 0;
  const seco = opts.seco ?? false;
  const r = vazio("notas", offset, seco);

  const pagina = await listarPagina<Record<string, unknown>>("/invoices", offset, opts.limite ?? 50);
  r.lidos = pagina.data.length;
  r.tem_mais = pagina.hasMore;
  r.proximo_offset = pagina.hasMore ? offset + pagina.data.length : null;

  for (const bruto of pagina.data) {
    const mapeada = linhaDaNota(bruto);
    if (!mapeada) {
      r.ignorados++;
      continue;
    }
    const { linha, vinculos } = mapeada;
    const asaasId = linha.asaas_invoice_id as string;

    const clienteId = await idPorAsaas(supabase, "clientes", "asaas_customer_id", vinculos.customer);
    if (clienteId) linha.cliente_id = clienteId;

    const contaId = await idPorAsaas(
      supabase,
      "contas_receber",
      "asaas_payment_id",
      vinculos.payment
    );
    if (contaId) linha.conta_receber_id = contaId;

    const existenteId = await idPorAsaas(supabase, "notas_fiscais", "asaas_invoice_id", asaasId);

    if (!seco) {
      const { error } = existenteId
        ? await supabase.from("notas_fiscais").update(linha).eq("id", existenteId)
        : await supabase.from("notas_fiscais").insert(linha);
      if (error) {
        r.conflitos.push({ etapa: "notas", asaas_id: asaasId, motivo: error.message });
        continue;
      }
    }
    if (existenteId) r.atualizados++;
    else r.criados++;
  }

  return r;
}

// ════════════════════════════════════════════════════════════════════
//  5. Religar os órfãos
// ════════════════════════════════════════════════════════════════════

/**
 * Liga ao cliente as linhas que chegaram antes dele.
 *
 * ⚖️ **Por que órfão existe, e por que isso é certo.** O webhook grava a
 * cobrança mesmo quando o `customer` ainda não é conhecido aqui — porque a
 * alternativa seria o gateway criar cliente sozinho, e o §1.1 proíbe isso: o
 * Asaas *"não pode ser origem de cliente novo sem passar pela conciliação por
 * documento"*. Perder a cobrança seria pior que guardá-la desvinculada.
 *
 * Esta função é o segundo tempo dessa decisão: assim que o cliente existe —
 * pela conciliação, pelo CRM ou pela tela — as linhas que o esperavam
 * encontram o dono. Sem ela, "guardar desvinculada" viraria "guardar para
 * sempre desvinculada", que é o cemitério silencioso que o §2.3 descreve.
 */
export async function religarOrfaos(
  supabase: SupabaseClient,
  seco = false
): Promise<{
  etapa: Etapa;
  contas: number;
  assinaturas: number;
  notas: number;
  /** Assinaturas encerradas que ganharam a data de fim — ver `datarEncerradas`. */
  datadas: number;
  seco: boolean;
}> {
  const r = { etapa: "religar" as Etapa, contas: 0, assinaturas: 0, notas: 0, datadas: 0, seco };

  const { data: clientes } = await supabase
    .from("clientes")
    .select("id, asaas_customer_id")
    .not("asaas_customer_id", "is", null);

  const tabelas = [
    ["contas_receber", "contas"],
    ["assinaturas", "assinaturas"],
    ["notas_fiscais", "notas"],
  ] as const;

  for (const c of (clientes ?? []) as Array<{ id: string; asaas_customer_id: string }>) {
    for (const [tabela, campo] of tabelas) {
      // `asaas_customer_id` viaja na própria linha desde a migração de
      // 28/08/2026 — é o que torna isto um `where`, e não uma varredura de
      // JSON que funcionaria só em `notas_fiscais` (a única com `payload`) e
      // falharia calada nas outras duas.
      const { data: orfas } = await supabase
        .from(tabela)
        .select("id")
        .is("cliente_id", null)
        .eq("asaas_customer_id", c.asaas_customer_id);

      const ids = ((orfas ?? []) as Array<{ id: string }>).map((o) => o.id);
      if (ids.length === 0) continue;

      if (!seco) {
        await supabase.from(tabela).update({ cliente_id: c.id }).in("id", ids);
      }
      r[campo] += ids.length;
    }
  }

  r.datadas = await datarEncerradas(supabase, seco);
  return r;
}

/**
 * Carimba `fim` na assinatura encerrada, com a data da **última cobrança
 * paga** dela.
 *
 * ⛔ **O Asaas não guarda data de cancelamento.** A assinatura excluída volta
 * com `deleted: true` e `endDate` no FUTURO — `endDate` é o fim previsto do
 * contrato, não o dia em que ela morreu. Usar `endDate` gravaria um
 * encerramento que ainda não aconteceu; deixar nulo faz quem consome carimbar
 * *"hoje"*, que é a data em que alguém olhou, não a em que o compromisso
 * acabou. Ambas são falsas, de jeitos diferentes.
 *
 * ⚖️ **A última cobrança paga é o único fato nosso sobre isso** — e é a
 * fronteira certa: depois dela o cliente não pagou mais. Medido em
 * 04/09/2026: 23 das 26 assinaturas encerradas têm cobrança paga e ganham
 * data; as 3 sem nenhuma continuam nulas, porque inventar uma data para uma
 * assinatura que nunca cobrou seria pior que a ausência.
 *
 * ⚠️ Roda **depois** das cobranças, de propósito: ela lê o que a etapa
 * anterior acabou de vincular. Por isso mora em `religar`, que é a última.
 */
async function datarEncerradas(supabase: SupabaseClient, seco: boolean): Promise<number> {
  const { data: encerradas } = await supabase
    .from("assinaturas")
    .select("id")
    .neq("status", "Ativa")
    .is("fim", null)
    .limit(5_000);

  let datadas = 0;
  for (const a of (encerradas ?? []) as Array<{ id: string }>) {
    const { data: ultima } = await supabase
      .from("contas_receber")
      .select("pago_em")
      .eq("assinatura_id", a.id)
      .eq("status", "Pago")
      .not("pago_em", "is", null)
      .order("pago_em", { ascending: false })
      .limit(1)
      .maybeSingle();

    const fim = (ultima as { pago_em: string } | null)?.pago_em;
    if (!fim) continue;

    if (!seco) {
      await supabase.from("assinaturas").update({ fim }).eq("id", a.id);
    }
    datadas++;
  }
  return datadas;
}
