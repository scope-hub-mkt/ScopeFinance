"use client";

import { useEffect, useState } from "react";
import { Field, Dinheiro } from "@/components/ui";
import type { ContratoServico } from "@/lib/types";

/** Um item em edição — ainda sem id enquanto não foi gravado. */
export interface ItemRascunho {
  id?: string;
  servico_id: string | null;
  descricao: string;
  quantidade: number;
  valor: number;
  recorrencia: string | null;
}

export interface ItemCatalogo {
  id: string;
  nome: string;
  preco_tabela: number | string | null;
  recorrencia: string | null;
  ativo: boolean;
}

export const rascunhoDe = (i: ContratoServico): ItemRascunho => ({
  id: i.id,
  servico_id: i.servico_id,
  descricao: i.descricao,
  quantidade: Number(i.quantidade ?? 1) || 1,
  valor: Number(i.valor ?? 0) || 0,
  recorrencia: i.recorrencia,
});

/**
 * Soma dos itens — a grandeza que a tela compara com o valor do contrato.
 *
 * ⚠️ Em **centavos inteiros**, pelo mesmo motivo que `lib/integracao/contrato.ts`
 * passou a somar assim em 28/08/2026: `0.1 + 0.2` não dá `0.3` em JavaScript,
 * e cada item acrescenta um resíduo. Aqui o resíduo apareceria como uma
 * divergência de centavos entre itens e contrato que ninguém conseguiria
 * explicar — um alerta falso, que é a pior espécie.
 */
export function somaItens(itens: ItemRascunho[]): number {
  const centavos = itens.reduce(
    (s, i) => s + Math.round((Number(i.valor) || 0) * 100) * (Number(i.quantidade) || 1),
    0
  );
  return centavos / 100;
}

/**
 * O editor dos **N serviços de um contrato** — a ligação `1:N` decidida pelo
 * dono em 31/08/2026.
 *
 * ⚖️ **Por que os itens são editados dentro do modal do contrato, e não numa
 * tela própria.** Um serviço não existe fora de um contrato (é a outra metade
 * da regra: *"um serviço deve possuir um contrato"*). Uma tela separada de
 * "itens" convidaria a criar item primeiro e procurar contrato depois —
 * exatamente a ordem que a regra proíbe.
 *
 * ⛔ **O catálogo é opcional e o nome não é.** Escolher um serviço do catálogo
 * preenche a descrição e o preço de tabela, mas nada obriga a escolher: escopo
 * fechado sob medida é faturável e não é item de catálogo. O que não se aceita
 * é item sem nome — é o `check` do banco, e é o que alguém precisa ler na hora
 * de cobrar.
 */
