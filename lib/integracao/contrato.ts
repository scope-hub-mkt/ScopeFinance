/**
 * O contrato entre o ScopeFinance (CFO) e a Scope Dashboard (CEO).
 *
 * ⚖️ **A relação foi definida pelo dono em 25/08/2026:** os dois sistemas têm
 * poder equivalente e papéis distintos — compartilham o núcleo de dados, não
 * uma hierarquia. O cadastro de cliente nasce em qualquer um dos dois e
 * replica para o outro **com o mesmo `id`**.
 *
 * A fonte de verdade do formato é `docs/03-CONTRATO-DE-INTEGRACAO ✅.md` da
 * Dashboard, e o consumidor real é o `lib/scopefinance.ts` de lá. Este arquivo
 * é deliberadamente **puro**: nenhuma linha toca banco, rede ou `process.env`.
 * É o que torna o contrato testável sem infraestrutura — e o Gate G0 apontou a
 * ausência de testes aqui como risco aceito (`D-18`), não como coisa boa.
 */

// ─── Formatos que a Dashboard consome ───────────────────────────────

/** `ClienteFinance` em `lib/scopefinance.ts` da Dashboard. */
export interface ClienteContrato {
  cliente_id: string;
  nome: string;
  doc: string | null;
  email: string | null;
  tel: string | null;
  status: string | null;
  /**
   * Desde quando este cliente é cliente — `YYYY-MM-DD`, ou `null`.
   *
   * ⚖️ **É a data da PRIMEIRA COBRANÇA no Asaas, e a escolha é de evidência**
   * (`D-107`, 04/09/2026). Nenhum `created_at` dos dois cadastros serve: os 31
   * clientes deste banco nasceram em 04/09/2026 01:35, no mesmo minuto, porque
   * essa é a data da importação do gateway. Usá-la faria a Dashboard afirmar
   * que a Scope conhece a carteira inteira desde anteontem.
   *
   * ⚠️ **Pode ser posterior ao primeiro contato comercial** — é o instante em
   * que a relação passou a gerar fato financeiro, não o dia em que alguém
   * apertou a mão. Por isso o nome é `cliente_desde`, não `conhecido_desde`.
   *
   * ⛔ `null` quando não há cobrança nenhuma: cliente cadastrado e ainda não
   * faturado existe, e inventar uma data para ele seria pior que o traço.
   */
  cliente_desde: string | null;
}

/**
 * Um pagamento efetivamente **recebido** — o fato gerador da comissão
 * (`RN-06` da Dashboard). Parcela vincenda, apenas faturada ou inadimplida
 * **não** aparece aqui: é o que impede a Dashboard de antecipar comissão
 * sobre dinheiro que não entrou.
 */
export interface PagamentoContrato {
  referencia: string;
  cliente_id: string;
  contrato_id: string | null;
  valor_bruto: number;
  deducoes: number;
  recebido_em: string;
  fonte: string;
}

export interface ResumoContrato {
  faturamento_mes: number;
  recebido_mes: number;
  inadimplencia: number;
  mrr: number;
  clientes_ativos: number;
  fonte: string;
}

export interface PontoMensalContrato {
  periodo: string; // 'YYYY-MM'
  faturamento: number;
  recebido: number;
  /**
   * `RNF-19` — todo número declara de onde veio.
   *
   * ⚠️ Entrou por ponto, e não num envelope em volta da lista, porque a rota
   * devolve um array e envelopá-la mudaria o formato que a Dashboard já
   * consome. Campo novo em objeto existente é aditivo; troca de forma não é.
   */
  fonte?: string;
}

/**
 * De onde o número saiu — `RNF-19`.
 *
 * ♻️ **Deixou de ser só "scopefinance" em 03/09/2026** (`D-99`, `RN-51`). O
 * ScopeFinance continua sendo quem responde e quem é dono do número, mas o
 * **fato** passou a nascer no gateway: as quatro rotas da ponte entregam só
 * linha com `origem_lancamento = 'asaas'`. Dizer apenas "scopefinance"
 * descreveria o mensageiro e calaria sobre a origem, que é justamente o que a
 * decisão do dono fixou.
 *
 * ⛔ Nada compara este valor por igualdade — conferido nos dois repositórios
 * antes de mudá-lo. Ele é declaração para leitura humana, e o dia em que
 * virar chave de decisão precisa de constante própria, não deste texto.
 */
