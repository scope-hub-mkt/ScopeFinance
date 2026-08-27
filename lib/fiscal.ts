import "server-only";
import { createSupabaseAdmin } from "./supabase/admin";
import type { AsaasInvoiceTaxes } from "./asaas";

/**
 * Fiscal do ScopeFinance — `RF-60`, `RF-61`, `RN-43`.
 *
 * ⚖️ **O defeito que este módulo existe para fechar não é o redeploy.** Até
 * 27/08/2026 as alíquotas da NFS-e moravam em `ASAAS_NF_*`: variável de
 * ambiente, sem data nenhuma. O incômodo visível era precisar de deploy para
 * mudar um número; o defeito real é outro e é de auditoria — **alíquota sem
 * vigência reescreve nota já emitida**. Corrigir o ISS de 3% para 5% hoje
 * passaria a calcular agosto a 5%, e um mês fechado que muda sozinho não é
 * configuração, é ficção.
 *
 * A diferença entre **corrigir** e **versionar** é a régua inteira do
 * [`PLANO-UNIFICADO-SCOPE.md`] §3: N2 sobrescreve o valor, N4 faz a alíquota
 * nova nascer com data de início e deixa o passado em paz.
 *
 * ⚖️ **Isto não foi desenhado aqui.** É cópia deliberada de `RF-53`, que a
 * Dashboard já provou do lado dela — mesma forma de tabela, mesma função de
 * recorte por data, mesma distinção entre "não há retenção cadastrada" e "a
 * retenção é 0%". `D-44` tornou os dois sistemas pares, e uma decisão de
 * negócio que vale num par vale nos dois.
 *
 * ⛔ **A parte que é fácil errar:** trocar env por tabela e continuar lendo a
 * alíquota **de hoje** resolveria a configurabilidade e deixaria o defeito de
 * auditoria intacto. Por isso toda função de cálculo aqui recebe a **data do
 * fato gerador** como parâmetro obrigatório — não há assinatura neste módulo
 * que permita esquecê-la.
 */

/** Uma retenção cadastrada, com a janela em que ela vale. */
export interface Retencao {
  id: string;
  /** ISS, COFINS, CSLL, INSS, IR, PIS — o que o Asaas aceita em `taxes`. */
  sigla: string;
  nome: string;
  percentual: number;
  /**
   * Só faz sentido para o ISS, e cobre o `retainIss` do Asaas.
   *
   * "Quanto" e "retido na fonte" são duas perguntas distintas, e a segunda
   * também muda por vigência — um município pode passar a exigir retenção sem
   * mudar a alíquota. Guardar as duas na mesma linha mantém as duas datadas.
   */
  retido: boolean;
  vigencia_inicio: string;
  vigencia_fim: string | null;
  municipio: string | null;
  observacao: string | null;
  ativo: boolean;
}

/** O que a tela Fiscal cadastra fora da vigência — `RF-61`, N2. */
export interface ConfigFiscal {
  municipal_service_code: string | null;
  municipal_service_id: string | null;
  municipal_service_name: string | null;
}

/** As siglas que o Asaas entende. Cadastrar fora desta lista não vira tributo. */
export const SIGLAS_ASAAS = ["ISS", "COFINS", "CSLL", "INSS", "IR", "PIS"] as const;
export type SiglaAsaas = (typeof SIGLAS_ASAAS)[number];

export function siglaEhConhecida(s: string): s is SiglaAsaas {
  return (SIGLAS_ASAAS as readonly string[]).includes(s.toUpperCase());
}

// ─────────────────────────── leitura ───────────────────────────

/**
 * Todas as retenções cadastradas, mais recentes primeiro.
 *
 * ⚠️ Traz **todas**, inclusive as vencidas e as inativas, de propósito: o
 * recorte por data é `retencoesVigentesEm`, e emitir uma nota de junho exige
 * enxergar a regra de junho — que hoje pode estar vencida. Filtrar vigência no
 * banco tornaria impossível calcular o passado, que é a razão de o módulo
 * existir.
 */
