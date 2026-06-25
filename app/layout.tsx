import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ScopeFinance — Scope Company",
  description: "Gestão financeira da Scope Company",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.24.0/dist/tabler-icons.min.css"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