export const FONTE = "asaas via scopefinance";

// ─── Linhas cruas do banco, no mínimo que os cálculos precisam ──────

export interface LinhaReceber {
  id: string;
  cliente_id: string | null;
  contrato_id: string | null;
  valor: number | string | null;
  valor_pago: number | string | null;
  deducoes: number | string | null;
  vencimento: string | null;
  status: string;
  pago_em: string | null;
}

export interface LinhaAssinatura {
  valor: number | string | null;
  ciclo: string;
  status: string;
}

export interface LinhaCliente {
  id: string;
  nome: string;
  doc: string | null;
  email: string | null;
  tel: string | null;
  status: string | null;
  /**
   * `min(vencimento)` das cobranças do cliente — calculado por quem lê o
   * banco, não aqui. Este arquivo continua puro (nenhuma linha toca banco),
   * e é o que o mantém testável sem infraestrutura.
   */
  primeiro_vencimento?: string | null;
}

const num = (v: number | string | null | undefined): number => Number(v ?? 0) || 0;

/**
 * Dinheiro em **centavos inteiros**, para somar sem erro de ponto flutuante.
 *
 * ⚠️ **O sintoma que trouxe isto para cá, medido em 28/08/2026.** Depois do
 * backfill do Asaas, `/resumo` passou a devolver
 * `"recebido_mes": 7890.870000000001`. Com 14 contas o defeito nunca apareceu;
 * com 194 ele apareceu no primeiro dia. Somar `0.1 + 0.2` em JavaScript não dá
 * `0.3`, e cada parcela acrescenta um resíduo.
 *
 * ⛔ Não é problema de formatação. Este número atravessa a ponte e a Dashboard
 * o exibe **sem recalcular** (`RN-01`) — o resíduo é o que ela mostra, e o
 * total do relatório passa a divergir do extrato por centavos que ninguém
 * consegue explicar. É a armadilha 2 do §4.10 do plano, do lado de dentro.
 */
const cents = (v: number | string | null | undefined): number => Math.round(num(v) * 100);
const reais = (c: number): number => c / 100;

/**
 * O que a Scope realmente recebeu numa conta baixada.
 *
 * `valor_pago` só existe quando alguém informou na baixa; sem ele, o valor
 * cobrado é a melhor aproximação disponível — declarada, não inventada.
 */
export function valorRecebido(linha: Pick<LinhaReceber, "valor" | "valor_pago">): number {
  return linha.valor_pago == null ? num(linha.valor) : num(linha.valor_pago);
}

/** `RN-04`: a base da comissão é líquida — bruto recebido menos deduções. */
export function baseLiquida(
  linha: Pick<LinhaReceber, "valor" | "valor_pago" | "deducoes">
): number {
  return valorRecebido(linha) - num(linha.deducoes);
}

export function clienteParaContrato(c: LinhaCliente): ClienteContrato {
  return {
    cliente_id: c.id,
    nome: c.nome,
    doc: c.doc,
    email: c.email,
    tel: c.tel,
    status: c.status,
    // ⚠️ Normaliza para `YYYY-MM-DD`: o Postgres devolve `date` como string
    // já nesse formato, mas um `timestamptz` vindo por engano traria hora e
    // fuso — e a Dashboard grava isto numa coluna `date`.
    cliente_desde: c.primeiro_vencimento ? String(c.primeiro_vencimento).slice(0, 10) : null,
  };
}

/**
 * Converte contas baixadas em pagamentos recebidos.
 *
 * Descarta linha sem `cliente_id` ou sem `pago_em`: a comissão precisa saber
 * de quem e quando, e um pagamento órfão viraria comissão sem dono na tela do
 * colaborador da Dashboard.
 */
export function pagamentosDeReceber(linhas: LinhaReceber[]): PagamentoContrato[] {
  return linhas
    .filter((l) => l.status === "Pago" && l.pago_em && l.cliente_id)
    .map((l) => ({
      referencia: l.id,
      cliente_id: l.cliente_id as string,
      contrato_id: l.contrato_id,
      valor_bruto: valorRecebido(l),
      deducoes: num(l.deducoes),
      recebido_em: l.pago_em as string,
      fonte: FONTE,
    }));
}

