"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogoIcon } from "./Logo";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const NAV: { g: string; items: { href: string; icon: string; l: string }[] }[] = [
  {
    g: "Visão geral",
    items: [
      { href: "/", icon: "ti-layout-dashboard", l: "Dashboard" },
      { href: "/relatorios", icon: "ti-chart-bar", l: "Relatórios" },
    ],
  },
  {
    g: "Cadastros",
    items: [
      { href: "/clientes", icon: "ti-users", l: "Clientes" },
      { href: "/contratos", icon: "ti-file-text", l: "Contratos" },
      { href: "/assinaturas", icon: "ti-refresh", l: "Assinaturas" },
    ],
  },
  {
    g: "Financeiro",
    items: [
      { href: "/receber", icon: "ti-arrow-down-circle", l: "Contas a receber" },
      { href: "/pagar", icon: "ti-arrow-up-circle", l: "Contas a pagar" },
      { href: "/lancamentos", icon: "ti-list", l: "Lançamentos" },
    ],
  },
  {
    g: "Patrimônio",
    items: [
      { href: "/bancos", icon: "ti-building-bank", l: "Contas bancárias" },
      { href: "/cartoes", icon: "ti-credit-card", l: "Cartões" },
    ],
  },
  {
    g: "Fiscal",
    items: [{ href: "/notas-fiscais", icon: "ti-receipt", l: "Notas fiscais" }],
  },
];

export function Sidebar({ userEmail }: { userEmail?: string | null }) {
  const pathname = usePathname();
  const router = useRouter();

  const logout = async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  return (
    <nav className="sb">
      <div className="sb-logo">
        <LogoIcon />
        <div>
          <div className="sb-name">Scope Company</div>
          <div className="sb-sub">Finance</div>
        </div>
      </div>
      <div className="sb-scroll">
        {NAV.map(({ g, items }) => (
          <div className="nav-g" key={g}>
            <div className="nav-lbl">{g}</div>
            {items.map(({ href, icon, l }) => {
              const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
              return (
                <Link key={href} href={href} className={`ni${active ? " act" : ""}`}>
                  <i className={`ti ${icon}`} aria-hidden="true" />
                  {l}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
      <div className="sb-foot">
        {userEmail && <div className="sb-user" title={userEmail}>{userEmail}</div>}
        <button className="btn btn-sm btn-block" onClick={logout}>
          <i className="ti ti-logout" /> Sair
        </button>
      </div>
    </nav>
  );
}
