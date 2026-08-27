import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Ciclos de recorrência — `RF-63`, e o fechamento de `C-4` da régua.
 *
 * ─── O que estava errado ─────────────────────────────────────────────────
 * Até 27/08/2026 o ciclo era `ciclo === "anual" ? 12 : ciclo === "trimestral"
 * ? 3 : 1` dentro de `format.ts`. Isso é **N0** no `PLANO-UNIFICADO-SCOPE.md`
 * §3: para vender um plano semestral, alguém abre o editor, muda um ternário
 * e faz deploy. Trimestral, semestral e customizado são pedido comum de
 * cliente — não são decisão de engenharia.
 *
 * ⚖️ **É N2 e não N4, ao contrário de `RF-60`.** A alíquota precisou de
 * vigência datada porque mudá-la **reescreve nota já emitida**. Mudar a
 * definição de um ciclo não reescreve conta nenhuma: a conta gerada guarda a
 * própria `competencia` e o próprio `vencimento`, e continua onde estava.
 * Versionar aqui seria cerimônia sem auditoria a proteger.
 *
 * ─── A regra de vencimento, e o defeito que ela conserta ─────────────────
 * ⛔ `Date.setMonth(+1)` sobre **31 de janeiro** produz **3 de março** —
 * fevereiro é pulado inteiro. A suíte já registrava isso, num caso cujo
 * título dizia *"31 de janeiro + 1 mês não vira 3 de março"* enquanto a
 * asserção exigia exatamente `2026-03-03`. O título descrevia o certo; a
 * asserção, o que o código fazia.
 *
 * `regra_vencimento` é o que torna isso configurável em vez de acidental:
 *
 *   - `mesmo-dia`   mantém o dia, **limitando** ao último do mês destino
 *                   (31/jan → 28/fev, e não 03/mar).
 *   - `dia-fixo`    joga para o dia cadastrado (*"fatura todo dia 5"*),
 *                   também limitado.
 *   - `ultimo-dia`  sempre o último dia do mês destino.
 *
 * ⚠️ **Isto muda o comportamento de cobrança de assinaturas com vencimento
 * nos dias 29–31**, e a mudança é deliberada: a anterior pulava competências.
 * Contas já geradas não se movem — a idempotência é por
 * `UNIQUE(assinatura_id, competencia)`, e a competência de cada uma continua
 * gravada.
 */

/** Como o vencimento cai no mês destino. */
export type RegraVencimento = "mesmo-dia" | "dia-fixo" | "ultimo-dia";

/** Um ciclo, venha ele do cadastro ou da lista embutida. */
export interface CicloDef {
  /** Chave usada em `assinaturas.ciclo`. */
  chave: string;
  nome: string;
  meses: number;
  regra_vencimento: RegraVencimento;
  /** Só para `dia-fixo`; 1–31. */
  dia: number | null;
  ativo: boolean;
  /** `true` quando veio do código, não da tabela — a tela declara isso. */
  embutido?: boolean;
}

/**
 * Os três que sempre existiram.
 *
 * ⛔ Eles **não** são semeados no banco, e a diferença importa: semear faria
 * o primeiro deploy gravar linhas que ninguém pediu e que passariam a
 * divergir do código em silêncio. Aqui eles são o **piso** — o sistema
 * funciona sem cadastro nenhum, e o cadastro **sobrepõe** por chave.
 */
export const CICLOS_EMBUTIDOS: readonly CicloDef[] = [
  { chave: "mensal", nome: "Mensal", meses: 1, regra_vencimento: "mesmo-dia", dia: null, ativo: true, embutido: true },
  { chave: "trimestral", nome: "Trimestral", meses: 3, regra_vencimento: "mesmo-dia", dia: null, ativo: true, embutido: true },
  { chave: "anual", nome: "Anual", meses: 12, regra_vencimento: "mesmo-dia", dia: null, ativo: true, embutido: true },
];

/** Último dia do mês (`mes` é 0–11), sem depender de tabela de bissexto. */
export function ultimoDiaDoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
}

