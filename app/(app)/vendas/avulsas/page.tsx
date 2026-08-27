import { TabelaVendas } from "../TabelaVendas";

export const dynamic = "force-dynamic";

/** `Vendas → Avulsas` — cobrança SEM assinatura e sem parcelamento (§8.1). */
export default function VendasAvulsasPage() {
  return (
    <TabelaVendas
      tipo="avulsa"
      titulo="Vendas avulsas"
      descricao="Cobranças que não pertencem a uma assinatura nem a um parcelamento — venda de uma vez só. Parcelas de contrato ficam em Contratos; cobranças recorrentes, em Assinaturas."
    />
  );
}
