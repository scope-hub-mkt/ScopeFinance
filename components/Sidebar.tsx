"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogoIcon } from "./Logo";
import { BotaoTema } from "./ui";
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
    // `RF-FIN-04` + `P-04` do §8.1, confirmado pelo dono em 28/08/2026.
    //
    // ⚠️ **A colisão que o board não viu:** ele pedia renomear `Parcelamentos`
    // para `Contratos`, e `Cadastros → Contratos` JÁ existia — dois itens de
    // menu com o mesmo nome, significando coisas diferentes. A resolução: há
    // **um só "Contratos"**, e ele mora em Vendas. "Parcelamentos" é como o
    // outro produto (referência 02) chama a mesma coisa.
    g: "Cadastros",
    items: [
      { href: "/clientes", icon: "ti-users", l: "Clientes" },
      { href: "/servicos", icon: "ti-package", l: "Serviços" },
      // A fila do §2.3/§2.4. Fica em Cadastros porque é cadastro pela metade —
      // e porque esconder o que bloqueia cobrança é o defeito que ela corrige.
      { href: "/revisao", icon: "ti-alert-circle", l: "Em revisão" },
    ],
  },
  {
    // `Cobranças` → **Vendas**, como o board pede. Cada submenu tem origem
    // definida (§8.1): Avulsas = PAYMENT_* sem assinatura · Assinaturas =
    // SUBSCRIPTION_* mais os PAYMENT_* filhos · Contratos = cobrança parcelada.
    g: "Vendas",
    items: [
      { href: "/vendas", icon: "ti-copy", l: "Todas" },
      { href: "/vendas/avulsas", icon: "ti-file", l: "Avulsas" },
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
    items: [
      { href: "/notas-fiscais", icon: "ti-receipt", l: "Notas fiscais" },
      { href: "/fiscal", icon: "ti-percentage", l: "Retenções" },
    ],
  },
  {
    g: "Sistema",
    items: [
      { href: "/integracao", icon: "ti-plug-connected", l: "Integração" },
      // Fase 7: a fila dos eventos P1/P2 do gateway que pedem um humano.
      // Sem tela, a única forma de descobrir um chargeback seria um `select`.
      { href: "/alertas", icon: "ti-bell-exclamation", l: "Alertas do Asaas" },
    ],
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
        <BotaoTema />
        <button className="btn btn-sm btn-block" onClick={logout}>
          <i className="ti ti-logout" /> Sair
        </button>
      </div>
    </nav>
  );
}
