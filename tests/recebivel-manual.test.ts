import { describe, it, expect } from "vitest";
import { linhaDaCobranca } from "@/lib/asaas/mapear";

/**
 * `RF-93` / `RN-52` / `D-100` — o recebível declara de onde nasceu.
 *
 * ⚖️ **Por que este teste existe, e por que ele parece trivial.** A coluna
 * `origem_lancamento` tem default `'manual'`, o que é o contrário do que a
 * intuição pede — quase toda linha vem do Asaas. O default está assim de
 * propósito: linha que ninguém marcou não é do gateway, e o acidente cai
 * para o lado seguro (recebível manual visível, não receita fantasma).
 *
 * O preço desse desenho é que `linhaDaCobranca` precisa marcar `'asaas'`
 * EXPLICITAMENTE. Se alguém remover essa linha achando que é redundante,
 * nada quebra, nenhum teste fica vermelho, e as cobranças do gateway param
 * de aparecer no faturamento — em silêncio. É essa remoção que o teste
 * abaixo impede.
 */

describe("RF-93 — a origem do recebível", () => {
  it("cobrança do gateway nasce marcada como asaas, explicitamente", () => {
    const r = linhaDaCobranca(
      {
        id: "pay_123",
        value: 1000,
        netValue: 970.5,
        status: "RECEIVED",
        dueDate: "2026-09-10",
        customer: "cus_9",
        description: "Mensalidade",
      },
      "PAYMENT_RECEIVED"
    );

    expect(r).not.toBeNull();
    expect(r!.linha.origem_lancamento).toBe("asaas");
  });

  it("marca a origem mesmo quando a cobrança vem pelo backfill, não pelo webhook", () => {
    // O backfill usa a MESMA função com o evento padrão. Se a marcação
    // estivesse no chamador em vez de aqui, este caminho passaria batido —
    // e o histórico importado do gateway entraria como digitado à mão.
    const r = linhaDaCobranca({
      id: "pay_do_backfill",
      value: 500,
      status: "PENDING",
      dueDate: "2026-10-01",
    });

    expect(r!.linha.origem_lancamento).toBe("asaas");
  });

  it("cobrança sem id do gateway não vira linha nenhuma", () => {
    // A guarda que já existia: sem `id` não há o que espelhar. Aqui ela
    // ganha um segundo sentido — é o que impede um payload estranho de
    // virar recebível com origem de gateway.
    expect(linhaDaCobranca({ value: 100, status: "RECEIVED" })).toBeNull();
  });

});