/**
 * Quantos meses cada ciclo cobre — o divisor que normaliza tudo para o mês.
 *
 * ⚖️ **Por que a tabela cresceu em 28/08/2026.** Até então o cálculo conhecia
 * três ciclos (`anual`, `trimestral`, e tudo o mais como mensal). Isso bastava
 * enquanto as assinaturas nasciam só pela tela daqui — medido, as 6 existentes
 * são todas mensais. A entrada do Asaas muda a premissa: ele emite
 * `WEEKLY`, `BIWEEKLY`, `BIMONTHLY` e `SEMIANNUALLY` também, e uma assinatura
 * semestral tratada como mensal **multiplica o MRR por seis**.
 *
 * ⛔ O erro não levantaria exceção nenhuma: sairia um número maior, com cara
 * de certa, num painel que a Dashboard exibe sem recalcular (`RN-01`). É
 * exatamente a armadilha que o §4.10 do plano descreve.
 *
 * Ciclos mais curtos que o mês têm fator menor que 1 de propósito: uma
 * cobrança semanal de R$ 100 vale ~R$ 433 por mês, não R$ 100.
 */
export const MESES_POR_CICLO: Record<string, number> = {
  semanal: 12 / 52,
  quinzenal: 12 / 26,
  mensal: 1,
  bimestral: 2,
  trimestral: 3,
  semestral: 6,
  anual: 12,
};

/** Receita recorrente mensal — todo ciclo normalizado para o mês. */
export function calcularMrr(assinaturas: LinhaAssinatura[]): number {
  return reais(
    assinaturas
    .filter((a) => a.status === "Ativa")
    .reduce((soma, a) => {
      // Ciclo que ninguém cadastrou cai em mensal, que é o comportamento
      // desde sempre. Não é palpite melhor — é o palpite ANTIGO, mantido para
      // que esta mudança não mexa em nenhum número que já estava certo. O
      // caminho que evita o palpite é `cicloDoAsaas`, que recusa gravar ciclo
      // que não reconhece.
      const meses = MESES_POR_CICLO[a.ciclo] ?? 1;
      return soma + Math.round(cents(a.valor) / meses);
    }, 0)
  );
}

