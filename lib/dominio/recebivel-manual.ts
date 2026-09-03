/**
 * Quem pode mexer em recebível manual — `RN-53` / `D-100` / `D-101`.
 *
 * ⚖️ **Por que isto é um módulo puro, e não um `if` dentro da rota.** A
 * guarda que a tela faz é apresentação: ela esconde o botão. Quem tiver
 * sessão pode chamar `POST /api/contas_receber` direto e criar a linha do
 * mesmo jeito — é a lição do `RN-50`, escrita ali sobre o Modo Privacidade e
 * válida em qualquer lugar: **esconder não é autorizar**.
 *
 * Separado assim, o mesmo julgamento serve à rota e ao teste, e o teste
 * consegue exercitar os dois papéis sem subir servidor nem banco.
 */

/** O mínimo que a decisão precisa saber sobre quem está pedindo. */
export interface QuemPede {
  master: boolean;
  papel: string;
}

/**
 * A recusa, ou `null` quando pode seguir.
 *
 * ⚠️ Devolve **texto**, não booleano: quem chega aqui sem poder precisa saber
 * por que, e uma recusa muda de 403 anônimo para uma frase que diz o caminho.
 */
export function recusaAoMexerEmRecebivel(
  quem: QuemPede | null,
  origem: "asaas" | "manual"
): string | null {
  // ⛔ Linha do gateway não se cria nem se edita pela aplicação, **por
  // ninguém, nem pela master**. Ela é espelho: o Asaas a sobrescreve na
  // próxima varredura, e uma edição que some sozinha é pior que uma recusa.
  if (origem === "asaas") {
    return (
      "Cobrança do gateway não é editada aqui — ela é espelho do Asaas e seria " +
      "sobrescrita na próxima varredura. Lance em Recebíveis manuais se o valor " +
      "não passou pelo gateway."
    );
  }

  if (!quem) {
    return "A sua credencial existe, mas não há cadastro correspondente. Peça à conta administradora.";
  }

  // ⛔ Papel `admin` NÃO basta. No ScopeFinance `admin` já não manda em
  // credencial alheia (`D-96`); a partir de `D-101` também não manda em
  // receita. A instrução do dono é literal: quem define valor pago é ele.
  if (!quem.master) {
    return "Só a conta administradora lança ou baixa recebível manual (RN-53).";
  }

  return null;
}

/**
 * A origem que uma escrita está tentando produzir.
 *
 * ⚖️ Existe porque `origem_lancamento` **não** é campo gravável pela tela: o
 * banco a preenche com `'manual'` por default. Então a pergunta que a rota
 * precisa fazer não é *"o que veio no corpo?"* — é *"esta escrita mexe numa
 * linha do gateway?"*, e a resposta está na linha existente, não no pedido.
 */
export function origemDaEscrita(
  linhaExistente: { origem_lancamento?: string | null } | null
): "asaas" | "manual" {
  return linhaExistente?.origem_lancamento === "asaas" ? "asaas" : "manual";
}