/**
 * Avança uma data ISO por um ciclo, aplicando a regra de vencimento.
 *
 * Pura e em UTC de propósito: `new Date(iso + "T00:00:00")` interpreta no
 * fuso local, e num fuso a oeste de Greenwich isso volta um dia — a conta
 * nasceria com vencimento no dia anterior conforme o servidor.
 */
export function avancar(iso: string, def: Pick<CicloDef, "meses" | "regra_vencimento" | "dia">): string {
  const [ano, mes, dia] = iso.slice(0, 10).split("-").map(Number);
  if (!ano || !mes || !dia) throw new Error(`data ISO inválida: ${iso}`);

  const meses = Math.max(1, Math.trunc(def.meses));
  const total = (mes - 1) + meses;
  const anoDestino = ano + Math.floor(total / 12);
  const mesDestino = ((total % 12) + 12) % 12;
  const teto = ultimoDiaDoMes(anoDestino, mesDestino);

  let alvo: number;
  if (def.regra_vencimento === "ultimo-dia") alvo = teto;
  else if (def.regra_vencimento === "dia-fixo") alvo = def.dia && def.dia > 0 ? def.dia : dia;
  else alvo = dia;

  // ⛔ O `min` é o conserto: sem ele, 31 em fevereiro transborda para março.
  const diaFinal = Math.min(alvo, teto);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${anoDestino}-${pad(mesDestino + 1)}-${pad(diaFinal)}`;
}

/**
 * Os ciclos válidos agora: embutidos, com o cadastro **sobrepondo por chave**.
 *
 * ⚖️ Sobrepor e não mesclar é a mesma decisão de `D-52` no fiscal: cadastro
 * que mescla com o embutido produz um terceiro valor que ninguém escreveu.
 * Cadastrar `mensal` com `dia-fixo: 5` **substitui** o mensal embutido.
 *
 * ⚠️ Tabela ausente (schema não aplicado) devolve os embutidos em vez de
 * estourar — é o mesmo fallback declarado de `lib/fiscal.ts`. Um motor de
 * recorrência que morre porque uma tabela de configuração não existe é pior
 * que um que cobra pelos três ciclos de sempre.
 */
export async function lerCiclos(supabase: SupabaseClient): Promise<CicloDef[]> {
  const porChave = new Map<string, CicloDef>();
  for (const c of CICLOS_EMBUTIDOS) porChave.set(c.chave, { ...c });

  const { data, error } = await supabase.from("ciclos_recorrencia").select("*").eq("ativo", true);
  if (error) return [...porChave.values()];

  for (const linha of data ?? []) {
    const chave = String(linha.chave || "").trim();
    if (!chave) continue;
    porChave.set(chave, {
      chave,
      nome: String(linha.nome || chave),
      meses: Number(linha.meses) || 1,
      regra_vencimento: (linha.regra_vencimento as RegraVencimento) || "mesmo-dia",
      dia: linha.dia == null ? null : Number(linha.dia),
      ativo: linha.ativo !== false,
      embutido: false,
    });
  }
  return [...porChave.values()];
}

/**
 * Acha a definição de uma chave.
 *
 * ⚠️ Chave desconhecida cai no **mensal**, que é exatamente o que o ternário
 * antigo fazia (`: 1`). Preservado de propósito: uma assinatura com ciclo
 * escrito errado continua sendo cobrada todo mês, em vez de parar de gerar
 * conta em silêncio. O comportamento errado e visível ganha do silencioso.
 */
export function resolverCiclo(chave: string | null | undefined, ciclos: readonly CicloDef[]): CicloDef {
  const alvo = String(chave || "mensal").trim();
  return (
    ciclos.find((c) => c.chave === alvo) ??
    ciclos.find((c) => c.chave === "mensal") ??
    CICLOS_EMBUTIDOS[0]
  );
}

/** Normaliza um valor recorrente para base mensal (MRR), pelo ciclo resolvido. */
export function mensalizar(valor: number, def: Pick<CicloDef, "meses">): number {
  const meses = Math.max(1, Math.trunc(def.meses));
  return Number(valor) / meses;
}
