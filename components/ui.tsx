"use client";

import { useEffect, useState } from "react";
import { lerDelta, pctDelta } from "@/lib/kpi";
import { fmt } from "@/lib/format";
import {
  ATTR_PRIVACIDADE,
  CHAVE_PRIVACIDADE,
  MODO_PADRAO,
  alternarModo,
  normalizarModo,
  rotuloAcao,
  rotuloModo,
  type ModoPrivacidade,
} from "@/lib/privacidade";

// ─── TEMA ───────────────────────────────────────────────────────────
/**
 * Alternador de tema claro/escuro — Onda 3.
 *
 * ⚖️ **Por que existe um botão, se a Onda 3 diz "nenhum componente lê o
 * tema".** A regra veda componente de CONTEÚDO ramificando em tema: tile que
 * escolhe cor por `if (tema === 'escuro')` é a porta de entrada de um segundo
 * sistema de design. Este botão não lê tema para decidir aparência — ele lê
 * para saber que ícone mostrar, e escreve o atributo. Sem ele o claro entra
 * como padrão e o escuro fica inalcançável para quem tem o sistema no claro,
 * o que seria descartar identidade que já roda, exatamente o que §8 proíbe.
 *
 * A chave `scope-tema` é a MESMA da Dashboard, de propósito: os dois sistemas
 * são pares (`D-44`) e a preferência é da pessoa, não do sistema.
 *
 * O estado começa `null` e só é lido depois de montar, porque no servidor o
 * `data-tema` ainda não existe — quem o escreve é o script inline do
 * `layout.tsx`, antes da primeira pintura.
 */
export function BotaoTema() {
  const [tema, setTema] = useState<"claro" | "escuro" | null>(null);

  useEffect(() => {
    const atual = document.documentElement.dataset.tema as "claro" | "escuro" | undefined;
    setTema(
      atual ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "escuro" : "claro")
    );
  }, []);

  const alternar = () => {
    const novo = tema === "escuro" ? "claro" : "escuro";
    document.documentElement.dataset.tema = novo;
    try {
      localStorage.setItem("scope-tema", novo);
    } catch {
      /* modo privado: a escolha vale só nesta sessão */
    }
    setTema(novo);
  };

  const rotulo = tema === "escuro" ? "Usar tema claro" : "Usar tema escuro";

  /* ♻️ 31/08/2026 (`RF-90`): era bloco com texto no rodapé da lateral e
     virou ícone na topbar, ao lado do interruptor de privacidade. A
     mecânica não mudou — só a casca e o lugar. O rótulo por extenso vive
     agora no `title`/`aria-label`, que é onde ele nunca disputa espaço. */
  return (
    <button
      className="tb-btn"
      onClick={alternar}
      title={rotulo}
      aria-label={rotulo}
      type="button"
    >
      <i className={`ti ${tema === "escuro" ? "ti-sun" : "ti-moon"}`} aria-hidden="true" />
    </button>
  );
}

/**
 * O interruptor Corporativo × Privacidade — `RF-90` (`D-92`).
 *
 * Mesma mecânica do `BotaoTema` ao lado, de propósito: atributo no `<html>`,
 * escolha em `localStorage`, script inline no `layout.tsx` pintando antes do
 * React. O contrato inteiro — e o que este modo **não** protege — está em
 * `lib/privacidade.ts`.
 *
 * ⚠️ O estado nasce `null` e só é lido depois de montar: no servidor o
 * atributo ainda não existe, e chutar "corporativo" no HTML renderizaria o
 * ícone errado por um quadro para quem tem o modo ligado.
 *
 * ⚖️ **Ligado se anuncia com etiqueta, não só com ícone.** Um olho cortado de
 * 16px é fácil demais de não ver, e o modo de falha aqui é caro: compartilhar
 * a tela achando que ligou.
 */
