/**
 * Marca da Scope.
 *
 * Resolve `B-10`: este arquivo concentrava os **7 únicos hex literais fora do
 * CSS** de todo o ScopeFinance — o laranja da marca ×4, o laranja claro ×2 e o laranja escuro ×1.
 * Hex em componente é defeito por definição (regra de ouro), e agora
 * `npm run lint:design` recusa mecanicamente.
 *
 * Como veste a marca sem hex:
 *  · o traço principal usa `currentColor`, e quem define a cor é o CSS —
 *    `.sb-logo svg` e `.login-head svg` pintam `color: var(--marca)`. Isso faz
 *    a logo herdar o tema em vez de fixá-lo, o que importa na Onda 3, quando
 *    o claro entrar: a mesma logo serve os dois sem uma linha de mudança.
 *  · o traço secundário usa `var(--marca-tinta)` — no escuro é `--lj-350`, o
 *    passo da rampa que substitui o antigo laranja claro solto.
 *  · a base usa `var(--lj-600)`, o passo que substitui o laranja escuro solto.
 */
export function LogoIcon({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <circle cx="50" cy="45" r="38" stroke="currentColor" strokeWidth="7" />
      <circle cx="50" cy="45" r="22" stroke="var(--marca-tinta)" strokeWidth="6" />
      <circle cx="50" cy="45" r="8" fill="currentColor" />
      <line
        x1="50"
        y1="45"
        x2="78"
        y2="24"
        stroke="var(--marca-tinta)"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <polygon points="78,14 84,30 68,24" fill="currentColor" />
      <rect x="44" y="78" width="12" height="16" rx="3" fill="currentColor" />
      <rect x="36" y="92" width="28" height="7" rx="3" fill="var(--lj-600)" />
    </svg>
  );
}
