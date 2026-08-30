"use client";

import { useEffect, useState } from "react";
import { useStore, useRecursos } from "@/lib/store";
import { Badge, Field, Modal, MetricGrid, PageHeader } from "@/components/ui";
import { fmt, fmtDate, today, monthlyValue } from "@/lib/format";
import { CICLOS_EMBUTIDOS, type CicloDef } from "@/lib/ciclos";

type Form = Record<string, any>;

export default function AssinaturasPage() {
  const { db, create, update, remove, gerarRecorrencias, getCN } = useStore();
  // `D-91`: esta tela pede o que usa — antes o provider trazia as 10 tabelas.
  useRecursos("assinaturas", "bancos", "clientes");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>({});
  const [saving, setSaving] = useState(false);
  const [gerando, setGerando] = useState(false);

  /* `RF-63` — os ciclos vêm do cadastro. Enquanto a resposta não chega (ou se
     a tabela não foi aplicada), valem os embutidos: um <select> vazio faria a
     tela parecer quebrada por causa de uma tabela de configuração. */
  const [ciclos, setCiclos] = useState<CicloDef[]>([...CICLOS_EMBUTIDOS]);
  const [ciclosAbertos, setCiclosAbertos] = useState(false);
  const [cicloForm, setCicloForm] = useState<Form>({});
  const [salvandoCiclo, setSalvandoCiclo] = useState(false);
  const [erroCiclo, setErroCiclo] = useState("");

  const carregarCiclos = async () => {
    try {
      const r = await fetch("/api/acoes/ciclos");
      const j = await r.json();
      if (j?.data?.ciclos?.length) setCiclos(j.data.ciclos);
    } catch {
      /* Offline ou tabela ausente: seguem os embutidos. */
    }
  };
  useEffect(() => { carregarCiclos(); }, []);

  const salvarCiclo = async () => {
    setSalvandoCiclo(true);
    setErroCiclo("");
    try {
      const r = await fetch("/api/acoes/ciclos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cicloForm),
      });
      const j = await r.json();
      /* A mensagem do servidor aparece na tela. Um "não funcionou" mudo é o
         que faz o manager achar que cadastrou e seguir cobrando errado. */
      if (!r.ok) { setErroCiclo(j?.error || "Não foi possível salvar o ciclo."); return; }
      setCicloForm({});
      await carregarCiclos();
    } catch (e) {
      setErroCiclo(String(e));
    } finally {
      setSalvandoCiclo(false);
    }
  };

  const removerCiclo = async (chave: string) => {
    if (!confirm(`Remover o ciclo "${chave}"?`)) return;
    await fetch(`/api/acoes/ciclos?chave=${encodeURIComponent(chave)}`, { method: "DELETE" });
    await carregarCiclos();
  };
  const setCiclo = (k: string) => (e: any) => setCicloForm((f) => ({ ...f, [k]: e.target.value }));

  const novo = () => {
    setForm({ direcao: "receber", status: "Ativa", plano: "Starter", ciclo: "mensal", inicio: today() });
    setOpen(true);
  };
  const editar = (a: Form) => { setForm(a); setOpen(true); };

  const salvar = async () => {
    if (!form.valor) { alert("Valor é obrigatório"); return; }
    if (form.direcao === "receber" && !form.cliente_id) { alert("Selecione o cliente"); return; }
    if (form.direcao === "pagar" && !form.fornecedor) { alert("Informe o fornecedor"); return; }
    setSaving(true);
    try {
      if (form.id) await update("assinaturas", form.id, form);
      else await create("assinaturas", form);
      setOpen(false);
    } catch { } finally { setSaving(false); }
  };

  const excluir = async (id: string) => { if (confirm("Excluir assinatura?")) await remove("assinaturas", id); };
  const set = (k: string) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const gerar = async () => {
    setGerando(true);
    try { await gerarRecorrencias(); } catch { } finally { setGerando(false); }
  };

  const ativas = db.assinaturas.filter((a) => a.status === "Ativa");
  /* ⚠️ `ciclos` é passado de propósito: sem ele um semestral cadastrado seria
     normalizado como mensal, e o MRR sairia inflado em 6x. */
  const mrr = ativas.filter((a) => a.direcao === "receber").reduce((s, a) => s + monthlyValue(Number(a.valor || 0), a.ciclo, ciclos), 0);
  const custoMensal = ativas.filter((a) => a.direcao === "pagar").reduce((s, a) => s + monthlyValue(Number(a.valor || 0), a.ciclo, ciclos), 0);
  const clientesAtivos = db.clientes.filter((c) => c.status === "Ativo");

  return (
    <>
      <PageHeader title="Assinaturas">
        <button className="btn" onClick={gerar} disabled={gerando}>
          <i className="ti ti-refresh" />{gerando ? "Gerando..." : "Gerar cobranças"}
        </button>
        <button className="btn" onClick={() => setCiclosAbertos(true)}><i className="ti ti-repeat" />Ciclos</button>
        <button className="btn btn-p" onClick={novo}><i className="ti ti-plus" />Nova assinatura</button>
      </PageHeader>

      <MetricGrid items={[
        { l: "Ativas", v: ativas.length, c: "c-blue", icone: "repeat",
          fonte: "assinaturas com status Ativa, nas duas direcoes" },
        { l: "MRR (a receber)", v: fmt(mrr), c: "c-green", icone: "trending-up",
          fonte: "assinaturas Ativas a receber, normalizadas por ciclo" },
        /* A procedencia diz que e PROJECAO, e nao realizado. Um ARR que nao
           declara isso e indistinguivel de receita medida. */
        { l: "ARR estimado", v: fmt(mrr * 12), c: "c-orange", icone: "calendar-stats",
          fonte: "MRR x 12 — projecao, nao receita realizada" },
        { l: "Custo mensal recorrente", v: fmt(custoMensal), c: "c-red", icone: "arrow-up-circle",
          fonte: "assinaturas Ativas a pagar, normalizadas por ciclo" },
      ]} />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="tiny">
          <i className="ti ti-info-circle" /> O botão <strong>Gerar cobranças</strong> cria automaticamente as contas
          a receber/pagar de cada assinatura ativa cujo vencimento já chegou, avançando o próximo ciclo.
          Em produção isso roda sozinho todo dia (Vercel Cron).
        </div>
      </div>

      <div className="card tbl-wrap">
        <table>
          <thead>
            <tr><th>Tipo</th><th>Cliente / Fornecedor</th><th>Descrição</th><th>Valor</th><th>Próx. venc.</th><th>Status</th><th>Ações</th></tr>
          </thead>
          <tbody>
            {!db.assinaturas.length && <tr><td colSpan={7}><div className="empty">Nenhuma assinatura</div></td></tr>}
            {db.assinaturas.map((a) => (
              <tr key={a.id}>
                <td>
                  <span className={`bdg ${a.direcao === "receber" ? "bdg-g" : "bdg-r"}`}>
                    {a.direcao === "receber" ? "A receber" : "A pagar"}
                  </span>
                </td>
                <td>{a.direcao === "receber" ? getCN(a.cliente_id) : a.fornecedor}</td>
                <td>
                  {a.direcao === "receber" && a.plano ? <span className="bdg bdg-a">{a.plano}</span> : null}
                  {a.descricao ? <span style={{ marginLeft: a.plano ? 6 : 0 }}>{a.descricao}</span> : null}
                </td>
                <td className="c-orange" style={{ fontWeight: 500 }}>{fmt(a.valor)}<br /><span className="tiny">{a.ciclo}</span></td>
                <td className="tiny">{fmtDate(a.proximo_venc)}</td>
                <td><Badge s={a.status} /></td>
                <td>
                  <div className="actions">
                    <button className="btn btn-sm" onClick={() => editar(a)}><i className="ti ti-edit" /></button>
                    <button className="btn btn-sm btn-d" onClick={() => excluir(a.id)}><i className="ti ti-trash" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ciclosAbertos && (
        <Modal title="Ciclos de recorrência" onClose={() => setCiclosAbertos(false)} largo>
          <div className="tiny" style={{ marginBottom: 12 }}>
            <i className="ti ti-info-circle" /> Trimestral, semestral ou customizado deixam de exigir
            deploy. <strong>Mensal</strong>, <strong>Trimestral</strong> e <strong>Anual</strong> são
            embutidos e funcionam sem cadastro — cadastrar com a mesma chave <strong>substitui</strong> o
            embutido.
          </div>

          <div className="tbl-wrap" style={{ marginBottom: 16 }}>
            <table>
              <thead>
                <tr><th>Chave</th><th>Nome</th><th>Meses</th><th>Vencimento</th><th>Origem</th><th>Ações</th></tr>
              </thead>
              <tbody>
                {ciclos.map((c) => (
                  <tr key={c.chave}>
                    <td><code>{c.chave}</code></td>
                    <td>{c.nome}</td>
                    <td>{c.meses}</td>
                    <td className="tiny">
                      {c.regra_vencimento === "dia-fixo"
                        ? `Todo dia ${c.dia}`
                        : c.regra_vencimento === "ultimo-dia"
                          ? "Último dia do mês"
                          : "Mesmo dia da assinatura"}
                    </td>
                    <td>
                      <span className={`bdg ${c.embutido ? "bdg-a" : "bdg-g"}`}>
                        {c.embutido ? "Embutido" : "Cadastrado"}
                      </span>
                    </td>
                    <td>
                      <div className="actions">
                        <button
                          className="btn btn-sm"
                          onClick={() => setCicloForm({ ...c })}
                          title="Editar"
                        ><i className="ti ti-edit" /></button>
                        {!c.embutido && (
                          <button className="btn btn-sm btn-d" onClick={() => removerCiclo(c.chave)} title="Remover">
                            <i className="ti ti-trash" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="fgrid">
            <Field label="Chave *" ajuda="Vai em assinaturas.ciclo. Minúsculas, números e hífen.">
              <input value={cicloForm.chave || ""} onChange={setCiclo("chave")} placeholder="semestral" />
            </Field>
            <Field label="Nome *"><input value={cicloForm.nome || ""} onChange={setCiclo("nome")} placeholder="Semestral" /></Field>
            <Field label="Meses *"><input type="number" min={1} max={120} value={cicloForm.meses ?? ""} onChange={setCiclo("meses")} /></Field>
            <Field label="Regra de vencimento">
              <select value={cicloForm.regra_vencimento || "mesmo-dia"} onChange={setCiclo("regra_vencimento")}>
                <option value="mesmo-dia">Mesmo dia da assinatura</option>
                <option value="dia-fixo">Dia fixo do mês</option>
                <option value="ultimo-dia">Último dia do mês</option>
              </select>
            </Field>
            {cicloForm.regra_vencimento === "dia-fixo" && (
              <Field label="Dia *" ajuda="31 é aceito: em fevereiro cai no dia 28 ou 29, nunca em março.">
                <input type="number" min={1} max={31} value={cicloForm.dia ?? ""} onChange={setCiclo("dia")} />
              </Field>
            )}
          </div>

          {erroCiclo && (
            <div className="aviso aviso-bloq" style={{ marginTop: 12 }}>
              <i className="ti ti-alert-triangle" /><span>{erroCiclo}</span>
            </div>
          )}

          <div className="mact">
            <button className="btn" onClick={() => { setCicloForm({}); setErroCiclo(""); }}>Limpar</button>
            <button className="btn btn-p" onClick={salvarCiclo} disabled={salvandoCiclo}>
              {salvandoCiclo ? "Salvando..." : "Salvar ciclo"}
            </button>
          </div>
        </Modal>
      )}

      {open && (
        <Modal title="Assinatura" onClose={() => setOpen(false)}>
          <div className="fgrid">
            <Field label="Tipo *" span>
              <select value={form.direcao || "receber"} onChange={set("direcao")}>
                <option value="receber">A receber — cliente assina a Scope (receita / CRM)</option>
                <option value="pagar">A pagar — a Scope assina ferramenta/serviço (despesa)</option>
              </select>
            </Field>

            {form.direcao === "pagar" ? (
              <>
                <Field label="Fornecedor *"><input value={form.fornecedor || ""} onChange={set("fornecedor")} placeholder="Ex: Google Workspace" /></Field>
                <Field label="Categoria">
                  <select value={form.categoria || "Software/SaaS"} onChange={set("categoria")}>
                    <option>Software/SaaS</option><option>Infraestrutura</option><option>Marketing</option>
                    <option>Pessoal</option><option>Escritório</option><option>Outros</option>
                  </select>
                </Field>
              </>
            ) : (
              <>
                <Field label="Cliente *">
                  <select value={form.cliente_id || ""} onChange={set("cliente_id")}>
                    <option value="">Selecione...</option>
                    {clientesAtivos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                </Field>
                <Field label="Plano">
                  <select value={form.plano || "Starter"} onChange={set("plano")}>
                    <option>Starter</option><option>Pro</option><option>Business</option><option>Enterprise</option>
                  </select>
                </Field>
              </>
            )}

            <Field label="Descrição" span><input value={form.descricao || ""} onChange={set("descricao")} placeholder="Ex: Plano Pro CRM / Assinatura Figma" /></Field>
            <Field label="Valor (R$) *"><input type="number" value={form.valor ?? ""} onChange={set("valor")} /></Field>
            <Field label="Ciclo">
              <select value={form.ciclo || "mensal"} onChange={set("ciclo")}>
                {ciclos.filter((c) => c.ativo).map((c) => (
                  <option key={c.chave} value={c.chave}>
                    {c.nome} ({c.meses === 1 ? "1 mês" : `${c.meses} meses`})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Dia de vencimento"><input type="number" min={1} max={31} value={form.dia_venc ?? ""} onChange={set("dia_venc")} /></Field>
            <Field label="Status">
              <select value={form.status || "Ativa"} onChange={set("status")}>
                <option>Ativa</option><option>Suspensa</option><option>Cancelada</option>
              </select>
            </Field>
            <Field label="Início"><input type="date" value={form.inicio || ""} onChange={set("inicio")} /></Field>
            <Field label="Próxima cobrança"><input type="date" value={form.proximo_venc || ""} onChange={set("proximo_venc")} /></Field>
            <Field label="Término (opcional)"><input type="date" value={form.fim || ""} onChange={set("fim")} /></Field>
            <Field label="Conta de liquidação">
              <select value={form.conta_id || ""} onChange={set("conta_id")}>
                <option value="">Nenhuma</option>
                {db.bancos.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
              </select>
            </Field>
            <Field label="Observações" span><textarea value={form.obs || ""} onChange={set("obs")} /></Field>
          </div>
          <div className="tiny" style={{ marginTop: 8 }}>
            Se a &quot;Próxima cobrança&quot; ficar em branco, será usada a data de início.
          </div>
          <div className="mact">
            <button className="btn" onClick={() => setOpen(false)}>Cancelar</button>
            <button className="btn btn-p" onClick={salvar} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
