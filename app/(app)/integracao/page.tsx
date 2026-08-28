import { diagnostico, estadoIntegracao, veredito } from "@/lib/integracao/config";
import { PainelIntegracao } from "./PainelIntegracao";
import { BlocosIntegracao } from "./BlocosIntegracao";

export const dynamic = "force-dynamic";

/**
 * Tela **Integração** — o painel de status decidido pelo dono em 25/08/2026.
 *
 * O segredo mora no ambiente (Vercel); esta tela mostra **o que está
 * configurado e o que falta**, nunca o valor. É Server Component de propósito:
 * as variáveis nem chegam ao browser — só o booleano de presença.
 *
 * ⚠️ Presença de variável **não é integração funcionando** — é a mesma
 * ressalva que a Dashboard registrou em `L-36`. Por isso o botão "Testar
 * conexão" ao lado: só uma chamada de verdade distingue "preenchido" de
 * "funciona".
 */
export default async function IntegracaoPage() {
  const itens = diagnostico(estadoIntegracao());
  const v = veredito(itens);
  return (
    <>
      <PainelIntegracao itens={itens} veredito={v} />
      {/* Gerenciar + Testar por integração — pedido do dono em 28/08/2026,
          nas duas frentes. O painel acima segue medindo presença; os blocos
          abaixo é que distinguem "preenchido" de "funciona". */}
      <BlocosIntegracao />
    </>
  );
}
