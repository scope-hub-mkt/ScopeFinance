"use client";

import { useCallback, useEffect, useState } from "react";
import { Field, Modal, Spinner } from "@/components/ui";
import { useStore } from "@/lib/store";

/**
 * **Gerenciar e Testar, por integração** — pedido do dono em 28/08/2026, nas
 * duas frentes.
 *
 * ⚖️ **O que muda em relação à tabela que já existia acima.** Aquela responde
 * *"a variável está preenchida?"*, e o próprio comentário dela avisa que isso
 * não basta (`L-36`). Estes blocos respondem as duas perguntas que faltavam:
 *
 * - **Testar** faz uma **chamada real** ao provedor, passo a passo, e diz qual
 *   passo caiu e como resolver. "O Asaas não funciona" cabe em dez causas;
 *   "a chave é de sandbox e a base é de produção" cabe em uma, e tem conserto.
 * - **Gerenciar** abre a credencial: nome (renomeável), valor (substituível),
 *   origem, e o diagnóstico do último teste que tocou nela.
 *
 * ⛔ **O valor nunca chega ao navegador** — em nenhum dos dois. A tela trabalha
 * com prefixo mascarado do começo ao fim, e renomear move a linha no servidor.
 * A única razão para trazer o segredo até aqui seria exibi-lo.
 */

interface Credencial {
  chave: string;
  origem: "ui" | "ambiente" | "nao_configurada";
  exibicao: string | null;
  atualizado_em: string | null;
}

interface Passo {
  passo: string;
  ok: boolean | null;
  detalhe: string;
  comoResolver?: string;
  chaves?: string[];
}

interface Teste {
  slug: string;
  ok: boolean;
  naoProvisionada: boolean;
  resumo: string;
  passos: Passo[];
  medidoEm: string;
}

const BLOCOS: { slug: string; nome: string; descricao: string; chaves: string[] }[] = [
  {
    slug: "asaas",
    nome: "Asaas — gateway e NFS-e",
    descricao: "Por onde o dinheiro entra: cobranças, assinaturas e notas fiscais.",
    chaves: ["ASAAS_API_KEY", "ASAAS_API_BASE", "ASAAS_WEBHOOK_TOKEN"],
  },
  {
    slug: "crm",
    nome: "CRM Scope System",
    descricao:
      "Por onde o cliente entra. O CRM empurra para cá — este lado só valida a assinatura.",
    chaves: ["CRM_WEBHOOK_SECRET"],
  },
  {
    slug: "dashboard",
    nome: "Scope Dashboard",
    descricao: "A ponte dos dois sentidos: lemos o cadastro mestre de lá e mandamos eventos para lá.",
    chaves: [
      "SCOPE_DASHBOARD_API_BASE",
      "SCOPE_DASHBOARD_API_KEY_OUT",
      "SCOPE_DASHBOARD_WEBHOOK_URL",
      "SCOPE_DASHBOARD_WEBHOOK_SECRET",
      "SCOPE_DASHBOARD_API_KEY",
      "SCOPE_WEBHOOK_SECRET",
    ],
  },
];

const ORIGEM: Record<Credencial["origem"], string> = {
  ui: "🟢 preenchida pela tela",
  ambiente: "🟡 variável de ambiente (fallback)",
  nao_configurada: "⬜ não configurada",
};

