import "server-only";
import { createClient } from "@supabase/supabase-js";
import { criarFetchComRetentativa } from "./retentativa";

/**
 * Cliente Supabase com a service_role key — uso EXCLUSIVO no servidor.
 * Bypassa RLS. Nunca importe isto em componentes client.
 *
 * O `fetch` vem embrulhado: ver `retentativa.ts` para por que o `PGRST303`
 * do PostgREST precisa de segunda chance e por que retentá-lo não duplica
 * escrita.
 */
export function createSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase não configurado: defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.local"
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: criarFetchComRetentativa(fetch) },
  });
}
