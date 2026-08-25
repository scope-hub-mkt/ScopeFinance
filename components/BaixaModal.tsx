"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { Field, Modal } from "./ui";
import { fmt, today } from "@/lib/format";

export function BaixaModal({
  tabela,
  item,
  onClose,
}: {
  tabela: "contas_receber" | "contas_pagar";
  item: Record<string, any>;
  onClose: () => void;
}) {
  const { db, pagar } = useStore();
  const [contaId, setContaId] = useState<string>(item.conta_id || "");
  const [data, setData] = useState<string>(today());
  const [registrar, setRegistrar] = useState(true);
  const [saving, setSaving] = useState(false);

  // Só conta a receber carrega base de comissão (`RN-04` da Dashboard).
  // Default = o valor cobrado, deduções zero: o caso comum não deve exigir
  // digitação, e o campo existe para o caso em que o extrato diverge.
  const ehReceber = tabela === "contas_receber";
  const [valorPago, setValorPago] = useState<string>(String(item.valor ?? ""));
  const [deducoes, setDeducoes] = useState<string>(String(item.deducoes ?? 0));

  const tipoLabel = ehReceber ? "Recebimento" : "Pagamento";
  const liquido = Number(valorPago || 0) - Number(deducoes || 0);

  const confirmar = async () => {
    setSaving(true);
    try {
      await pagar({
        tabela,
        id: item.id,
        conta_id: contaId || null,
        data,
        ...(ehReceber
          ? { valor_pago: Number(valorPago || 0), deducoes: Number(deducoes || 0) }
          : {}),
        registrar_lancamento: registrar && !!contaId,
      });
      onClose();
    } catch { } finally { setSaving(false); }
  };

  return (
    <Modal title={`Dar baixa · ${tipoLabel}`} onClose={onClose}>
      <div style={{ marginBottom: 14, fontSize: 13 }}>
        <strong>{item.descricao}</strong>
        <span className="c-orange" style={{ marginLeft: 8, fontWeight: 500 }}>{fmt(item.valor)}</span>
      </div>
      <div className="fgrid">
        <Field label="Data da baixa"><input type="date" value={data} onChange={(e) => setData(e.target.value)} /></Field>
        <Field label="Conta bancária">
          <select value={contaId} onChange={(e) => setContaId(e.target.value)}>
            <option value="">Não informar</option>
            {db.bancos.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
          </select>
        </Field>

        {ehReceber && (
          <>
            <Field label="Valor recebido">
              <input
                type="number"
                step="0.01"
                min="0"
                value={valorPago}
                onChange={(e) => setValorPago(e.target.value)}
              />
            </Field>
            <Field label="Deduções (impostos/taxas)">
              <input
                type="number"
                step="0.01"
                min="0"
                value={deducoes}
                onChange={(e) => setDeducoes(e.target.value)}
              />
            </Field>
            <div className="span2 tiny" style={{ marginTop: -4 }}>
              Base líquida <strong className="c-orange">{fmt(liquido)}</strong> — é sobre
              este número que a Scope Dashboard calcula a comissão do comercial.
            </div>
          </>
        )}

        <Field label="Registrar no caixa?" span>
          <label className="hgap" style={{ fontSize: 13, color: "var(--text)" }}>
            <input
              type="checkbox"
              checked={registrar && !!contaId}
              disabled={!contaId}
              onChange={(e) => setRegistrar(e.target.checked)}
              style={{ width: "auto" }}
            />
            Lançar {ehReceber ? "entrada" : "saída"} e ajustar o saldo da conta
          </label>
        </Field>
      </div>
      <div className="mact">
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn btn-p" onClick={confirmar} disabled={saving}>{saving ? "Processando..." : "Confirmar baixa"}</button>
      </div>
    </Modal>
  );
}
