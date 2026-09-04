/**
 * Como um serviço contratado se descreve no tempo — `RF-105`.
 *
 * ⛔ **O defeito que isto corrige, relatado pelo dono em 04/09/2026.** A tela
 * mostrava:
 *
 *     recorrente · 51 dias        início 15/07/2026    fim: sem fim previsto
 *
 * "51 dias" não diz **o que** são 51 dias. Pode ser o ciclo da cobrança, o
 * tempo que falta, o prazo de entrega ou o tempo decorrido — e as quatro
 * leituras levam a decisões diferentes. Número sem rótulo não é informação,
 * é adivinhação com aparência de precisão.
 *
 * ⚖️ **A correção é o rótulo, não o número.** "ativo há 51 dias" responde a
 * pergunta que o número sempre respondeu; "durou 51 dias" responde a mesma
 * coisa no passado. A escala humana entra junto porque "487 dias" é
 * tecnicamente certo e praticamente ilegível.
 *
 * ⚠️ **Cópia literal do gêmeo na Scope Dashboard**, trazida em 04/09/2026. Os
 * dois sistemas são repositórios separados (`D-42`); quem corrigir aqui
 * confere lá, e vice-versa. A frase tem de ser a MESMA nos dois: um serviço
 * descrito como "ativo há 2 meses" num lugar e "51 dias" no outro faz a
 * pessoa achar que são coisas diferentes.
 */

/**
 * Um intervalo em dias, na escala em que uma pessoa o lê.
 *
 * ⚖️ **Os cortes são de leitura, não de matemática.** Até 45 dias a pessoa
 * ainda conta dias ("o serviço começou mês passado"); depois disso ela pensa
 * em meses; passando de dois anos, em anos. Converter cedo demais perde
 * precisão útil; tarde demais entrega "731 dias", que ninguém traduz de
 * cabeça.
 */
export function descreverDuracao(dias: number): string {
  if (!Number.isFinite(dias) || dias < 0) return "período indefinido";
  if (dias === 0) return "hoje";
  if (dias === 1) return "1 dia";
  if (dias < 45) return `${dias} dias`;

  // 30,44 é a média de dias por mês no ano — usar 30 acumula erro visível
  // já no primeiro semestre.
  const meses = Math.round(dias / 30.44);
  if (meses < 24) return meses === 1 ? "1 mês" : `${meses} meses`;

  const anos = Math.floor(meses / 12);
  const resto = meses % 12;
  const parteAno = anos === 1 ? "1 ano" : `${anos} anos`;
  if (resto === 0) return parteAno;
  return `${parteAno} e ${resto === 1 ? "1 mês" : `${resto} meses`}`;
}

export interface CicloDeVida {
  recorrente: boolean;
  encerrado: boolean;
  /** Dias entre o início e o fim (ou hoje). Nulo quando não há data de início. */
  dias: number | null;
  /** Há data de término registrada? */
  temFim: boolean;
}

/**
 * A frase que descreve o serviço na coluna dele.
 *
 * Exemplos do que sai daqui:
 *
 *     recorrente · ativo há 1 mês
 *     pontual · em andamento há 12 dias
 *     recorrente · durou 8 meses
 *     pontual · durou 3 dias
 *     recorrente · sem data de início
 */
export function descreverCiclo(c: CicloDeVida): string {
  const natureza = c.recorrente ? "recorrente" : "pontual";

  // ⛔ Sem data de início não há duração a afirmar. Dizer "0 dias" seria
  // inventar um começo que ninguém registrou — e é justamente o tipo de
  // número com cara de certo que este módulo existe para evitar.
  if (c.dias === null) return `${natureza} · sem data de início`;

  const quanto = descreverDuracao(c.dias);

  if (c.encerrado) return `${natureza} · durou ${quanto}`;
  // ⚖️ "ativo há" para recorrente, "em andamento há" para pontual: o
  // recorrente **é** um estado que dura; o pontual é um trabalho que ainda
  // não terminou, e a diferença muda o que a pessoa faz com a informação.
  return c.recorrente ? `${natureza} · ativo há ${quanto}` : `${natureza} · em andamento há ${quanto}`;
}

/** O que a coluna "Fim" deve dizer, e se isso é uma lacuna. */
export interface Termino {
  texto: string;
  /** Título do `title=`, explicando o porquê. */
  explicacao: string;
  /**
   * ⚠️ Verdadeiro quando a ausência de fim é **lacuna de cadastro**, não
   * desenho. Serviço pontual em andamento sem previsão de término é trabalho
   * aberto sem prazo — diferente de um recorrente, que por natureza não tem
   * fim marcado.
   */
  lacuna: boolean;
}

export function descreverTermino(c: CicloDeVida): Termino {
  if (c.temFim) {
    return { texto: "", explicacao: "", lacuna: false }; // a tela mostra a data
  }

  if (c.recorrente) {
    return {
      texto: "sem fim previsto",
      explicacao: "Serviço recorrente: segue valendo até alguém encerrá-lo.",
      lacuna: false,
    };
  }

  if (c.encerrado) {
    return {
      texto: "encerrado sem data",
      explicacao: "O serviço foi marcado como encerrado, mas ninguém registrou quando.",
      lacuna: true,
    };
  }

  return {
    texto: "sem prazo definido",
    explicacao:
      "Serviço pontual em andamento sem previsão de término. Não é errado, mas é trabalho aberto sem prazo — vale confirmar com o cliente.",
    lacuna: true,
  };
}
