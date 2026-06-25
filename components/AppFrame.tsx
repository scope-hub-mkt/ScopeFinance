"use client";

import { StoreProvider, useStore } from "@/lib/store";
import { Sidebar } from "./Sidebar";
import { Spinner } from "./ui";

function Main({ children }: { children: React.ReactNode }) {
  const { loading, error } = useStore();
  return (
    <main className="main">
      {loading ? (
        <div className="loading">
          <Spinner /> Carregando dados…
        </div>
      ) : error ? (
        <div className="loading c-red">
          <i className="ti ti-alert-triangle" /> {error}
        </div>
      ) : (
        children
      )}
    </main>
  );
}

export function AppFrame({
  userEmail,
  children,
}: {
  userEmail?: string | null;
  children: React.ReactNode;
}) {
  return (
    <StoreProvider>
      <div className="app">
        <Sidebar userEmail={userEmail} />
        <Main>{children}</Main>
      </div>
    </StoreProvider>
  );
}