export async function listarRetencoes(): Promise<Retencao[]> {
  const supabase = createSupabaseAdmin();
  const { data } = await supabase
    .from("retencoes_fiscais")
    .select("*")
    .order("vigencia_inicio", { ascending: false })
    .limit(500);
  return (data ?? []) as Retencao[];
}

export async function lerConfigFiscal(): Promise<ConfigFiscal | null> {
  const supabase = createSupabaseAdmin();
  const { data } = await supabase
    .from("config_fiscal")
    .select("municipal_service_code, municipal_service_id, municipal_service_name")
    .eq("id", 1)
    .maybeSingle();
  return (data as ConfigFiscal | null) ?? null;
}

// ─────────────────────────── regra pura ───────────────────────────

/**
 * As retenções que cobrem a data — recorte idêntico ao de `RF-53`.
 *
 * Pura de propósito: quem busca do banco é a camada de leitura. Cálculo com
 * I/O dentro é cálculo que ninguém testa nas bordas, e este decide quanto
 * imposto sai de uma nota fiscal.
 */
export function retencoesVigentesEm(retencoes: Retencao[], data: string): Retencao[] {
  return retencoes.filter(
    (r) =>
      r.ativo &&
      r.vigencia_inicio <= data &&
      (r.vigencia_fim === null || r.vigencia_fim >= data)
  );
}

/**
 * A retenção vigente de uma sigla — a **mais recente** que cobre a data.
 *
 * ⚖️ **Por que "a mais recente" e não "a única".** Nada no schema impede duas
 * linhas de ISS cobrindo a mesma data: o cadastro é humano, e fechar a
 * vigência anterior é um passo que se esquece. Escolher em silêncio a primeira
 * que aparecer faria o resultado depender da ordem do `select`. A regra
 * declarada é **a de início mais recente vence** — que é o que alguém quer
 * dizer ao cadastrar 5% "a partir de setembro" sem lembrar de encerrar os 3%.
 */
export function retencaoVigente(
  retencoes: Retencao[],
  sigla: string,
  data: string
): Retencao | null {
  const alvo = sigla.toUpperCase();
  const candidatas = retencoesVigentesEm(retencoes, data)
    .filter((r) => r.sigla.toUpperCase() === alvo)
    .sort((a, b) => b.vigencia_inicio.localeCompare(a.vigencia_inicio));
  return candidatas[0] ?? null;
}

/** O resultado de montar os tributos, **com a procedência junto**. */
export interface TributosResolvidos {
  taxes: AsaasInvoiceTaxes;
  /**
   * `"cadastro"` quando ao menos uma retenção vigente foi encontrada;
   * `"ambiente"` quando nada estava cadastrado e o `ASAAS_NF_*` respondeu.
   *
   * ⚖️ **Isto não é telemetria, é `RNF-19`** — todo número declara sua fonte.
   * A tela precisa poder dizer *"estou lendo do ambiente"*, senão o manager
   * cadastra uma alíquota, não vê efeito, e não tem como descobrir por quê.
   */
  fonte: "cadastro" | "ambiente";
  /**
   * `true` quando **nenhuma** retenção estava vigente na data.
   *
   * A distinção não é sutil: *"nada foi retido"* e *"ninguém cadastrou
   * retenção"* produzem o mesmo `0` e significam coisas opostas. É a mesma
   * doutrina que a Dashboard aplica em `RN-33` e no custo da IA — **o nulo se
   * abstém, o zero afirma**.
   */
  semRetencaoCadastrada: boolean;
  /** As siglas efetivamente aplicadas, para o demonstrativo e para a tela. */
  aplicadas: { sigla: string; percentual: number; retido: boolean }[];
}

const numeroDoAmbiente = (v: string | undefined) => (v ? Number(v) : 0);

