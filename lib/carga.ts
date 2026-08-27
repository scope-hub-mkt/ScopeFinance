/**
 * O que fazer quando UM recurso falha e os outros nove respondem.
 *
 * O defeito que este arquivo fecha esteve em produção em 27/08/2026: a tabela
 * `retencoes_fiscais` (de `8a8abca`, RF-60) foi para o código e nunca para o
 * banco. `GET /api/retencoes_fiscais` devolvia 500 — e como a carga inicial
 * era um `Promise.all` sobre os 10 recursos, uma rejeição derrubava as dez.
 * O sistema INTEIRO virou banner de erro: /clientes, /receber, /bancos, todas
 * intactas, todas invisíveis, todas exibindo uma mensagem sobre uma tabela
 * fiscal que nenhuma delas usa.
 *
 * A lição não é "faltou aplicar o DDL" — isso é o gatilho. É que o carregador
 * tratava dez pedidos independentes como um só, e por isso o pior deles
 * definia o estado de todos. `Promise.allSettled` inverte: cada recurso
 * responde por si, e a tela só morre quando não sobrou nada para mostrar.
 *
 * Puro de propósito: decidir "isto é degradação ou é queda" é regra, e regra
 * se testa sem montar árvore de DOM nem subir servidor.
 */

export interface Falha {
  recurso: string;
  motivo: string;
}

export interface Apuracao<T> {
  /** Os que responderam — entram no estado mesmo que outros tenham falhado. */
  dados: [string, T][];
  falhas: Falha[];
  /** Nada respondeu: aí sim é queda, e a tela vira erro com botão de repetir. */
  queda: boolean;
}

export function apurarCarga<T>(
  chaves: readonly string[],
  resultados: PromiseSettledResult<T>[]
): Apuracao<T> {
  const dados: [string, T][] = [];
  const falhas: Falha[] = [];

  chaves.forEach((recurso, i) => {
    const r = resultados[i];
    if (r && r.status === "fulfilled") {
      dados.push([recurso, r.value]);
    } else {
      const razao = r && r.status === "rejected" ? r.reason : undefined;
      falhas.push({
        recurso,
        motivo: razao instanceof Error ? razao.message : "Erro desconhecido",
      });
    }
  });

  return { dados, falhas, queda: dados.length === 0 && falhas.length > 0 };
}

/**
 * A frase da degradação parcial.
 *
 * Nomeia o recurso: "não foi possível carregar" sem dizer O QUÊ manda o
 * usuário desconfiar de tudo que está na tela, inclusive do que está certo.
 */
export function resumoDeFalhas(falhas: Falha[]): string {
  if (falhas.length === 0) return "";
  const nomes = falhas.map((f) => f.recurso).join(", ");
  const motivos = [...new Set(falhas.map((f) => f.motivo))].join(" | ");
  const cabeca =
    falhas.length === 1
      ? `Não foi possível carregar ${nomes}.`
      : `Não foi possível carregar ${falhas.length} recursos (${nomes}).`;
  return `${cabeca} O resto da tela está atualizado. Motivo: ${motivos}`;
}
