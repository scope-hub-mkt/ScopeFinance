import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { rotaIntegracao } from "@/lib/integracao/rota";
import { clienteParaContrato, type LinhaCliente } from "@/lib/integracao/contrato";

export const dynamic = "force-dynamic";

/**
 * `GET /api/integracao/clientes` — o cadastro deste lado, no formato que a
 * Dashboard consome (`ClienteFinance` em `lib/scopefinance.ts` de lá).
 *
 * A troca de nome `id` → `cliente_id` não é enfeite: é o contrato de lá, e
 * respeitá-lo aqui é o que dispensa qualquer adaptador do lado da Dashboard.
 */
export const GET = rotaIntegracao(async () => {
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("clientes")
    .select("id, nome, doc, email, tel, status")
    .order("nome");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(((data ?? []) as LinhaCliente[]).map(clienteParaContrato));
});