/** O fallback declarado — `ASAAS_NF_*`, exatamente como era antes de `RF-60`. */
export function tributosDoAmbiente(
  env: Record<string, string | undefined> = process.env
): AsaasInvoiceTaxes {
  return {
    retainIss: env.ASAAS_NF_RETAIN_ISS === "true",
    iss: numeroDoAmbiente(env.ASAAS_NF_ISS),
    cofins: numeroDoAmbiente(env.ASAAS_NF_COFINS),
    csll: numeroDoAmbiente(env.ASAAS_NF_CSLL),
    inss: numeroDoAmbiente(env.ASAAS_NF_INSS),
    ir: numeroDoAmbiente(env.ASAAS_NF_IR),
    pis: numeroDoAmbiente(env.ASAAS_NF_PIS),
  };
}

/**
 * Os tributos da nota, pela regra vigente **na data do fato gerador**.
 *
 * ⛔ `dataFatoGerador` não tem valor padrão, e isso é a trava central de
 * `RN-43`: um default `= today()` faria a chamada distraída compilar e
 * calcular o passado com a alíquota de hoje — o defeito exato que este módulo
 * existe para impedir. Quem chama é obrigado a dizer de que data está falando.
 *
 * ⚖️ **Env como fallback, não como concorrente** (mesmo desenho de `RF-58` na
 * Dashboard): o ambiente só responde quando **nada** está cadastrado para a
 * data. Mesclar os dois — cadastro para ISS, env para PIS — produziria uma
 * nota cuja origem ninguém consegue reconstituir depois.
 */
export function tributosEm(
  retencoes: Retencao[],
  dataFatoGerador: string,
  env: Record<string, string | undefined> = process.env
): TributosResolvidos {
  const vigentes = retencoesVigentesEm(retencoes, dataFatoGerador);

  if (vigentes.length === 0) {
    return {
      taxes: tributosDoAmbiente(env),
      fonte: "ambiente",
      semRetencaoCadastrada: true,
      aplicadas: [],
    };
  }

  const taxes: AsaasInvoiceTaxes = {
    retainIss: false,
    iss: 0,
    cofins: 0,
    csll: 0,
    inss: 0,
    ir: 0,
    pis: 0,
  };
  const aplicadas: TributosResolvidos["aplicadas"] = [];

  for (const sigla of SIGLAS_ASAAS) {
    const r = retencaoVigente(vigentes, sigla, dataFatoGerador);
    if (!r) continue;
    const p = Number(r.percentual);
    switch (sigla) {
      case "ISS":
        taxes.iss = p;
        taxes.retainIss = r.retido;
        break;
      case "COFINS":
        taxes.cofins = p;
        break;
      case "CSLL":
        taxes.csll = p;
        break;
      case "INSS":
        taxes.inss = p;
        break;
      case "IR":
        taxes.ir = p;
        break;
      case "PIS":
        taxes.pis = p;
        break;
    }
    aplicadas.push({ sigla, percentual: p, retido: r.retido });
  }

  return { taxes, fonte: "cadastro", semRetencaoCadastrada: false, aplicadas };
}

/**
 * A data do fato gerador de uma nota — `RN-43`.
 *
 * ⚖️ **A escolha, e por que ela não foi inventada aqui.** `RF-53` já responde
 * a mesma pergunta do lado da Dashboard: *"a alíquota vigente é a da **data do
 * recebimento**, não a de hoje"*, porque o imposto retido é o daquele momento.
 * Emitir hoje a nota de um recebimento de junho é exatamente esse caso.
 *
 * A ordem, portanto: **o pagamento**, depois o vencimento, e só então hoje.
 * `pago_em` é o fato gerador de verdade; `vencimento` é a melhor aproximação
 * quando a nota sai antes da baixa; `today()` é o último recurso, para a nota
 * avulsa que não nasce de conta nenhuma.
 *
 * ⚠️ Premissa registrada (`I-nn` do `09` §3): tratamos **regime de caixa**. Se
 * a Scope apurar por competência, o fato gerador passa a ser a competência do
 * serviço, e esta função é o único lugar que muda.
 */
export function dataDoFatoGerador(
  conta: { pago_em?: string | null; vencimento?: string | null } | null,
  hoje: string
): string {
  return conta?.pago_em || conta?.vencimento || hoje;
}