export function ItensDoContrato({
  itens,
  onChange,
  freqContrato,
  valorContrato,
}: {
  itens: ItemRascunho[];
  onChange: (itens: ItemRascunho[]) => void;
  freqContrato: string;
  valorContrato: number;
}) {
  const [catalogo, setCatalogo] = useState<ItemCatalogo[]>([]);
  const [erroCatalogo, setErroCatalogo] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/catalogo")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => vivo && setCatalogo(Array.isArray(d) ? d : []))
      // ⛔ Catálogo fora do ar não impede cadastrar: a descrição livre continua
      // valendo, e travar a venda por causa de um seletor de conveniência
      // seria transformar comodidade em bloqueio. A tela DIZ que ele faltou —
      // some o auxílio, não a informação de que ele existia.
      .catch(() => vivo && setErroCatalogo("Catálogo indisponível — descreva o serviço à mão."));
    return () => {
      vivo = false;
    };
  }, []);

  const mexer = (idx: number, campo: keyof ItemRascunho, valor: unknown) => {
    onChange(itens.map((i, k) => (k === idx ? { ...i, [campo]: valor } : i)));
  };

  const escolherServico = (idx: number, servicoId: string) => {
    const s = catalogo.find((c) => c.id === servicoId);
    onChange(
      itens.map((i, k) =>
        k !== idx
          ? i
          : {
              ...i,
              servico_id: s ? s.id : null,
              // Só preenche o que ainda está vazio: quem já digitou uma
              // descrição própria ou negociou um preço não a perde por ter
              // vinculado o item ao catálogo depois.
              descricao: i.descricao.trim() || (s?.nome ?? ""),
              valor: i.valor || Number(s?.preco_tabela ?? 0) || 0,
              recorrencia: i.recorrencia ?? s?.recorrencia ?? null,
            }
      )
    );
  };

  const soma = somaItens(itens);
  // Comparação em centavos: ver `somaItens`.
  const diverge = itens.length > 0 && Math.round(soma * 100) !== Math.round((valorContrato || 0) * 100);

  return (
    <div className="itens-contrato">
      <div className="itens-cab">
        <label>Serviços do contrato *</label>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() =>
            onChange([
              ...itens,
              { servico_id: null, descricao: "", quantidade: 1, valor: 0, recorrencia: null },
            ])
          }
        >
          <i className="ti ti-plus" />
          Adicionar serviço
        </button>
      </div>

      {erroCatalogo && <div className="tiny">{erroCatalogo}</div>}

      {!itens.length && (
        <div className="empty">
          <i className="ti ti-package-off" aria-hidden="true" />
          Nenhum serviço neste contrato. Um contrato sem serviço não chega à Dashboard —
          ela o trata como encerrado, porque comercialmente é o que ele é.
        </div>
      )}

      {itens.map((it, idx) => (
        <div className="item-linha" key={it.id ?? `novo-${idx}`}>
          <Field label="Serviço do catálogo">
            <select
              value={it.servico_id ?? ""}
              onChange={(e) => escolherServico(idx, e.target.value)}
            >
              <option value="">Sem vínculo (sob medida)</option>
              {catalogo
                .filter((c) => c.ativo || c.id === it.servico_id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                    {c.ativo ? "" : " (encerrado)"}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Descrição *">
            <input
              value={it.descricao}
              onChange={(e) => mexer(idx, "descricao", e.target.value)}
              placeholder="Como este serviço aparece na cobrança"
            />
          </Field>
          <Field label="Qtd.">
            <input
              type="number"
              min={1}
              value={it.quantidade}
              onChange={(e) => mexer(idx, "quantidade", Number(e.target.value) || 1)}
            />
          </Field>
          <Field label="Valor (R$)">
            <input
              type="number"
              value={it.valor}
              onChange={(e) => mexer(idx, "valor", Number(e.target.value) || 0)}
            />
          </Field>
          <Field label="Recorrência">
            <select
              value={it.recorrencia ?? ""}
              onChange={(e) => mexer(idx, "recorrencia", e.target.value || null)}
            >
              <option value="">Igual à do contrato ({freqContrato})</option>
              <option>Único</option>
              <option>Mensal</option>
              <option>Trimestral</option>
              <option>Anual</option>
            </select>
          </Field>
          <button
            type="button"
            className="btn btn-sm btn-d item-remover"
            aria-label={`Remover ${it.descricao || "serviço"}`}
            onClick={() => onChange(itens.filter((_, k) => k !== idx))}
          >
            <i className="ti ti-trash" />
          </button>
        </div>
      ))}

      {itens.length > 0 && (
        <div className="itens-soma">
          <span>
            Soma dos serviços: <strong><Dinheiro v={soma} /></strong>
          </span>
          {/* A divergência é DECLARADA, nunca corrigida sozinha. O valor do
              contrato é o acordado, e é dele que a cobrança sai — sobrescrevê-lo
              com a soma dos itens mudaria dinheiro já contratado, que é o que
              `RN-01` proíbe fazer por conta própria. */}
          {diverge && (
            <span className="bdg bdg-r">
              Valor do contrato: <Dinheiro v={valorContrato} /> — diferença de{" "}
              <Dinheiro v={soma - valorContrato} />
            </span>
          )}
        </div>
      )}
    </div>
  );
}
