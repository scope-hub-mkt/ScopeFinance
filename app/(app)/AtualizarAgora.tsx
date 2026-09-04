"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acaoAtualizarAgora } from "./atualizar-actions";

/**
 * Botão de atualizar à força, ao lado da idade do retrato — `RF-103`.
 *
 * ⚖️ **Fica junto do número que ele contesta.** A idade do retrato ("de 4
 * minutos atrás") é a informação que faz alguém querer atualizar; pôr o botão
 * em outro lugar obrigaria a procurar. É a mesma razão pela qual a fonte de
 * cada KPI aparece dentro do próprio cartão.
 *
 * ⚠️ **Diz o que aconteceu, não só que rodou.** Um botão que pisca e volta ao
 * normal é indistinguível de um botão que não faz nada — e como a tela pode
 * legitimamente não mudar (o dado era o mesmo), o retorno precisa afirmar a
 * releitura, não deixar a pessoa inferir pela ausência de mudança.
 */
export function AtualizarAgora({
  rota,
  idade,
}: {
  /** A rota cujo retrato será derrubado. Precisa estar em `ROTAS_INVALIDAVEIS`. */
  rota: string;
  /** Como a tela descreve a idade do retrato, para o texto do botão fazer sentido. */
  idade?: string;
}) {
  const [pendente, iniciar] = useTransition();
  const [estado, setEstado] = useState<"parado" | "feito" | "erro">("parado");
  const [erro, setErro] = useState<string | null>(null);
  const router = useRouter();

  const atualizar = () =>
    iniciar(async () => {
      setErro(null);
      const r = await acaoAtualizarAgora(rota);
      if (r.ok) {
        setEstado("feito");
        // `refresh` traz o servidor a recalcular; sem ele o retrato novo
        // existiria no banco e a tela continuaria mostrando o antigo.
        router.refresh();
      } else {
        setEstado("erro");
        setErro(r.erro ?? "Não foi possível atualizar.");
      }
    });

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--e-2)" }}>
      <button
        type="button"
        className="btn btn-sm"
        onClick={atualizar}
        disabled={pendente}
        title={
          idade
            ? `Este retrato é ${idade}. Clique para reler agora, sem esperar o cache vencer.`
            : "Reler os dados agora, sem esperar o cache vencer."
        }
      >
        <i className="ti ti-refresh" aria-hidden="true" />
        {pendente ? "Atualizando…" : "Atualizar agora"}
      </button>

      {estado === "feito" && !pendente && (
        <span className="tiny c-green">Dados relidos.</span>
      )}
      {estado === "erro" && erro && <span className="tiny c-red">{erro}</span>}
    </span>
  );
}
