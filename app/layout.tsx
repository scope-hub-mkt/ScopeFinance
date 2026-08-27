import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ScopeFinance — Scope Company",
  description: "Gestão financeira da Scope Company",
};

/**
 * `themeColor` acompanha os dois temas — são os valores de `--fundo` em cada
 * um. Sem isso a barra do navegador no mobile fica com a cor do outro tema e
 * a moldura briga com a página.
 *
 * ⚠️ ÚNICA exceção autorizada à regra "nada de hex fora de `globals.css`": a
 * API de metadados do Next recebe string, não entende `var(--fundo)`. Por
 * isso as duas linhas carregam `design-token-exempt`, que é o que faz
 * `npm run lint:design` ignorá-las — e só a elas. Se `--fundo` mudar em
 * `globals.css`, estes dois valores mudam junto, na mão.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F6F6F6" }, // design-token-exempt: espelha --fundo
    { media: "(prefers-color-scheme: dark)", color: "#191919" }, // design-token-exempt: espelha --fundo
  ],
  width: "device-width",
  initialScale: 1,
};

/**
 * Aplica o tema **antes da primeira pintura** — Onda 3 de
 * `docs/AGENTE-IDENTIDADE-VISUAL.md` §B.4, na Dashboard.
 *
 * Precisa ser script inline e síncrono: qualquer coisa que rode depois da
 * hidratação pinta a tela clara e troca para escura na frente do usuário. É o
 * clássico flash de tema, e num painel financeiro que abre dezenas de vezes
 * por dia ele é mais irritante que qualquer detalhe de layout.
 *
 * ⚠️ A chave do `localStorage` é **`scope-tema`, a mesma da Dashboard**, e
 * isso é de propósito: os dois sistemas são pares (`D-44`) e a preferência de
 * tema é da pessoa, não do sistema. Mudar a chave aqui faria o manager
 * escolher duas vezes.
 *
 * Regra de precedência: escolha explícita ganha do sistema; quem nunca
 * escolheu segue `prefers-color-scheme`; e o **claro é o padrão**, porque
 * quatro das cinco referências de painel são claras.
 *
 * ⛔ O escuro NÃO morre nisto. Ele continua sendo a identidade que o
 * ScopeFinance já rodava — o que mudou é que agora é **escolha**, validada
 * contra o claro, e não a única saída.
 */
const SCRIPT_TEMA = `
(function () {
  try {
    var t = localStorage.getItem('scope-tema');
    if (t !== 'claro' && t !== 'escuro') {
      t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro';
    }
    document.documentElement.dataset.tema = t;
  } catch (e) {
    document.documentElement.dataset.tema = 'claro';
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /* `suppressHydrationWarning`: o script acima escreve `data-tema` no
       cliente antes do React montar, então o atributo diverge do HTML do
       servidor por construção. É divergência intencional, não defeito. */
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.24.0/dist/tabler-icons.min.css"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
