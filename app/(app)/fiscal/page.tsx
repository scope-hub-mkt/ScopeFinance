"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { Field, Modal, PageHeader } from "@/components/ui";
import type { RetencaoFiscal } from "@/lib/types";

/**
 * Tela **Fiscal** — `RF-60`, `RF-61`, `PBI-054`.
 *
 * ⚖️ **O que esta tela troca.** Até 27/08/2026 a alíquota da NFS-e morava em
 * `ASAAS_NF_*`: mudar de 3% para 5% era um deploy. O incômodo era visível; o
 * defeito, não — variável de ambiente **não tem data**, então corrigir a
 * alíquota hoje passaria a calcular agosto a 5% e um mês fechado mudaria
 * sozinho.
 *
 * Por isso a tela **obriga** a data de início: não há caminho aqui que grave
 * uma alíquota sem dizer de quando ela vale. É `RN-43` virando formulário.
 *
 * ⚠️ **A tela declara a procedência** (`RNF-19`): quando nada está cadastrado,
 * o aviso no topo diz que a emissão está lendo do ambiente. Sem isso, o manager
 * cadastra e não entende por que a nota não mudou.
 */

const SIGLAS = ["ISS", "COFINS", "CSLL", "INSS", "IR", "PIS"];

type Form = Partial<RetencaoFiscal> & { sigla?: string };

const hoje = () => new Date().toISOString().slice(0, 10);

