/**
 * Modo Corporativo × Modo Privacidade — `RF-90` (`D-92`, na Dashboard).
 *
 * ⚖️ **Gêmeo do arquivo de mesmo nome no Dashboard_Oficial_Scope, e isso é
 * requisito, não cópia por preguiça.** Os dois sistemas são pares (`D-44`), a
 * escolha é da pessoa e não do app, e o dono pediu o interruptor **nos dois**.
 * Mesma chave, mesmo atributo, mesmo padrão — quem liga na Dashboard encontra
 * o mesmo gesto aqui.
 *
 * ⚠️ **A chave não é compartilhada de fato, e é bom saber por quê:** os dois
 * sistemas moram em origens diferentes, e `localStorage` é por origem. Ligar
 * de um lado não liga do outro. O nome idêntico é convenção — a mesma razão
 * pela qual `scope-tema` já se repete aqui.
 *
 * ⛔ **Isto NÃO é controle de acesso.** O valor continua no HTML, na resposta
 * e no DOM. A ameaça coberta é **olho na sala e captura de tela** — o manager
 * apresentando a operação numa reunião com cliente. Quem pode ver o quê
 * continua sendo decidido no servidor.
 *
 * ⚖️ **Aqui o modo pesa mais do que na Dashboard**, porque este sistema é
 * financeiro de ponta a ponta: quase todo número de toda tela é dinheiro. A
 * regra de máscara do `globals.css` é, por isso, mais larga do lado de cá.
 */

export const CHAVE_PRIVACIDADE = "scope-privacidade";

export const ATTR_PRIVACIDADE = "data-privacidade";

export type ModoPrivacidade = "corporativo" | "privacidade";

/**
 * Padrão **Corporativo**: quem trabalha no sistema abre-o dezenas de vezes por
 * dia, e nascer borrado ensinaria a desligar o modo por reflexo — que é como
 * uma trava de privacidade morre. Quem apresenta liga antes da reunião.
 */
export const MODO_PADRAO: ModoPrivacidade = "corporativo";

export function normalizarModo(valor: string | null | undefined): ModoPrivacidade {
  return valor === "privacidade" ? "privacidade" : MODO_PADRAO;
}

export function alternarModo(atual: ModoPrivacidade): ModoPrivacidade {
  return atual === "privacidade" ? "corporativo" : "privacidade";
}

/** Rótulo do estado ATUAL. */
export function rotuloModo(modo: ModoPrivacidade): string {
  return modo === "privacidade" ? "Modo Privacidade" : "Modo Corporativo";
}

/** Rótulo da AÇÃO — o que o clique faz. Vai no `title` e no `aria-label`. */
export function rotuloAcao(modo: ModoPrivacidade): string {
  return modo === "privacidade"
    ? "Sair do Modo Privacidade — mostrar todos os valores"
    : "Entrar no Modo Privacidade — ocultar valores e nomes";
}

/**
 * Aplica o modo **antes da primeira pintura**, como o script de tema ao lado.
 *
 * ⚠️ Aqui o flash não é questão de estética: um piscar do saldo real antes do
 * borrão, com a tela compartilhada, **é o vazamento que a feature existe para
 * impedir**. Por isso inline e síncrono no `<head>`, nunca `useEffect`.
 */
export const SCRIPT_PRIVACIDADE = `
(function () {
  try {
    var m = localStorage.getItem('${CHAVE_PRIVACIDADE}');
    document.documentElement.setAttribute('${ATTR_PRIVACIDADE}', m === 'privacidade' ? 'privacidade' : '${MODO_PADRAO}');
  } catch (e) {
    document.documentElement.setAttribute('${ATTR_PRIVACIDADE}', '${MODO_PADRAO}');
  }
})();
`;
