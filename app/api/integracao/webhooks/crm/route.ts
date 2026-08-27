import { NextResponse, after } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { autenticarCrm, lerPayloadCrm } from "@/lib/crm/contrato";
import { aplicarEventoCrm } from "@/lib/crm/aplicar";
import { entregarFila } from "@/lib/integracao/sincronia";

export const dynamic = "force-dynamic";

/**
 * `POST /api/integracao/webhooks/crm` — o cliente nasce aqui.
 *
 * ⚖️ **A decisão do dono, 27/08/2026:** *"o dado raiz de informação do cliente
 * nasce do CRM e é criado uma única vez no Scope Finance, onde após isso é
 * propagado para o Asaas e para o Dashboard."* (`D-59`.)
 *
 * ⛔ **Uma origem, uma rota, um formato de payload.** Não reaproveita
 * `/api/integracao/eventos` (que recebe da Dashboard) nem a do Asaas. Dois
 * formatos no mesmo handler significam que a falha de um derruba o outro — a
 * lição que o §0.1 do plano cobra, e que este projeto já pagou.
 *
 * ─────────────────────────────────────────────────────────────────────
 * **As respostas, e o que o emissor faz com cada uma** (§3.4). Ao contrário do
 * Asaas, aqui o emissor é um sistema nosso — então o status HTTP pode carregar
 * significado, e o `RF-CRM-04` (registrar o resultado no card) depende disso.
 *
 * | HTTP | Corpo | O que fazer |
 * |---|---|---|
 * | `200` | `status_cadastro: "efetivo"`    | marcar ✅ no card |
 * | `200` | `status_cadastro: "provisorio"` | marcar ⚠️ com o motivo — falta documento |
 * | `200` | `ignorado: true`                | nada; foi recebido de propósito |
 * | `401` | —                               | **não reenviar igual**; corrigir o segredo |
 * | `409` | `documento-em-conflito`         | marcar 🔴 e **parar** — decisão humana |
 * | `422` | `campo-obrigatorio-ausente`     | corrigir no CRM e reenviar |
 *
 * ⛔ **`409` nunca deve ser reenviado automaticamente.** Retentar um conflito
 * não o resolve — só multiplica a linha na fila e esconde que existe uma
 * decisão humana pendente.
 */
export async function POST(req: Request) {
  const bruto = await req.text();

  const veredito = autenticarCrm(
    {
      hmac: process.env.CRM_WEBHOOK_SECRET ?? null,
      token: process.env.CRM_WEBHOOK_TOKEN ?? null,
    },
    req.headers,
    bruto
  );

  if (!veredito.ok) {
    return NextResponse.json({ erro: veredito.motivo }, { status: veredito.status });
  }

  let corpo: unknown;
  try {
    corpo = bruto ? JSON.parse(bruto) : null;
  } catch {
    return NextResponse.json(
      { erro: "corpo-invalido", motivo: "o corpo não é JSON válido" },
      { status: 422 }
    );
  }

  const leitura = lerPayloadCrm(corpo);
  if (!leitura.ok) {
    // 422 e não 400: o emissor é nosso, o campo é dele, e a lista de campos
    // diz exatamente o que corrigir antes de reenviar pelo botão manual.
    return NextResponse.json(
      { erro: "campo-obrigatorio-ausente", campos: leitura.campos, motivo: leitura.motivo },
      { status: 422 }
    );
  }

  const supabase = createSupabaseAdmin();
  const r = await aplicarEventoCrm(supabase, leitura.payload, corpo);

  // ⚠️ **Enfileirar não é entregar, e esta linha foi esquecida duas vezes hoje.**
  // `replicarParaDashboard` grava na outbox; sem cutucar a entrega aqui, quem
  // entrega é o cron — uma vez por dia. O cliente nasceria no Finance e
  // apareceria na Dashboard **no dia seguinte**, o que é indistinguível de não
  // aparecer para quem está olhando a tela.
  //
  // ⚖️ Depois da resposta, não antes: o CRM não espera a rede da Dashboard, e
  // a outbox garante o evento se esta passada falhar. É o mesmo padrão do CRUD
  // da tela (`app/api/[resource]`).
  if (r.estado === "aplicado") {
    after(() => entregarFila(supabase, 10));
  }

  switch (r.estado) {
    case "ignorado":
      return NextResponse.json({ recebido: true, ignorado: true, motivo: r.motivo });

    case "aplicado":
      return NextResponse.json({
        recebido: true,
        cliente_id: r.cliente_id,
        status_cadastro: r.status_cadastro,
        acao: r.acao,
      });

    case "conflito":
      return NextResponse.json(
        {
          erro: "documento-em-conflito",
          cliente_id_existente: r.cliente_id_existente,
          documento: r.documento,
          motivo: r.motivo,
        },
        { status: 409 }
      );

    default:
      // O evento já está gravado na caixa de entrada com `failed` e o motivo.
      // 500 aqui é honesto: o emissor deve retentar, e a retentativa é segura
      // porque `crm_id` tem índice único (§3.5).
      return NextResponse.json({ erro: "falha-ao-aplicar", motivo: r.motivo }, { status: 500 });
  }
}

/**
 * `GET` na mesma URL — o "isto está plugado?" de quem configura o emissor.
 *
 * Mesma doutrina do `GET` da rota do Asaas: diz se há credencial e qual, sem
 * nunca devolver o valor. Sem isto, o primeiro sinal de segredo errado seria
 * o card marcado 🔴 no CRM, depois do fato.
 */
export async function GET() {
  const hmac = Boolean(process.env.CRM_WEBHOOK_SECRET);
  const token = Boolean(process.env.CRM_WEBHOOK_TOKEN);

  return NextResponse.json({
    rota: "crm",
    aceita: "POST assinado em X-Scope-Signature-256, ou com header x-scope-crm-token",
    gatilho: 'somente a coluna "Validação Contratual" do funil de pós-venda cria cliente',
    provisionado: hmac || token,
    metodos: { hmac, token },
    ajuda:
      hmac || token
        ? "Aponte o emissor para esta URL com o MESMO segredo."
        : "Defina CRM_WEBHOOK_SECRET (preferido) ou CRM_WEBHOOK_TOKEN no ambiente do ScopeFinance.",
  });
}
