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

/** Avança uma data ISO por um ciclo (mensal/trimestral/anual). */
export function advanceByCiclo(iso: string, ciclo: string): string {
  const d = new Date(iso + "T00:00:00");
  const meses = ciclo === "anual" ? 12 : ciclo === "trimestral" ? 3 : 1;
  d.setMonth(d.getMonth() + meses);
  return d.toISOString().slice(0, 10);
}

/** Primeiro dia (competência) do mês de uma data ISO. */
export const competencia = (iso: string): string => iso.slice(0, 7) + "-01";

/** Normaliza um valor recorrente para base mensal (para MRR). */
export function monthlyValue(valor: number, ciclo: string): number {
  if (ciclo === "anual") return Number(valor) / 12;
  if (ciclo === "trimestral") return Number(valor) / 3;
  return Number(valor);
}
