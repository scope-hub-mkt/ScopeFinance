export function LogoIcon({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <circle cx="50" cy="45" r="38" stroke="#E87520" strokeWidth="7" />
      <circle cx="50" cy="45" r="22" stroke="#F5993A" strokeWidth="6" />
      <circle cx="50" cy="45" r="8" fill="#E87520" />
      <line x1="50" y1="45" x2="78" y2="24" stroke="#F5993A" strokeWidth="6" strokeLinecap="round" />
      <polygon points="78,14 84,30 68,24" fill="#E87520" />
      <rect x="44" y="78" width="12" height="16" rx="3" fill="#E87520" />
      <rect x="36" y="92" width="28" height="7" rx="3" fill="#B85A10" />
    </svg>
  );
}
