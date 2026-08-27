"use client";

import { StoreProvider, useStore } from "@/lib/store";
import { resumoDeFalhas } from "@/lib/carga";
import { Sidebar } from "./Sidebar";
import { Spinner } from "./ui";

function Main({ children }: { children: React.ReactNode }) {
  const { loading, error, falhas, recarregar } = useStore();
  return (
    <main className="main">
      {loading ? (
        <div className="loading">
          <Spinner /> Carregando dados…
        </div>
      ) : error ? (
        // O erro vinha sem saída: a mensagem ocupava a tela inteira e não
        // havia o que clicar. A falha mais comum aqui é transitória, então a
        // tela precisa oferecer a repetição — não mandar o usuário adivinhar
        // que F5 resolveria.
        <div className="erro-carga" role="alert">
          <p className="erro-carga-msg">
            <i className="ti ti-alert-triangle" /> {error}
          </p>
          <button className="btn btn-p" onClick={() => void recarregar()}>
            <i className="ti ti-refresh" />
            Tentar novamente
          </button>
        </div>
      ) : (
        <>
          {falhas.length > 0 && (
            // Degradação declarada. A alternativa — mostrar a tela como se
            // estivesse completa — é a mentira que este projeto persegue no
            // resto do sistema: o usuário decidiria sobre dado faltando sem
            // saber que falta.
            <div className="aviso-parcial" role="status">
              <i className="ti ti-alert-triangle" />
              <span>{resumoDeFalhas(falhas)}</span>
              <button className="btn btn-sm" onClick={() => void recarregar()}>
                <i className="ti ti-refresh" />
                Recarregar
              </button>
            </div>
          )}
          {children}
        </>
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
