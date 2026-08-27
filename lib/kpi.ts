/**
 * Regra pura do delta de KPI — a Lei 2, terceira camada.
 *
 * ⚖️ **Por que isto não mora dentro do componente.** A parte do delta que
 * pode estar errada não é o JSX, é a decisão de **cor**: "subiu" e "é bom"
 * não são a mesma coisa. Numa conta a pagar, subir é ruim; num MRR, subir é
 * bom; e o mesmo componente serve os dois. Regra que decide cor a partir de
 * significado é regra de negócio, e regra de negócio se testa sem montar
 * árvore de DOM.
 *
 * ⛔ O modo de falha que isto evita é silencioso: pintar de verde uma despesa
 * que cresceu não quebra teste nenhum, não quebra o build, e o painel fica
 * afirmando o contrário do que aconteceu.
 */

export type ClasseDelta = "delta-bom" | "delta-ruim" | "delta-neutro";

export interface LeituraDelta {
  classe: ClasseDelta;
  /** Ícone Tabler completo, com o prefixo. */
  icone: string;
  /** Prefixo do número: "+" subindo, "−" descendo, "" parado. */
  sinal: string;
}

/**
 * @param valor          variação percentual; o sinal define a direção
 * @param bomQuandoSobe  `false` inverte a leitura de cor (despesa, churn)
 */
export function lerDelta(valor: number, bomQuandoSobe = true): LeituraDelta {
  const parado = valor === 0;
  const subiu = valor > 0;

  // Zero é NEUTRO nos dois regimes, de propósito: "não mudou" não é boa nem
  // má notícia, e pintá-lo de verde inventaria uma vitória.
  const classe: ClasseDelta = parado
    ? "delta-neutro"
    : subiu === bomQuandoSobe
      ? "delta-bom"
      : "delta-ruim";

  return {
    classe,
    icone: parado ? "ti-minus" : subiu ? "ti-arrow-up-right" : "ti-arrow-down-right",
    sinal: parado ? "" : subiu ? "+" : "−",
  };
}

/** Percentual em pt-BR, sem sinal — o sinal vem de `lerDelta`. */
export const pctDelta = (v: number): string =>
  Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
