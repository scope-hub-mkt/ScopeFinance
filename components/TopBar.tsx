"use client";

import { usePathname } from "next/navigation";
import { NAV } from "./Sidebar";
import { BotaoPrivacidade, BotaoTema } from "./ui";

/**
 * Barra de topo do ScopeFinance — nasceu em 31/08/2026 (`RF-90`, `D-92`).
 *
 * ⚖️ **Por que ela existe.** O dono pediu o interruptor de privacidade *"em
 * `<header class="topbar">`"* nos dois sistemas, e aqui não havia topo nenhum
 * — só a barra lateral. Pendurar o interruptor no rodapé da lateral teria
 * funcionado e teria custado a paridade de gesto entre os dois painéis, que é
 * exatamente o que ele escolheu quando a pergunta lhe foi feita.
 *
 * ⚖️ **Por que ela é mais magra que a da Dashboard.** Lá o topo carrega busca,
 * sino e perfil. Aqui carrega o caminho da tela e dois interruptores — e nada
 * mais. Copiar a busca desligada de lá só para "ficar igual" poria um controle
 * falso na tela, que é o oposto de convergir: convergência é o mesmo gesto no
 * mesmo lugar, não a mesma decoração.
 *
 * ⚠️ O caminho sai do **mesmo `NAV`** que desenha a lateral. Um rótulo próprio
 * aqui seria um segundo nome para cada rota, e o segundo é o que ninguém
 * atualiza quando o primeiro muda.
 */
export function TopBar() {
  const pathname = usePathname();

  /* Casamento mais longo primeiro: `/vendas/avulsas` precisa vencer
     `/vendas`, e a ordem do `NAV` não garante isso. A raiz é exata — sem
     essa exceção ela casaria com qualquer rota. */
  const atual = NAV.flatMap((g) => g.items.map((i) => ({ ...i, g: g.g })))
    .filter((i) => (i.href === "/" ? pathname === "/" : pathname.startsWith(i.href)))
    .sort((a, b) => b.href.length - a.href.length)[0];

  return (
    <header className="topbar">
      <div className="tb-rota">
        {atual ? (
          <>
            <span className="tb-rota-g">{atual.g}</span>
            <i className="ti ti-chevron-right tb-rota-g" aria-hidden="true" />
            <span className="tb-rota-t">{atual.l}</span>
          </>
        ) : (
          /* Rota fora do menu (detalhe, tela nova). Melhor ficar em branco
             do que inventar um nome que não existe em lugar nenhum. */
          <span className="tb-rota-g">ScopeFinance</span>
        )}
      </div>

      <div className="tb-dir">
        {/* Antes do tema de propósito: é o controle que muda O QUE a tela
            mostra, e ele precisa estar no caminho do olho de quem vai
            compartilhar a tela. */}
        <BotaoPrivacidade />
        <BotaoTema />
      </div>
    </header>
  );
}
