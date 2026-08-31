import "server-only";
import { randomUUID } from "node:crypto";
import { createSupabaseAdmin } from "../supabase/admin";
import { ErroDeUsuario } from "./usuarios";

/**
 * Upload da **foto de perfil** — `RF-FIN-10`, decisão do dono de 31/08/2026:
 * *"Supabase Storage, bucket público"*.
 *
 * ⚖️ **Público não significa adivinhável, e é essa distinção que faz a decisão
 * ser segura.** O caminho de cada foto termina num `uuid` aleatório:
 * `u/{usuario_id}/{uuid}.webp`. Saber que o bucket existe, e até saber o id de
 * uma pessoa, não dá a ninguém a URL da foto dela.
 *
 * ⛔ A alternativa — URL assinada — custa uma chamada ao Supabase por avatar
 * renderizado. Numa lista de usuários é uma por linha, a cada carga de tela.
 */

export const BUCKET_AVATARES = "avatares";
export const TAMANHO_MAXIMO_FOTO = 2 * 1024 * 1024;
export const TIPOS_DE_FOTO = ["image/jpeg", "image/png", "image/webp"] as const;

const EXTENSAO: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Recusa um arquivo **antes** de gastar rede com ele, dizendo o porquê.
 *
 * ⛔ O bucket também recusa, e essa é a trava que vale. Esta existe pela
 * mensagem: a do Storage é "The object exceeded the maximum allowed size", que
 * não diz qual é o máximo nem o que fazer.
 */
export function recusaDeFoto(arquivo: { size: number; type: string }): string | null {
  if (!arquivo.size) return "Arquivo vazio.";
  if (arquivo.size > TAMANHO_MAXIMO_FOTO) {
    const mb = (arquivo.size / 1024 / 1024).toFixed(1);
    return `A foto tem ${mb} MB e o limite é 2 MB.`;
  }
  if (!(TIPOS_DE_FOTO as readonly string[]).includes(arquivo.type)) {
    return `Formato não aceito (${arquivo.type || "desconhecido"}). Use JPG, PNG ou WebP.`;
  }
  return null;
}

export function caminhoDaFoto(usuarioId: string, tipo: string): string {
  return `u/${usuarioId}/${randomUUID()}.${EXTENSAO[tipo] ?? "img"}`;
}

export async function subirFoto(usuarioId: string, arquivo: File): Promise<{ url: string }> {
  const recusa = recusaDeFoto(arquivo);
  if (recusa) throw new ErroDeUsuario(recusa);

  const supabase = createSupabaseAdmin();
  const caminho = caminhoDaFoto(usuarioId, arquivo.type);

  const { error } = await supabase.storage
    .from(BUCKET_AVATARES)
    .upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });
  if (error) throw new ErroDeUsuario(`Não foi possível enviar a foto: ${error.message}`);

  const { data } = supabase.storage.from(BUCKET_AVATARES).getPublicUrl(caminho);
  return { url: data.publicUrl };
}

/**
 * Extrai o caminho interno a partir da URL gravada no perfil.
 *
 * ⚠️ Devolve `null` para qualquer URL que não seja deste bucket **e** não
 * comece em `u/`. É o que impede uma coluna adulterada de virar `remove()` num
 * caminho arbitrário do Storage.
 */
export function caminhoDaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marca = `/${BUCKET_AVATARES}/`;
  const i = url.indexOf(marca);
  if (i < 0) return null;
  const caminho = url.slice(i + marca.length).split("?")[0];
  return caminho.startsWith("u/") ? caminho : null;
}

/**
 * Apaga uma foto antiga. **Falha em silêncio, e isso é decisão:** é limpeza que
 * roda depois de a troca já ter dado certo, e propagar o erro faria a pessoa ver
 * "erro ao trocar a foto" logo após a foto ter trocado. A consequência real de
 * não apagar é um arquivo órfão que ninguém alcança.
 */
export async function apagarFoto(url: string | null | undefined): Promise<void> {
  const caminho = caminhoDaUrl(url);
  if (!caminho) return;
  const supabase = createSupabaseAdmin();
  await supabase.storage.from(BUCKET_AVATARES).remove([caminho]);
}
