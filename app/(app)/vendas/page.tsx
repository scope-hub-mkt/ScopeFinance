import { TabelaVendas } from "./TabelaVendas";

export const dynamic = "force-dynamic";

/** `Vendas → Todas` — a união dos três recortes (§8.1). */
export default function VendasPage() {
  return (
    <TabelaVendas
      titulo="Vendas"
      descricao="Todas as cobranças, de qualquer natureza. Avulsas, parcelas de contrato e cobranças de assinatura aparecem juntas aqui; os submenus são recortes desta mesma lista."
    />
  );
}
