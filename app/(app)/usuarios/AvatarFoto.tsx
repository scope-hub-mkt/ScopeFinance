/**
 * O avatar de uma pessoa — foto quando existe, iniciais quando não.
 *
 * ⚖️ **Por que ele nasce aqui e não em `components/ui.tsx`.** Aquele arquivo é
 * o conjunto de primitivos do sistema de design, e o avatar tem exatamente um
 * consumidor até agora: as telas de usuário. Promover um componente a primitivo
 * antes do segundo uso é decidir a forma dele com um exemplo só — e todo ajuste
 * depois vira mudança de primitivo, que pesa mais do que deveria. No segundo
 * consumidor, ele sobe.
 */
export function AvatarFoto({
  nome,
  foto,
  gd,
  sm,
}: {
  nome: string;
  foto?: string | null;
  /** Grande — o da tela de perfil, onde a foto é o assunto. */
  gd?: boolean;
  /** Pequeno — o da linha de tabela. */
  sm?: boolean;
}) {
  const iniciais = nome
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

  const classe = `avatar${sm ? " avatar-sm" : ""}${gd ? " avatar-gd" : ""}`;

  if (foto) {
    return (
      // `<img>` cru, não `next/image`: a URL vem de um bucket do Supabase, e
      // configurar `remotePatterns` para um domínio por ambiente é acoplar o
      // build à infraestrutura. O ganho do otimizador em 28px é nulo.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className={`${classe} avatar-foto`}
        src={foto}
        alt=""
        title={nome}
        loading="lazy"
        decoding="async"
      />
    );
  }

  return (
    <span className={classe} title={nome} aria-hidden="true">
      {iniciais || "?"}
    </span>
  );
}
