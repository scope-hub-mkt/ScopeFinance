"use client";

import { useEffect } from "react";

// ─── BADGE ──────────────────────────────────────────────────────────
const badgeClass: Record<string, string> = {
  Ativo: "bdg-g", Ativa: "bdg-g", Pago: "bdg-g", Emitida: "bdg-g",
  Inativo: "bdg-x", Inativa: "bdg-x", Cancelado: "bdg-x", Cancelada: "bdg-x", Encerrado: "bdg-x",
  Pendente: "bdg-a", Prospect: "bdg-a", "Em negociação": "bdg-a", Suspensa: "bdg-a",
  Pausado: "bdg-a", Agendada: "bdg-a",
  Vencido: "bdg-r", Inadimplente: "bdg-r", Erro: "bdg-r",
};

export function Badge({ s }: { s: string }) {
  return <span className={`bdg ${badgeClass[s] || "bdg-x"}`}>{s}</span>;
}

// ─── MODAL ──────────────────────────────────────────────────────────
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="mover"
      onClick={(e) => {
        if ((e.target as HTMLElement).className === "mover") onClose();
      }}
    >
      <div className="mbox">
        <div className="mtitle">{title}</div>
        {children}
      </div>
    </div>
  );
}

// ─── FORM FIELD ─────────────────────────────────────────────────────
export function Field({
  label,
  span,
  children,
}: {
  label: string;
  span?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`fg${span ? " span2" : ""}`}>
      <label>{label}</label>
      {children}
    </div>
  );
}

// ─── PAGE HEADER ────────────────────────────────────────────────────
export function PageHeader({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="ph">
      <div className="pt">
        <span>⬡ </span>
        {title}
      </div>
      {children && <div className="hgap">{children}</div>}
    </div>
  );
}

// ─── METRICS ────────────────────────────────────────────────────────
export function MetricGrid({
  items,
}: {
  items: { l: string; v: React.ReactNode; c?: string }[];
}) {
  return (
    <div className="mgrid">
      {items.map((m) => (
        <div className="met" key={m.l}>
          <div className="met-l">{m.l}</div>
          <div className={`met-v ${m.c || ""}`}>{m.v}</div>
        </div>
      ))}
    </div>
  );
}

// ─── EMPTY / LOADING ────────────────────────────────────────────────
export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Spinner() {
  return <span className="spin" />;
}