export default function FiscalPage() {
  const { db, create, update, remove } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>({});
  const [salvando, setSalvando] = useState(false);

  // `RF-61` — o código de serviço municipal, que é N2 (cadastro sem vigência).
  const [config, setConfig] = useState<{
    municipal_service_code: string | null;
    municipal_service_id: string | null;
    municipal_service_name: string | null;
  } | null>(null);
  const [fonteConfig, setFonteConfig] = useState<string>("");
  const [fallbackEnv, setFallbackEnv] = useState<string | null>(null);
  const [salvandoConfig, setSalvandoConfig] = useState(false);

  const carregarConfig = useCallback(async () => {
    try {
      const r = await fetch("/api/acoes/config-fiscal");
      if (!r.ok) return;
      const d = await r.json();
      setConfig(
        d.config ?? {
          municipal_service_code: null,
          municipal_service_id: null,
          municipal_service_name: null,
        }
      );
      setFonteConfig(d.fonte ?? "");
      setFallbackEnv(d.fallback_do_ambiente ?? null);
    } catch {
      /* a tela continua utilizável sem o bloco de configuração */
    }
  }, []);

  useEffect(() => {
    void carregarConfig();
  }, [carregarConfig]);

  const salvarConfig = async () => {
    setSalvandoConfig(true);
    try {
      await fetch("/api/acoes/config-fiscal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config ?? {}),
      });
      await carregarConfig();
    } finally {
      setSalvandoConfig(false);
    }
  };

  const setConfigCampo = (k: string) => (e: { target: { value: string } }) =>
    setConfig((c) => ({ ...(c as Record<string, string | null>), [k]: e.target.value }) as typeof c);

  const retencoes = db.retencoes_fiscais ?? [];

  /** As que valem hoje — o recorte que `lib/fiscal.ts` faz no servidor. */
  const vigentesHoje = useMemo(() => {
    const d = hoje();
    return retencoes.filter(
      (r) => r.ativo && r.vigencia_inicio <= d && (!r.vigencia_fim || r.vigencia_fim >= d)
    );
  }, [retencoes]);

  const novo = () => {
    setForm({ sigla: "ISS", vigencia_inicio: hoje(), ativo: true, retido: false });
    setOpen(true);
  };

  const editar = (r: RetencaoFiscal) => {
    setForm({ ...r });
    setOpen(true);
  };

  const salvar = async () => {
    // ⛔ As duas recusas que fazem a tela cumprir `RN-43`: sem sigla o tributo
    // não chega ao Asaas, e sem data de início a alíquota não tem vigência —
    // que é o defeito inteiro que esta tela existe para fechar.
    if (!form.sigla) {
      alert("Escolha o tributo (ISS, COFINS, CSLL, INSS, IR ou PIS).");
      return;
    }
    if (!form.vigencia_inicio) {
      alert("A data de início da vigência é obrigatória — sem ela, a alíquota reescreveria o passado.");
      return;
    }
    if (form.percentual === undefined || form.percentual === null || Number.isNaN(Number(form.percentual))) {
      alert("Informe o percentual. Zero é um valor válido, e afirma que não há retenção.");
      return;
    }

    const dados = {
      ...form,
      nome: form.nome || form.sigla,
      percentual: Number(form.percentual),
      vigencia_fim: form.vigencia_fim || null,
    };

    setSalvando(true);
    try {
      if (form.id) await update("retencoes_fiscais", form.id, dados);
      else await create("retencoes_fiscais", dados);
      setOpen(false);
    } catch {
      /* o store já notifica */
    } finally {
      setSalvando(false);
    }
  };

  const excluir = async (r: RetencaoFiscal) => {
    // ⚠️ Confirmação NOMINAL, como o expurgo de cliente da Dashboard: apagar
    // uma vigência muda como o passado é calculado, e "Excluir?" genérico não
    // dá ao manager a chance de perceber isso.
    if (
      confirm(
        `Apagar a retenção ${r.sigla} de ${r.percentual}% vigente desde ${r.vigencia_inicio}?\n\n` +
          "Notas emitidas sob esta vigência passarão a ser recalculadas por outra regra. " +
          "Para encerrar uma alíquota sem apagar o histórico, prefira preencher a data de FIM."
      )
    ) {
      await remove("retencoes_fiscais", r.id);
    }
  };

  const set = (k: keyof Form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <>
      <PageHeader title="Fiscal">
        <button className="btn btn-p" onClick={novo}>
          <i className="ti ti-plus" />
          Nova retenção
        </button>
      </PageHeader>

      {/* `RNF-19` — a tela declara de onde a emissão está lendo. */}
      {!vigentesHoje.length && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 500, marginBottom: 4 }}>
            Nenhuma retenção vigente hoje — a emissão está lendo do ambiente
          </div>
          <div className="tiny">
            Enquanto nada estiver cadastrado para a data, a NFS-e usa os valores de{" "}
            <code>ASAAS_NF_*</code> como fallback declarado. Cadastre aqui para que a alíquota
            passe a ter vigência e o passado pare de ser reescrito a cada correção.
          </div>
        </div>
      )}

      {/* `RF-61` — código de serviço municipal: cadastro do negócio, não env. */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 500, marginBottom: 4 }}>Código de serviço municipal</div>
        <div className="tiny" style={{ marginBottom: 12 }}>
          {fonteConfig === "cadastro"
            ? "A emissão está usando o código cadastrado aqui."
            : fonteConfig === "ambiente"
              ? `Nada cadastrado — a emissão está usando ASAAS_NF_MUNICIPAL_SERVICE_CODE (${fallbackEnv}) como fallback.`
              : "Nada cadastrado e nada no ambiente — a nota sairá sem código de serviço."}
        </div>
        <div className="fgrid">
          <Field label="Código">
            <input
              className="inp"
              value={config?.municipal_service_code || ""}
              onChange={setConfigCampo("municipal_service_code")}
            />
          </Field>
          <Field label="Id do serviço (opcional)">
            <input
              className="inp"
              value={config?.municipal_service_id || ""}
              onChange={setConfigCampo("municipal_service_id")}
            />
          </Field>
          <Field label="Nome do serviço (opcional)">
            <input
              className="inp"
              value={config?.municipal_service_name || ""}
              onChange={setConfigCampo("municipal_service_name")}
            />
          </Field>
        </div>
        <div className="actions" style={{ marginTop: 12 }}>
          <button className="btn btn-p" onClick={salvarConfig} disabled={salvandoConfig}>
            {salvandoConfig ? "Salvando…" : "Salvar código"}
          </button>
        </div>
      </div>

      {!retencoes.length && <div className="empty">Nenhuma retenção cadastrada</div>}

      {!!retencoes.length && (
        <div className="card">
          <table className="tbl">
            <thead>
              <tr>
                <th>Tributo</th>
                <th>Alíquota</th>
                <th>Retido na fonte</th>
                <th>Vigência</th>
                <th>Município</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {retencoes.map((r) => {
                const vigente = vigentesHoje.some((v) => v.id === r.id);
                return (
                  <tr key={r.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{r.sigla}</div>
                      {r.nome !== r.sigla && <div className="tiny">{r.nome}</div>}
                    </td>
                    <td>{Number(r.percentual)}%</td>
                    <td>{r.sigla === "ISS" ? (r.retido ? "Sim" : "Não") : "—"}</td>
                    <td>
                      {r.vigencia_inicio}
                      {r.vigencia_fim ? ` até ${r.vigencia_fim}` : " (em aberto)"}
                    </td>
                    <td>{r.municipio || "—"}</td>
                    <td>
                      {!r.ativo ? "Inativa" : vigente ? "Vigente hoje" : "Fora da vigência"}
                    </td>
                    <td>
                      <div className="actions">
                        <button className="btn btn-sm" onClick={() => editar(r)}>
                          <i className="ti ti-edit" />
                        </button>
                        <button className="btn btn-sm btn-d" onClick={() => excluir(r)}>
                          <i className="ti ti-trash" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <Modal title={form.id ? "Editar retenção" : "Nova retenção"} onClose={() => setOpen(false)}>
          <div className="fgrid">
            <Field label="Tributo">
              <select
                className="inp"
                value={form.sigla || ""}
                onChange={(e) => setForm((f) => ({ ...f, sigla: e.target.value }))}
              >
                {SIGLAS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Alíquota (%)">
              <input
                className="inp"
                type="number"
                step="0.001"
                min="0"
                max="100"
                value={form.percentual ?? ""}
                onChange={set("percentual")}
              />
            </Field>

            <Field label="Início da vigência">
              <input
                className="inp"
                type="date"
                value={form.vigencia_inicio || ""}
                onChange={set("vigencia_inicio")}
              />
            </Field>

            <Field label="Fim da vigência (opcional)">
              <input
                className="inp"
                type="date"
                value={form.vigencia_fim || ""}
                onChange={set("vigencia_fim")}
              />
            </Field>

            {form.sigla === "ISS" && (
              <Field label="ISS retido na fonte">
                <select
                  className="inp"
                  value={form.retido ? "sim" : "nao"}
                  onChange={(e) => setForm((f) => ({ ...f, retido: e.target.value === "sim" }))}
                >
                  <option value="nao">Não</option>
                  <option value="sim">Sim</option>
                </select>
              </Field>
            )}

            <Field label="Município (opcional)">
              <input className="inp" value={form.municipio || ""} onChange={set("municipio")} />
            </Field>

            <Field label="Observação (opcional)">
              <input className="inp" value={form.observacao || ""} onChange={set("observacao")} />
            </Field>

            <Field label="Ativa">
              <select
                className="inp"
                value={form.ativo === false ? "nao" : "sim"}
                onChange={(e) => setForm((f) => ({ ...f, ativo: e.target.value === "sim" }))}
              >
                <option value="sim">Sim</option>
                <option value="nao">Não</option>
              </select>
            </Field>
          </div>

          <div className="tiny" style={{ marginTop: 12 }}>
            A alíquota vale da data de início em diante. Notas já emitidas continuam calculadas
            pela vigência que valia na data do fato gerador — corrigir aqui não reescreve o
            passado.
          </div>

          <div className="actions" style={{ marginTop: 16 }}>
            <button className="btn" onClick={() => setOpen(false)}>
              Cancelar
            </button>
            <button className="btn btn-p" onClick={salvar} disabled={salvando}>
              {salvando ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