export function BotaoPrivacidade() {
  const [modo, setModo] = useState<ModoPrivacidade | null>(null);

  useEffect(() => {
    setModo(normalizarModo(document.documentElement.getAttribute(ATTR_PRIVACIDADE)));
  }, []);

  const alternar = () => {
    const novo = alternarModo(modo ?? MODO_PADRAO);
    document.documentElement.setAttribute(ATTR_PRIVACIDADE, novo);
    try {
      localStorage.setItem(CHAVE_PRIVACIDADE, novo);
    } catch {
      /* modo privado do navegador: a escolha vale só nesta aba */
    }
    setModo(novo);
  };

  const atual = modo ?? MODO_PADRAO;

  /**
   * ♻️ 31/08/2026 — os dois modos escritos, sempre. Era um botão de olho que
   * só se nomeava quando ligado; o dono pediu *"podendo optar por Modo
   * Corporativo e Modo Privacidade"*, e um alternador que esconde metade das
   * opções não é escolha entre duas coisas.
   *
   * ⚠️ `radiogroup`, não `tablist`: não há painel sendo trocado — são dois
   * estados mutuamente exclusivos do mesmo conteúdo.
   */
  return (
    <div className="seg tb-priv" role="radiogroup" aria-label="Modo de exibição dos dados">
      {(["corporativo", "privacidade"] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={atual === m}
          className={atual === m ? "act" : ""}
          onClick={() => atual !== m && alternar()}
          title={m === atual ? rotuloModo(m) : rotuloAcao(atual)}
        >
          <i
            className={`ti ${m === "privacidade" ? "ti-eye-off" : "ti-eye"}`}
            aria-hidden="true"
          />
          <span className="tb-priv-rot">{m === "privacidade" ? "Privacidade" : "Corporativo"}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Dinheiro na tela — `RF-90`.
 *
 * ⚖️ **Por que um componente e não a classe solta.** Este sistema tem quase
 * quarenta pontos que escrevem `fmt(valor)` em JSX, cada um com a sua casca
 * (`<td className="c-orange">`, `<strong>`, `<span className="tiny">`). Marcar
 * a casca de cada um funcionaria hoje e falharia no próximo: a marca é
 * invisível na revisão, e um valor novo nasce nítido sem nada ficar vermelho.
 * Com `<Dinheiro>`, escrever dinheiro **é** marcar dinheiro.
 *
 * ⛔ Não substitui `fmt()` — quem precisa da string (um `title`, uma
 * concatenação, um CSV) continua chamando `fmt` direto, e ali a máscara não
 * se aplica porque não há elemento para mascarar.
 */
export function Dinheiro({ v }: { v: number | string | null | undefined }) {
  return <span className="sigilo">{fmt(v)}</span>;
}

/**
 * Marca de sigilo para o que não é dinheiro — nome de cliente, CNPJ, e-mail,
 * telefone. `as` existe porque identidade quase sempre mora dentro de um
 * `<td>` ou de um título, e envolver bloco num `<span>` quebra o layout.
 */
export function Sigilo({
  children,
  as: Tag = "span",
  className = "",
}: {
  children: React.ReactNode;
  as?: "span" | "div" | "td" | "strong";
  className?: string;
}) {
  return <Tag className={`sigilo ${className}`.trim()}>{children}</Tag>;
}

/* ═══════════════════════════════════════════════════════════════════
   BADGE — Onda 6, convergência com a assinatura da Dashboard
   ═══════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ **As chaves são minúsculas de propósito.** A versão anterior indexava
 * por capitalização exata (`Ativo`, `Em negociação`), então um status vindo
 * do banco com outra caixa — ou do Asaas, que devolve `PENDING` — caía no
 * `bdg-x` cinza em silêncio, e um estado CRÍTICO passava a parecer neutro.
 * ⛔ Este é o tipo de defeito que nunca quebra teste: a pílula aparece, só
 * que com a cor errada.
 */
const CLASSE_BADGE: Record<string, string> = {
  ativo: "bdg-g", ativa: "bdg-g", pago: "bdg-g", paga: "bdg-g", emitida: "bdg-g",
  efetivo: "bdg-g",
  inativo: "bdg-x", inativa: "bdg-x", cancelado: "bdg-x", cancelada: "bdg-x", encerrado: "bdg-x",
  pendente: "bdg-a", prospect: "bdg-a", "em negociação": "bdg-a", suspensa: "bdg-a",
  pausado: "bdg-a", agendada: "bdg-a",
  vencido: "bdg-r", inadimplente: "bdg-r", erro: "bdg-r",

  // ── Vocabulário que entrou com a integração de 28/08/2026 ──────────
  //
  // ⚠️ **Sem estas linhas, cada um destes cairia no `bdg-x` cinza** — a cor de
  // "inativo". Um alerta CRÍTICO pintado de cinza é pior que um sem cor: ele
  // afirma, com a autoridade do sistema de design, que não é urgente. É
  // exatamente o defeito que o comentário acima descreve, um passo adiante.
  critico: "bdg-r",
  atencao: "bdg-a",
  em_conflito: "bdg-r",
  "em conflito": "bdg-r",
  provisorio: "bdg-a",

  // ⚖️ Os três tipos de venda e as quatro origens são **classificação, não
  // estado** — nada aqui é bom nem ruim. Por isso todos em `bdg-x`, que é o
  // neutro: pintar "assinatura" de verde sugeriria que ela é melhor que uma
  // avulsa, e cor que carrega juízo onde não há é ruído (Lei 4).
  avulsa: "bdg-x", contrato: "bdg-x", assinatura: "bdg-x",
  crm: "bdg-x", asaas: "bdg-x", dashboard: "bdg-x", scopefinance: "bdg-x",
};

/** Exportada para teste: a escolha de cor é regra, e regra se prova. */
export function classeBadge(s: string): string {
  return CLASSE_BADGE[String(s ?? "").toLowerCase()] ?? "bdg-x";
}

export function Badge({ s, titulo }: { s: string; titulo?: string }) {
  return (
    <span className={`bdg ${classeBadge(s)}`} title={titulo}>
      {s}
    </span>
  );
}

// ─── MODAL ──────────────────────────────────────────────────────────
export function Modal({
  title,
  onClose,
  children,
  largo,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  largo?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="mover"
      onClick={(e) => {
        if ((e.target as HTMLElement).className === "mover") onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className={`mbox${largo ? " mbox-lg" : ""}`}>
        <div className="mtitle">{title}</div>
        {children}
      </div>
    </div>
  );
}

// ─── FORM FIELD ─────────────────────────────────────────────────────
export function Field({
  label,
  span,
  ajuda,
  children,
}: {
  label: string;
  span?: boolean;
  /** Texto de apoio sob o campo — onde a regra de negócio vira instrução. */
  ajuda?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={`fg${span ? " span2" : ""}`}>
      <label>{label}</label>
      {children}
      {ajuda && <div className="ajuda">{ajuda}</div>}
    </div>
  );
}

// ─── PAGE HEADER ────────────────────────────────────────────────────
export function PageHeader({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="ph">
      {/* B-5: o ⬡ saiu daqui em 26/08/2026. Emoji e glifo decorativo em texto
          de interface e proibido pelo sistema de design da Scope — os
          marcadores de status seguem permitidos, porque sao vocabulario
          documentado, mas ornamento antes de titulo nao e vocabulario.
          B-4, no mesmo passo: `.pt span` perdeu a cor. Hierarquia e tamanho e
          peso, nunca cor (Lei 4) — titulo colorido nao existe em nenhuma das
          cinco referencias medidas. */}
      <div className="pt">{title}</div>
      {children && <div className="hgap">{children}</div>}
    </div>
  );
}

// ─── DELTA E TILE DE KPI ────────────────────────────────────────────
export interface DadoDelta {
  /** Variação percentual. O sinal define a direção exibida. */
  valor: number;
  /** Período nomeado — "vs mês anterior". Delta sem período não diz nada. */
  periodo: string;
  /**
   * `false` inverte a leitura de cor. Existe por causa de despesa e
   * inadimplência: lá subir é ruim, e pintar de verde seria mentir com
   * estilo.
   */
  bomQuandoSobe?: boolean;
}

export function Delta({ valor, periodo, bomQuandoSobe = true }: DadoDelta) {
  const { classe, icone, sinal } = lerDelta(valor, bomQuandoSobe);
  return (
    <div>
      <span className={`delta ${classe}`}>
        <i className={`ti ${icone}`} aria-hidden="true" />
        {sinal}
        {pctDelta(valor)}%
      </span>
      <span className="delta-per">{periodo}</span>
    </div>
  );
}

/**
 * ─── A Lei 2: o tile carrega CINCO camadas, não um número ─────────────────
 * Onda 4 de `docs/AGENTE-IDENTIDADE-VISUAL.md` §B.4, na Dashboard. `B-7` do
 * diagnóstico media este componente como *"rótulo + valor 20px, sem delta,
 * sem forma, sem fonte"* — um número sozinho.
 *
 * ⚖️ **`fonte` é obrigatória no TIPO, e essa é a parte que importa.** `RNF-19`
 * (*todo número declara sua procedência*) nasceu na Dashboard e é ainda mais
 * defensável num sistema financeiro: *"R$ 128.750 — fonte: contas a receber
 * pagas"* é a diferença entre um número e um número **auditável**. Deixá-la
 * opcional transformaria o requisito em sugestão; obrigatória, o compilador
 * recusa um KPI sem procedência antes de qualquer revisor.
 *
 * ⚠️ **`delta` e `forma` são opcionais de propósito, e isto NÃO é a Lei 2 pela
 * metade.** Delta exige um período anterior medido. Vários KPIs daqui são
 * saldo em aberto — "a receber", "saldo em conta" — que não têm mês anterior
 * a comparar; e `forma` espera as onze formas da Onda 5. ⛔ Preencher os dois
 * com número inventado seria violar o requisito que este componente existe
 * para servir: um delta falso é pior que delta nenhum, porque parece medição.
 */
export interface ItemMetrica {
  l: string;
  v: React.ReactNode;
  c?: string;
  /** `RNF-19` — de onde saiu o número. Obrigatória. */
  fonte: string;
  /** Ícone Tabler, sem o prefixo `ti-`. */
  icone?: string;
  delta?: DadoDelta;
  /** A quarta camada — chega com as formas da Onda 5. */
  forma?: React.ReactNode;
}

export function MetricGrid({ items }: { items: ItemMetrica[] }) {
  return (
    <div className="mgrid">
      {items.map((m) => (
        <div className="met" key={m.l}>
          <div className="met-topo">
            <div className="met-l">{m.l}</div>
            {m.icone && (
              <span className="met-chip" aria-hidden="true">
                <i className={`ti ti-${m.icone}`} />
              </span>
            )}
          </div>

          <div className={`met-v ${m.c || ""}`}>{m.v}</div>

          {m.delta && <Delta {...m.delta} />}
          {m.forma && <div className="met-forma">{m.forma}</div>}

          <div className="met-fonte">
            <i className="ti ti-database" aria-hidden="true" />
            fonte: {m.fonte}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * ═══ FORMAS — Onda 5 ═══════════════════════════════════════════════
 *
 * ⚖️ **O que sai daqui, e por quê.** `B-9` do diagnóstico:
 * `relatorios/page.tsx` desenhava as barras à mão, com `<div style={…}>`
 * medindo o dado. Três problemas, e nenhum é estético:
 *
 *   1. **Dado desenhado em `style` inline escapa de toda trava.** Largura em
 *      `%` calculada no JSX não é conferível por `lint:design`, não tem
 *      estado vazio próprio e não tem como ser reusada.
 *   2. **A cor era `--marca` chapada.** Laranja da marca não é cor de série:
 *      é identidade. Série tem slot (`--s1`…`--s8`), e a ordem dos slots é
 *      mecanismo de segurança para daltonismo, não gosto.
 *   3. **Não havia estado vazio de verdade** — `Empty` genérico no lugar de
 *      um vazio que diz o que faltou medir.
 *
 * Sem dependência e sem SVG: as barras continuam sendo `div`, mas agora com
 * classe, token e um primitivo só.
 */

/**
 * Slot de série. Ordem FIXA, sem ciclo — a mesma função da Dashboard.
 * ⛔ Ciclar as cores num nono item faria duas séries diferentes vestirem a
 * mesma cor, que é o defeito que a ordem fixa existe para impedir.
 */
export function serie(i: number): string | undefined {
  return i >= 0 && i < 8 ? `var(--s${i + 1})` : undefined;
}

/**
 * Vazio de gráfico — distinto do `Empty` de tabela de propósito.
 * Um gráfico sem dado precisa dizer **o que** não havia para medir; "Sem
 * dados" serve para tudo e por isso não serve para nada.
 */
export function GraficoVazio({ motivo }: { motivo: string }) {
  return (
    <div className="gr-vazio">
      <i className="ti ti-chart-dots" aria-hidden="true" />
      <span>{motivo}</span>
    </div>
  );
}

/**
 * Barras horizontais — ranque nominal.
 *
 * ⚠️ **Nominal ⇒ todas as barras vestem o MESMO slot.** Pintar cada linha de
 * uma cor diferente sugere categoria onde só existe ordem de grandeza, e
 * gasta a paleta inteira num gráfico que não precisa dela.
 */
export function BarrasH({
  itens,
  cor,
  formatar,
  vazio = "Sem itens para ranquear",
  teto = 6,
  rotuloSigiloso = false,
}: {
  itens: { rotulo: string; valor: number }[];
  cor?: string;
  formatar: (n: number) => string;
  vazio?: string;
  /**
   * `RF-90` — o rótulo deste gráfico é CATEGORIA em quase todo uso ("Site",
   * "Aluguel") e **identidade** em um: o ranque de clientes por receita.
   * Sem esta distinção, ou o Top clientes vaza a carteira ao lado de valores
   * borrados, ou toda legenda de categoria vira mancha. Achado pela captura
   * de 31/08/2026, depois de eu ter declarado a identidade coberta.
   */
  rotuloSigiloso?: boolean;
  /** Ranque sem teto vira tabela ruim: as 6 primeiras contam a história. */
  teto?: number;
}) {
  if (!itens.length) return <GraficoVazio motivo={vazio} />;
  const max = Math.max(...itens.map((i) => i.valor), 1);
  const pintura = cor ?? serie(0)!;

  return (
    <div className="vgap gr-entra">
      {itens.slice(0, teto).map((i) => (
        <div key={i.rotulo}>
          <div className="row gr-linha">
            <span className={`gr-rotulo${rotuloSigiloso ? " sigilo" : ""}`} title={i.rotulo}>
              {i.rotulo}
            </span>
            <span className="gr-valor">{formatar(i.valor)}</span>
          </div>
          <div className="pbar gr-trilho">
            <div className="pfill" style={{ width: `${(i.valor / max) * 100}%`, background: pintura }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── EMPTY / LOADING ────────────────────────────────────────────────
export function Empty({ icone, children }: { icone?: string; children: React.ReactNode }) {
  return (
    <div className="empty">
      {icone && <i className={`ti ${icone}`} aria-hidden="true" />}
      {children}
    </div>
  );
}

export function Spinner() {
  return <span className="spin" aria-hidden="true" />;
}
