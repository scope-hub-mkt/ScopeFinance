import { describe, it, expect } from "vitest";
import { pagamentosDeReceber, type LinhaReceber } from "@/lib/integracao/contrato";

/**
 * `L-162` — a assinatura precisa atravessar a ponte.
 *
 * ⛔ **O defeito que este arquivo guarda.** A Dashboard roteia o pagamento até
 * o serviço prestado para descobrir **quem responde por ele**, e a única chave
 * possível é a assinatura: `servicos-contratados` já emite assinatura com
 * `contrato_id: null` e `referencia = assinaturas.id`, porque assinatura não
 * vive dentro de um contrato — ela **é** o compromisso.
 *
 * Medido em produção antes do conserto: `contrato_id` nulo em 100% das linhas
 * dos dois lados, 11 pagamentos lidos, **zero** comissões criadas — e o cron
 * verde todos os dias. Falha muda, a categoria mais cara deste projeto.
 *
 * ⚖️ Um teste de campo presente parece burocracia até o campo sumir num
 * `select` — que é exatamente como ele não estava lá.
 */

const base: LinhaReceber = {
  id: "conta-1",
  cliente_id: "cli-1",
  contrato_id: null,
  valor: 2500,
  valor_pago: 2500,
  deducoes: 0,
  vencimento: "2026-08-10",
  status: "Pago",
  pago_em: "2026-08-11",
};

describe("pagamentosDeReceber — a assinatura atravessa", () => {
  it("devolve `assinatura_id` quando a cobrança nasceu de uma assinatura", () => {
    const [p] = pagamentosDeReceber([{ ...base, assinatura_id: "assin-9" }]);
    expect(p.assinatura_id).toBe("assin-9");
  });

  it("cobrança avulsa devolve nulo, não `undefined`", () => {
    // ⚠️ `undefined` some do JSON e chegaria como campo ausente do outro lado —
    // que é diferente de "não nasceu de assinatura" para quem lê o contrato.
    const [p] = pagamentosDeReceber([base]);
    expect(p.assinatura_id).toBeNull();
    expect(JSON.parse(JSON.stringify(p))).toHaveProperty("assinatura_id");
  });

  it("o campo NÃO substitui `contrato_id` — os dois convivem", () => {
    const [p] = pagamentosDeReceber([
      { ...base, contrato_id: "contr-3", assinatura_id: "assin-9" },
    ]);
    expect(p.contrato_id).toBe("contr-3");
    expect(p.assinatura_id).toBe("assin-9");
  });
});
