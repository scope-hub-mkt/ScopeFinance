import { requireUser } from "@/lib/supabase/auth";
import { sondarDashboard } from "@/lib/integracao/sonda-dashboard";
import { ok, handleError } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * `POST /api/integracao/testar` — o *Testar conexão* que testa a conexão.
 *
 * ⚠️ **Exige sessão, e não a chave da integração** — mesma razão de
 * `/sincronizar`: quem aperta o botão é uma pessoa logada aqui, e uma sonda
 * que dispara chamada de saída não deve ser acionável por credencial de
 * leitura.
 *
 * ⛔ **Não substitui `/saude`, complementa.** `/saude` responde *"eu estou de
 * pé e o que me falta"*; esta responde *"o outro lado me aceita"*. Foi a
 * ausência da segunda pergunta que deixou a reconciliação falhando com 401
 * atrás de dois indicadores verdes (`lib/integracao/sonda-dashboard.ts`).
 */
export async function POST() {
  try {
    await requireUser();
    return ok(await sondarDashboard());
  } catch (e) {
    return handleError(e);
  }
}
