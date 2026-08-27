import { CICLOS_EMBUTIDOS, avancar, mensalizar, resolverCiclo, type CicloDef } from "./ciclos";

/** Formata número como moeda BRL. */
export const fmt = (v: number | string | null | undefined): string =>
  "R$ " +
  Number(v || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/** Data de hoje em ISO (YYYY-MM-DD). */
export const today = (): string => new Date().toISOString().slice(0, 10);

/** Formata data ISO (YYYY-MM-DD) para pt-BR (DD/MM/YYYY). */
export const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return "-";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
};

/**
 * Avança uma data ISO por um dos ciclos EMBUTIDOS.
 *
 * ⚠️ Desde `RF-63` esta função é um atalho para `avancar()` de `lib/ciclos.ts`
 * com a definição embutida — ela **não** é mais a autoridade sobre ciclos, e
 * não enxerga os cadastrados. Quem gera cobrança usa `lerCiclos()`; isto aqui
 * serve chamada solta que só conhece as três chaves de sempre.
 *
 * ⛔ Mudou de resultado num caso: 31/jan + 1 mês agora dá **28/fev**, não
 * 03/mar. O comportamento antigo pulava fevereiro inteiro.
 */
export function advanceByCiclo(iso: string, ciclo: string): string {
  return avancar(iso, resolverCiclo(ciclo, CICLOS_EMBUTIDOS));
}

/** Primeiro dia (competência) do mês de uma data ISO. */
export const competencia = (iso: string): string => iso.slice(0, 7) + "-01";

/**
 * Normaliza um valor recorrente para base mensal (MRR).
 *
 * ⚠️ `ciclos` é opcional para não quebrar as três telas que já chamavam isto
 * sem ele — mas passá-lo importa: **sem a lista, um ciclo cadastrado
 * (semestral, bienal) é tratado como mensal**, e o MRR sai inflado. As telas
 * que somam MRR devem carregar os ciclos e repassá-los.
 */
export function monthlyValue(valor: number, ciclo: string, ciclos: readonly CicloDef[] = CICLOS_EMBUTIDOS): number {
  return mensalizar(Number(valor), resolverCiclo(ciclo, ciclos));
}