/** Último dia do mês de uma data ISO — usado como teto da janela do mês. */
export function fimDoMes(iso: string): string {
  const [ano, mes] = iso.slice(0, 7).split("-").map(Number);
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${iso.slice(0, 7)}-${String(ultimo).padStart(2, "0")}`;
}

/**
 * O resumo do painel da Dashboard (`RF-01`), calculado **aqui** — `RN-01` diz
 * que o ScopeFinance é dono do número financeiro e a Dashboard nunca
 * recalcula. Se este cálculo mudar, ele muda num lugar só.
 *
 * `hoje` entra por parâmetro para o teste não depender do relógio da máquina.
 */
export function calcularResumo(
  receber: LinhaReceber[],
  assinaturas: LinhaAssinatura[],
  clientesAtivos: number,
  hoje: string
): ResumoContrato {
  const inicioMes = hoje.slice(0, 7) + "-01";
  const fimMes = fimDoMes(hoje);
  // ⛔ Acumuladores em CENTAVOS INTEIROS — ver `cents` acima.
  let faturamento = 0;
  let recebido = 0;
  let inadimplente = 0;

  for (const c of receber) {
    if (c.vencimento && c.vencimento >= inicioMes && c.vencimento <= fimMes) {
      faturamento += cents(c.valor);
    }
    if (c.status === "Pago" && c.pago_em && c.pago_em >= inicioMes) {
      recebido += cents(valorRecebido(c));
    }
    // Vencida e não baixada. Cancelada NÃO é inadimplência — é conta que
    // deixou de existir, e somá-la inflaria o vermelho do painel de lá.
    if (c.status !== "Pago" && c.status !== "Cancelado" && c.vencimento && c.vencimento < hoje) {
      inadimplente += cents(c.valor);
    }
  }

  return {
    faturamento_mes: reais(faturamento),
    recebido_mes: reais(recebido),
    inadimplencia: reais(inadimplente),
    mrr: calcularMrr(assinaturas),
    clientes_ativos: clientesAtivos,
    fonte: FONTE,
  };
}

/** Os N períodos 'YYYY-MM' terminando no mês de `hoje`, do mais antigo ao atual. */
export function periodosAte(hoje: string, meses: number): string[] {
  const [ano, mes] = hoje.slice(0, 7).split("-").map(Number);
  const out: string[] = [];
  for (let i = meses - 1; i >= 0; i--) {
    out.push(new Date(Date.UTC(ano, mes - 1 - i, 1)).toISOString().slice(0, 7));
  }
  return out;
}

/**
 * Série mensal dos mini-gráficos (`RF-01`/`RF-02` da Dashboard).
 *
 * Devolve **todos** os períodos da janela, inclusive os zerados — a Dashboard
 * distingue "mês sem faturamento" (ponto em zero) de "sem dado" (série
 * vazia), e omitir o mês vazio aqui apagaria essa diferença lá.
 */
export function calcularSerie(
  receber: LinhaReceber[],
  hoje: string,
  meses: number
): PontoMensalContrato[] {
  const mapa = new Map<string, PontoMensalContrato>(
    periodosAte(hoje, meses).map((p) => [
      p,
      // `RNF-19` — a fonte viaja no ponto ZERADO também, de propósito: é
      // justamente o mês sem movimento que precisa dizer se o zero foi
      // apurado ou é ausência de dado.
      { periodo: p, faturamento: 0, recebido: 0, fonte: FONTE },
    ])
  );

  for (const c of receber) {
    if (c.vencimento) {
      const alvo = mapa.get(c.vencimento.slice(0, 7));
      if (alvo) alvo.faturamento += cents(c.valor);
    }
    if (c.status === "Pago" && c.pago_em) {
      const alvo = mapa.get(c.pago_em.slice(0, 7));
      if (alvo) alvo.recebido += cents(valorRecebido(c));
    }
  }

  // Os pontos acumularam em centavos; a série sai em reais, sem resíduo.
  return [...mapa.values()].map((p) => ({
    periodo: p.periodo,
    faturamento: reais(p.faturamento),
    recebido: reais(p.recebido),
  }));
}

// ─── Eventos ────────────────────────────────────────────────────────

/** Envelope de evento — idêntico nos dois sentidos (`03` §4.2/§4.3). */
export interface Envelope {
  evento: string;
  id: string;
  criado_em: string;
  dados: Record<string, unknown>;
}

export type ResultadoEvento =
  | { acao: "criar" | "atualizar"; cliente: Record<string, unknown> }
  | { acao: "ignorar"; motivo: string };

/** Só dígitos — a mesma normalização dos dois lados. */
export function normalizarDoc(doc: string | null | undefined): string | null {
  if (!doc) return null;
  const so = doc.replace(/[^0-9]/g, "");
  return so || null;
}

/**
 * Traduz um evento da Dashboard para a escrita que ele significa aqui.
 *
 * ⚠️ **A Dashboard emite `cliente.criado` com DOIS formatos diferentes** —
 * medido em 25/08/2026 em `lib/dominio/clientes.ts` de lá: o CRUD e a
 * importação mandam `{cliente_id, nome, doc, fonte}`, e a criação de perfil
 * comercial manda `{cliente_id, setor, porte, status}`, sem nome. O segundo
 * não é cadastro de cliente — é extensão comercial, que não existe aqui.
 * Ignorar com motivo declarado é a leitura correta; criar um cliente chamado
 * "undefined" seria a errada.
 */
export function interpretarEvento(env: Envelope): ResultadoEvento {
  const d = env.dados ?? {};
  const clienteId = typeof d.cliente_id === "string" ? d.cliente_id : null;

  if (env.evento !== "cliente.criado" && env.evento !== "cliente.atualizado") {
    return { acao: "ignorar", motivo: `evento "${env.evento}" não tem efeito no financeiro` };
  }
  if (!clienteId) {
    return { acao: "ignorar", motivo: "evento sem cliente_id" };
  }
  const nome = typeof d.nome === "string" ? d.nome.trim() : "";
  if (!nome) {
    return {
      acao: "ignorar",
      motivo: "payload sem nome — é o formato de perfil comercial, que não é cadastro de cliente",
    };
  }

  const doc = typeof d.doc === "string" ? d.doc : null;
  return {
    acao: env.evento === "cliente.criado" ? "criar" : "atualizar",
    cliente: {
      id: clienteId,
      nome,
      doc,
      email: typeof d.email === "string" ? d.email : null,
      tel: typeof d.tel === "string" ? d.tel : null,
      tipo: normalizarDoc(doc)?.length === 14 ? "Pessoa Jurídica" : "Pessoa Física",
      // ⚠️ **`status` só entra se o payload trouxer.** Ele é campo NOSSO: a
      // Dashboard não tem coluna de status em `clientes` e nunca o envia. Fixar
      // "Ativo" aqui fazia toda `cliente.atualizado` RESSUSCITAR um cliente
      // inativado daqui — bastava corrigir o nome lá para ele voltar a contar
      // no `/resumo`, sem ninguém pedir e sem nada registrar. Omitido, o
      // upsert não toca a coluna; na criação, quem responde é o
      // `default 'Ativo'` do schema, que é o lugar certo desse padrão.
      ...(typeof d.status === "string" ? { status: d.status } : {}),
      origem: "dashboard",
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
//  Serviços contratados — a terceira perna da ponte
// ═══════════════════════════════════════════════════════════════════
//
// ⚖️ **Por que este bloco precisou existir, medido em 28/08/2026.** A ponte
// com a Dashboard tinha duas pernas construídas e uma faltando:
//
//   1. cliente   → Dashboard   (`/clientes` + `importar-clientes-finance`)  ✅
//   2. catálogo  → ScopeFinance (`cron/servicos-espelho` → `servicos_espelho`) ✅
//   3. **quem contratou o quê** → **não existia em nenhum sentido**          ⛔
//
// O sintoma foi a tela `Serviços` da Dashboard: 36 clientes importados, 5
// serviços no catálogo e o tile "Serviços mais contratados" afirmando **zero**
// em todas as linhas. O tile estava certo — `cliente_servicos` tinha 0 linhas,
// porque o compromisso comercial mora aqui, em `contratos` e `assinaturas`, e
// nada o atravessava.
//
// ⛔ **`/vendas` não resolvia isto e não deveria.** Lá a linha é a *parcela*
// ("Parcela 10 de 10."), e o nome do serviço não sobrevive à cobrança. O que a
// Dashboard precisa é do **compromisso**, não do lançamento dele.

/** Um compromisso de receita ativo — item de contrato ou assinatura, achatados. */
export interface ServicoContratadoContrato {
  /**
   * Id da linha de origem. É a chave de idempotência do outro lado.
   *
   * ♻️ **Passou a ser o id do ITEM em 31/08/2026**, quando o contrato ganhou N
   * serviços. Era o id do contrato — e continuar assim faria os N itens de um
   * contrato chegarem lá com a mesma referência, indistinguíveis.
   *
   * ⛔ A troca **não duplica nada** do outro lado: a reconciliação da Dashboard
   * casa por `(cliente, serviço)` e usa `origem_referencia` apenas para gravar
   * a procedência. Conferido em `lib/dominio/servicos-contratados.ts` de lá
   * ANTES de mudar — o que ela faz ao ver referência nova é atualizar a linha
   * existente, não criar outra.
   */
  referencia: string;
  origem: "contrato" | "assinatura";
  cliente_id: string;
  /**
   * O contrato a que este serviço pertence. **Nunca nulo quando
   * `origem = "contrato"`** — é a regra do dono, *"um serviço deve possuir um
   * contrato"*, atravessando a ponte.
   *
   * Assinatura vem nula: ela não está dentro de um contrato, ela É o
   * compromisso.
   */
  contrato_id: string | null;
  /**
   * Como chamar esse contrato na tela do outro lado, onde não existe tabela de
   * contratos. Resumo dos itens + período — o suficiente para agrupar e
   * reconhecer, sem obrigar a Dashboard a espelhar mais uma tabela.
   */
  contrato_rotulo: string | null;
  /**
   * O item do catálogo, **quando quem vendeu já disse qual é**.
   *
   * ⚖️ Isto é o que a ligação `1:N` comprou de verdade. Até 31/08/2026 o
   * rótulo viajava como texto puro e a Dashboard adivinhava o serviço por
   * casamento de substring (`servico_mapa_finance`) — um mapa que o dono
   * mantém à mão e que **cala sobre todo rótulo novo** até alguém cadastrá-lo.
   * Com o item apontando para `servicos_espelho`, cujo `id` é o MESMO do
   * catálogo dela, não há o que adivinhar.
   *
   * ⛔ Nulo continua sendo caso normal — item sob medida não é catálogo, e o
   * mapa de rótulos segue valendo como plano B.
   */
  servico_id: string | null;
  /**
   * O texto que descreve o serviço. Para item de contrato é a `descricao`
   * dele; para assinatura, a descrição ou o plano. Continua livre, e continua
   * sendo o que o mapa de rótulos consome quando `servico_id` vem nulo.
   */
  rotulo: string;
  plano: string | null;
  valor: number | null;
  /** `Mensal`, `mensal`, `Único`, `anual`… como o cadastro deste lado grava. */
  recorrencia: string | null;
  inicio: string | null;
  fim: string | null;
  /** `Ativo`/`Ativa`/`Encerrado`/`Cancelada` — o rótulo cru deste lado. */
  status: string;
  /** O mesmo status, já reduzido ao que a Dashboard decide com ele. */
  ativo: boolean;
  fonte: string;
}

export interface LinhaContrato {
  id: string;
  cliente_id: string | null;
  /** ⛔ Resumo DERIVADO dos itens. Vira rótulo do contrato, nunca serviço. */
  servico: string | null;
  valor: number | string | null;
  freq: string | null;
  categoria: string | null;
  inicio: string | null;
  fim: string | null;
  status: string | null;
}

/**
 * Um item de `contrato_servicos` — a linha que passou a atravessar a ponte em
 * 31/08/2026. Antes, o que atravessava era o contrato inteiro, e um contrato
 * com dois serviços chegava do outro lado como um serviço só.
 */
export interface LinhaContratoServico {
  id: string;
  contrato_id: string;
  servico_id: string | null;
  descricao: string | null;
  quantidade: number | string | null;
  valor: number | string | null;
  recorrencia: string | null;
}

export interface LinhaAssinaturaContratada {
  id: string;
  direcao: string | null;
  cliente_id: string | null;
  descricao: string | null;
  plano: string | null;
  valor: number | string | null;
  ciclo: string | null;
  inicio: string | null;
  fim: string | null;
  status: string | null;
}

/**
 * Status que contam como compromisso vivo.
 *
 * ⚠️ `Pausado` fica **fora**: o cliente não está pagando, e listá-lo como
 * ativo faria a Dashboard recomendar upsell sobre uma relação suspensa. Ele
 * atravessa a ponte com `ativo: false`, que é diferente de não atravessar —
 * quem quiser mostrar "pausados" tem o dado.
 */
const VIVOS = new Set(["ativo", "ativa"]);

const vivo = (status: string | null | undefined): boolean =>
  VIVOS.has(String(status ?? "").trim().toLowerCase());

/**
 * Contratos + assinaturas a receber, no formato que a Dashboard consome.
 *
 * ⛔ **Assinatura `direcao = 'pagar'` é excluída aqui, não lá.** Ela é a Scope
 * assinando ferramenta de terceiro — custo, não cliente. Deixá-la passar
 * criaria "cliente contratou o Figma" no cadastro comercial da Dashboard.
 *
 * ⛔ **Linha sem `cliente_id` é descartada.** Sem cliente não há o que vincular,
 * e inventar um destino é pior que omitir a linha.
 */
/**
 * O rótulo com que a Dashboard reconhece um contrato numa lista.
 *
 * Só o resumo dos serviços não basta quando o mesmo cliente renova o mesmo
 * escopo todo ano — dois contratos com rótulo idêntico e nada que os separe.
 * O ano de início desempata, e é a informação que quem olha usa de qualquer
 * forma.
 */
export function rotuloDoContrato(c: Pick<LinhaContrato, "servico" | "inicio">): string {
  const base = String(c.servico ?? "").trim() || "Contrato sem serviços";
  const ano = String(c.inicio ?? "").slice(0, 4);
  return ano ? `${base} (${ano})` : base;
}

export function servicosContratadosParaContrato(
  contratos: LinhaContrato[],
  assinaturas: LinhaAssinaturaContratada[],
  itens: LinhaContratoServico[] = []
): ServicoContratadoContrato[] {
  const saida: ServicoContratadoContrato[] = [];

  const porContrato = new Map<string, LinhaContratoServico[]>();
  for (const i of itens) {
    porContrato.set(i.contrato_id, [...(porContrato.get(i.contrato_id) ?? []), i]);
  }

  for (const c of contratos) {
    if (!c.cliente_id) continue;
    const rotuloContrato = rotuloDoContrato(c);
    const meus = porContrato.get(c.id) ?? [];

    // ⛔ **Contrato sem item não vira uma linha "vazia".** Antes de 31/08/2026
    // o contrato era a linha, e o rótulo dela era `contratos.servico`. Agora a
    // linha é o item — e um contrato que perdeu todos os itens não tem serviço
    // nenhum para declarar. Emitir o resumo derivado (que nesse caso é string
    // vazia) faria a Dashboard receber um compromisso sem nome.
    //
    // ⚖️ Ele some da ponte, e é o certo: some da ponte significa que a
    // reconciliação do outro lado o ENCERRA, com motivo. É o mesmo caminho de
    // um contrato cancelado — e um contrato sem serviços é, comercialmente,
    // exatamente isso.
    for (const it of meus) {
      const rotulo = String(it.descricao ?? "").trim();
      if (!rotulo) continue;
      const qtd = Number(it.quantidade ?? 1) || 1;
      saida.push({
        // O ITEM é a referência agora — ver o comentário do campo.
        referencia: it.id,
        origem: "contrato",
        cliente_id: c.cliente_id,
        contrato_id: c.id,
        contrato_rotulo: rotuloContrato,
        // O vínculo com o catálogo quando quem vendeu já o escolheu. É o que
        // dispensa o palpite por substring do outro lado.
        servico_id: it.servico_id ?? null,
        rotulo,
        // `categoria` entra como plano porque é o que mais se aproxima: é a
        // qualificação do contrato, não um segundo serviço.
        plano: c.categoria ? String(c.categoria) : null,
        // ⚠️ O valor do ITEM, multiplicado pela quantidade — não o do
        // contrato. Repetir o total do contrato em cada item faria um contrato
        // de dois serviços parecer o dobro do que é, do outro lado.
        valor: it.valor === null || it.valor === undefined ? null : reais(cents(it.valor) * qtd),
        // Item sem recorrência própria herda a do contrato — que é o que
        // `null` significa na coluna.
        recorrencia: it.recorrencia ?? c.freq ?? null,
        inicio: c.inicio ?? null,
        fim: c.fim ?? null,
        status: String(c.status ?? ""),
        ativo: vivo(c.status),
        fonte: FONTE,
      });
    }
  }

  for (const a of assinaturas) {
    if (String(a.direcao ?? "receber").trim().toLowerCase() !== "receber") continue;
    if (!a.cliente_id) continue;
    const rotulo = String(a.descricao ?? a.plano ?? "").trim();
    if (!rotulo) continue;
    saida.push({
      referencia: a.id,
      origem: "assinatura",
      cliente_id: a.cliente_id,
      // Assinatura não vive dentro de um contrato — ela é o compromisso.
      contrato_id: null,
      contrato_rotulo: null,
      // Assinatura ainda não tem vínculo de catálogo deste lado; o mapa de
      // rótulos da Dashboard continua respondendo por ela.
      servico_id: null,
      rotulo,
      plano: a.plano ? String(a.plano) : null,
      valor: a.valor === null || a.valor === undefined ? null : reais(cents(a.valor)),
      recorrencia: a.ciclo ?? null,
      inicio: a.inicio ?? null,
      fim: a.fim ?? null,
      status: String(a.status ?? ""),
      ativo: vivo(a.status),
      fonte: FONTE,
    });
  }

  return saida;
}