export function BlocosIntegracao() {
  const { notify } = useStore();
  const [cred, setCred] = useState<Record<string, Credencial>>({});
  const [editavel, setEditavel] = useState(true);
  const [testes, setTestes] = useState<Record<string, Teste>>({});
  const [testando, setTestando] = useState<string | null>(null);
  const [gerindo, setGerindo] = useState<{ c: Credencial; slug: string } | null>(null);

  const carregar = useCallback(async () => {
    const chaves = BLOCOS.flatMap((b) => b.chaves).join(",");
    const r = await fetch(`/api/integracao/credenciais?chaves=${chaves}`, { cache: "no-store" });
    const j = await r.json();
    const d = j?.data ?? j;
    if (Array.isArray(d?.credenciais)) {
      setCred(Object.fromEntries((d.credenciais as Credencial[]).map((c) => [c.chave, c])));
      setEditavel(Boolean(d.editavel));
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const testar = async (slug: string) => {
    setTestando(slug);
    try {
      const r = await fetch("/api/integracao/testar-integracao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const j = await r.json();
      const t = (j?.data ?? j) as Teste;
      setTestes((x) => ({ ...x, [slug]: t }));
      notify(t.resumo, t.ok ? "ok" : "err");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Erro de rede", "err");
    } finally {
      setTestando(null);
    }
  };

  return (
    <>
      {!editavel && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="stitle">Edição indisponível neste banco</div>
          <p className="tiny" style={{ lineHeight: 1.7 }}>
            A tabela <code>integracao_credenciais</code> ainda não existe aqui, então{" "}
            <strong>Gerenciar</strong> só lê — o valor continua se trocando no ambiente da
            Vercel. Aplique <code>supabase/2026-08-28-credenciais-integracao.sql</code> para
            liberar a edição pela tela. ⚖️ Dizer isto em voz alta é melhor que oferecer um
            botão que finge salvar.
          </p>
        </div>
      )}

      {BLOCOS.map((b) => {
        const t = testes[b.slug];
        return (
          <div className="card" style={{ marginTop: 16 }} key={b.slug}>
            <div className="stitle">{b.nome}</div>
            <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.7 }}>{b.descricao}</p>

            <div className="tbl-wrap" style={{ marginTop: 12 }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Credencial</th>
                    <th>Origem</th>
                    <th>Valor</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {b.chaves.map((k) => {
                    const c = cred[k] ?? {
                      chave: k,
                      origem: "nao_configurada" as const,
                      exibicao: null,
                      atualizado_em: null,
                    };
                    return (
                      <tr key={k}>
                        <td>
                          <code style={{ fontSize: 11.5 }}>{k}</code>
                        </td>
                        <td className="tiny">{ORIGEM[c.origem]}</td>
                        <td className="tiny">
                          <code>{c.exibicao ?? "—"}</code>
                        </td>
                        <td>
                          <button
                            className="btn btn-sm"
                            type="button"
                            onClick={() => setGerindo({ c, slug: b.slug })}
                          >
                            <i className="ti ti-settings" /> Gerenciar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 12 }}>
              <button
                className="btn btn-sm"
                type="button"
                disabled={testando === b.slug}
                onClick={() => testar(b.slug)}
              >
                {testando === b.slug ? <Spinner /> : <i className="ti ti-plug-connected" />} Testar
                agora
              </button>{" "}
              <span className="tiny muted">
                Chamada real, só de leitura — nada é criado no provedor.
              </span>
            </div>

            {t && (
              <>
                <p
                  className="tiny"
                  style={{ marginTop: 10, lineHeight: 1.7 }}
                >
                  <span className={`bdg ${t.ok ? "bdg-g" : "bdg-r"}`}>{t.ok ? "ok" : "falhou"}</span>{" "}
                  {t.resumo}
                </p>
                <div className="tbl-wrap" style={{ marginTop: 8 }}>
                  <table className="tbl">
                    <tbody>
                      {t.passos.map((p) => (
                        <tr key={p.passo}>
                          {/* Três estados: ausência não é falha. Pintar de
                              vermelho o que ninguém configurou ensina a
                              ignorar vermelho. */}
                          <td style={{ width: 28 }}>
                            {p.ok === null ? "⬜" : p.ok ? "🟢" : "🔴"}
                          </td>
                          <td className="tiny">{p.passo}</td>
                          <td className="tiny">
                            {p.detalhe}
                            {p.comoResolver && (
                              <div style={{ marginTop: 4 }}>
                                <strong>Como resolver:</strong> {p.comoResolver}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        );
      })}

      {gerindo && (
        <ModalGerenciar
          credencial={gerindo.c}
          teste={testes[gerindo.slug]}
          editavel={editavel}
          onClose={() => setGerindo(null)}
          onSalvo={async () => {
            setGerindo(null);
            await carregar();
          }}
        />
      )}
    </>
  );
}

function ModalGerenciar({
  credencial,
  teste,
  editavel,
  onClose,
  onSalvo,
}: {
  credencial: Credencial;
  teste?: Teste;
  editavel: boolean;
  onClose: () => void;
  onSalvo: () => void;
}) {
  const { notify } = useStore();
  const [nome, setNome] = useState(credencial.chave);
  const [valor, setValor] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const problemas = (teste?.passos ?? []).filter(
    (p) => p.ok === false && (p.chaves ?? []).includes(credencial.chave)
  );
  const renomeando = nome.trim() !== credencial.chave;

  const chamar = async (corpo: Record<string, unknown>) => {
    setOcupado(true);
    try {
      const r = await fetch("/api/integracao/credenciais", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
      notify("Credencial atualizada.", "ok");
      onSalvo();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Falhou", "err");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Modal title={credencial.chave} onClose={onClose}>
      {problemas.length > 0 ? (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="stitle">Por que não está funcionando</div>
          {problemas.map((p) => (
            <p key={p.passo} className="tiny" style={{ lineHeight: 1.7 }}>
              <strong>{p.passo}:</strong> {p.detalhe}
              {p.comoResolver && (
                <>
                  <br />
                  <strong>Como resolver:</strong> {p.comoResolver}
                </>
              )}
            </p>
          ))}
        </div>
      ) : (
        <p className="tiny muted" style={{ lineHeight: 1.7 }}>
          {teste
            ? "O último teste não acusou problema nesta credencial."
            : "Rode “Testar agora” no bloco para ver aqui o diagnóstico desta credencial — a tabela sozinha mede presença, não funcionamento."}
        </p>
      )}

      <Field label="Nome da credencial">
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value.toUpperCase())}
          disabled={!editavel || credencial.origem !== "ui"}
        />
      </Field>
      {credencial.origem !== "ui" && (
        <p className="tiny muted">
          Só dá para renomear o que foi preenchido pela tela — variável de ambiente se troca no
          ambiente.
        </p>
      )}
      {renomeando && (
        <p className="tiny" style={{ lineHeight: 1.7 }}>
          ⚠ O valor sai de <code>{credencial.chave}</code> e passa a viver em{" "}
          <code>{nome.trim()}</code>. Confira se algum código lê esse nome — guardar um valor
          sob nome que ninguém lê é legítimo, mas a integração fica desligada até o código
          alcançá-lo.
        </p>
      )}

      <Field label={credencial.origem === "ui" ? "Substituir o valor" : "Preencher o valor"}>
        <input
          type="password"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          disabled={!editavel}
          placeholder={
            credencial.origem === "ui" ? "deixe em branco para manter o atual" : "cole o valor"
          }
        />
      </Field>

      <p className="tiny muted" style={{ lineHeight: 1.7 }}>
        Valor atual: <code>{credencial.exibicao ?? "—"}</code> · {ORIGEM[credencial.origem]}
      </p>

      <div className="mact">
        <button className="btn" type="button" onClick={onClose}>
          Fechar
        </button>
        {editavel && credencial.origem === "ui" && (
          <button
            className="btn"
            type="button"
            disabled={ocupado}
            onClick={() => chamar({ acao: "remover", chave: credencial.chave })}
          >
            <i className="ti ti-trash" /> Remover
          </button>
        )}
        {editavel && renomeando && credencial.origem === "ui" && (
          <button
            className="btn"
            type="button"
            disabled={ocupado}
            onClick={() =>
              chamar({ acao: "renomear", chave: credencial.chave, novoNome: nome.trim() })
            }
          >
            Renomear
          </button>
        )}
        <button
          className="btn btn-p"
          type="button"
          disabled={!editavel || ocupado || !valor.trim()}
          onClick={() => chamar({ acao: "salvar", chave: credencial.chave, valor })}
        >
          {ocupado ? <Spinner /> : <i className="ti ti-device-floppy" />} Salvar valor
        </button>
      </div>
    </Modal>
  );
}
