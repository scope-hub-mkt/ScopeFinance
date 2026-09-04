import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { montarServicosEntregues } from "@/lib/dominio/servicos-entregues";
import { AtualizarAgora } from "../../AtualizarAgora";
import { PainelEntregues } from "./PainelEntregues";

export const dynamic = "force-dynamic";

/**
 * Serviços entregues — o gêmeo financeiro de `/servicos/prestados` da
 * Dashboard, pedido pelo dono em 03/09/2026.
 *
 * ⚖️ **As duas telas existem porque as perguntas são diferentes.** Lá: quem
 * entrega e quanto essa pessoa recebe. Aqui: o que foi cobrado por isso, o
 * que entrou, e — o número que ninguém tinha onde ver — **quais itens de
 * contrato ativo nunca geraram cobrança nenhuma**.
 *
 * ⛔ Colaborador não aparece aqui, de propósito: quem presta o quê é fato da
 * Dashboard (`RN-01` ao contrário — cada sistema é dono do que é dele), e
 * espelhar isso criaria a segunda verdade.
 */
export default async function ServicosEntreguesPage() {
  const dados = await montarServicosEntregues();

  return (
    <>
      <PageHeader title="Serviços entregues">
        <Link className="btn" href="/servicos">
          <i className="ti ti-package" />
          Catálogo
        </Link>
        <Link className="btn" href="/contratos">
          <i className="ti ti-file-text" />
          Contratos
        </Link>
        {/* O botão de releitura forçada, no mesmo lugar dos demais. */}
        <AtualizarAgora rota="/servicos/entregues" />
      </PageHeader>

      <div className="recado">
        O que cada cliente tem contratado, sob qual contrato, por quanto tempo, e{" "}
        <strong>o que já foi cobrado e recebido por isso</strong>. Quem presta cada
        serviço e qual comissão incide é da Scope Dashboard — este painel responde a
        metade financeira.
      </div>

      <PainelEntregues dados={dados} />
    </>
  );
}
