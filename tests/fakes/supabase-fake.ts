import { randomUUID } from "node:crypto";

/**
 * Supabase de mentira, em memória — o que destrava testar `lib/**` sem banco.
 *
 * **De onde ele veio.** Este arquivo é uma cópia literal do fake da Scope
 * Dashboard (`tests/fakes/supabase-fake.ts` de lá), trazida em 25/08/2026 na
 * rodada de integração. O Gate G0 (Ponto 6, `D-18`) registrou como risco
 * ACEITO que o ScopeFinance não tinha suíte de testes — migrar dado
 * financeiro de um sistema onde nenhuma regressão é detectável. Reaproveitar
 * o fake já provado de lá foi o caminho mais curto para retirar esse risco.
 *
 * ⚠️ **É cópia, não dependência.** Os dois sistemas são repositórios
 * separados (`D-42`: dois sistemas, um contrato). Corrigir um bug aqui não
 * corrige lá — quem mexer neste arquivo confere o gêmeo.
 *
 * ⚖️ **O que ele prova e o que não prova.** Prova a **regra de negócio** — a
 * recusa, a ordem, o efeito colateral (auditoria, notificação, timeline).
 * NÃO prova SQL: constraint de banco de verdade é papel de
 * `tests/integracao/**`, que roda contra Postgres real no CI. As duas camadas
 * são deliberadamente redundantes onde se sobrepõem.
 *
 * Uso, em qualquer test file:
 *
 *   vi.mock("@/lib/supabase/admin", async () => {
 *     const { fakeAtual } = await import("../fakes/supabase-fake");
 *     return { createSupabaseAdmin: () => fakeAtual() };
 *   });
 *   beforeEach(() => novoBanco({ usuarios: [ ... ] }));
 */

type Linha = Record<string, unknown>;

interface Filtro {
  aplicar(linha: Linha): boolean;
}

function valor(linha: Linha, col: string): unknown {
  return linha[col];
}

function likeParaRegex(padrao: string): RegExp {
  const escapado = padrao.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${escapado}$`, "i");
}

export interface RestricaoUnica {
  colunas: string[];
  /** Nome da constraint — o domínio decide fluxo lendo `error.message`. */
  nome?: string;
  /** Índice parcial: só linhas que satisfazem o predicado participam. */
  onde?: (l: Linha) => boolean;
}

export interface ConfigTabela {
  /**
   * Conjuntos de colunas com unicidade. A violação devolve o MESMO formato do
   * PostgREST real: `message` "duplicate key…" **e** `code: "23505"`. O código
   * entrou em 25/08/2026 — sem ele, todo fluxo que decide por `error.code`
   * (idempotência de webhook, upsert com conflito) passava no teste pelo
   * caminho de erro genérico e só falhava em produção.
   */
  unicos?: (string[] | RestricaoUnica)[];
  /** Valores default aplicados no insert quando a coluna não veio. */
  defaults?: Record<string, unknown | (() => unknown)>;
}

export class BancoFake {
  tabelas = new Map<string, Linha[]>();
  config = new Map<string, ConfigTabela>();
  /** Toda chamada rpc(nome, args), na ordem — para o teste inspecionar. */
  rpcs: { nome: string; args: unknown }[] = [];
  private rpcHandlers = new Map<string, (banco: BancoFake, args: unknown) => unknown>();

  constructor(seed?: Record<string, Linha[]>, config?: Record<string, ConfigTabela>) {
    for (const [t, linhas] of Object.entries(seed ?? {})) {
      this.tabelas.set(t, linhas.map((l) => ({ ...l })));
    }
    for (const [t, c] of Object.entries(config ?? {})) this.config.set(t, c);
  }

  tabela(nome: string): Linha[] {
    if (!this.tabelas.has(nome)) this.tabelas.set(nome, []);
    return this.tabelas.get(nome)!;
  }

  from(nome: string): ConsultaFake {
    return new ConsultaFake(this, nome);
  }

  /** Simula uma função de banco (ex.: `mover_card`) que o domínio chama por rpc. */
  aoChamarRpc(nome: string, handler: (banco: BancoFake, args: unknown) => unknown): void {
    this.rpcHandlers.set(nome, handler);
  }

  rpc(nome: string, args?: unknown): Promise<{ data: unknown; error: null }> {
    this.rpcs.push({ nome, args });
    const handler = this.rpcHandlers.get(nome);
    return Promise.resolve({ data: handler ? handler(this, args) : null, error: null });
  }
}

type Modo = "select" | "insert" | "update" | "delete" | "upsert";

class ConsultaFake implements PromiseLike<{ data: unknown; error: unknown; count: number | null }> {
  private filtros: Filtro[] = [];
  private modo: Modo = "select";
  private carga: Linha | Linha[] | null = null;
  private onConflict: string[] | null = null;
  private querSelect = false;
  private contagem: "exact" | null = null;
  private soCabecalho = false;
  private ordenacoes: { col: string; asc: boolean }[] = [];
  private teto: number | null = null;
  private unico: "single" | "maybe" | null = null;

  constructor(
    private banco: BancoFake,
    private nome: string
  ) {}

  select(_cols?: string, opts?: { count?: "exact"; head?: boolean }): this {
    if (this.modo === "select") this.querSelect = true;
    else this.querSelect = true;
    if (opts?.count) this.contagem = opts.count;
    if (opts?.head) this.soCabecalho = true;
    return this;
  }

  insert(carga: Linha | Linha[]): this {
    this.modo = "insert";
    this.carga = carga;
    return this;
  }

  update(carga: Linha, opts?: { count?: "exact" }): this {
    this.modo = "update";
    this.carga = carga;
    if (opts?.count) this.contagem = opts.count;
    return this;
  }

  upsert(carga: Linha | Linha[], opts?: { onConflict?: string }): this {
    this.modo = "upsert";
    this.carga = carga;
    this.onConflict = opts?.onConflict ? opts.onConflict.split(",").map((s) => s.trim()) : null;
    return this;
  }

  delete(): this {
    this.modo = "delete";
    return this;
  }

  eq(col: string, v: unknown): this {
    this.filtros.push({ aplicar: (l) => valor(l, col) === v });
    return this;
  }

  neq(col: string, v: unknown): this {
    this.filtros.push({ aplicar: (l) => valor(l, col) !== v });
    return this;
  }

  gt(col: string, v: unknown): this {
    this.filtros.push({ aplicar: (l) => (valor(l, col) as number | string) > (v as number | string) });
    return this;
  }

  gte(col: string, v: unknown): this {
    this.filtros.push({ aplicar: (l) => (valor(l, col) as number | string) >= (v as number | string) });
    return this;
  }

  lt(col: string, v: unknown): this {
    this.filtros.push({ aplicar: (l) => (valor(l, col) as number | string) < (v as number | string) });
    return this;
  }

  lte(col: string, v: unknown): this {
    this.filtros.push({ aplicar: (l) => (valor(l, col) as number | string) <= (v as number | string) });
    return this;
  }

  like(col: string, padrao: string): this {
    const re = likeParaRegex(padrao);
    this.filtros.push({ aplicar: (l) => re.test(String(valor(l, col) ?? "")) });
    return this;
  }

  ilike(col: string, padrao: string): this {
    return this.like(col, padrao);
  }

  is(col: string, v: null | boolean): this {
    this.filtros.push({ aplicar: (l) => valor(l, col) === v || (v === null && valor(l, col) === undefined) });
    return this;
  }

  in(col: string, valores: unknown[]): this {
    this.filtros.push({ aplicar: (l) => valores.includes(valor(l, col)) });
    return this;
  }

  not(col: string, op: string, v: unknown): this {
    if (op === "like") {
      const re = likeParaRegex(String(v));
      this.filtros.push({ aplicar: (l) => !re.test(String(valor(l, col) ?? "")) });
    } else if (op === "is") {
      this.filtros.push({ aplicar: (l) => !(valor(l, col) === v || (v === null && valor(l, col) === undefined)) });
    } else if (op === "eq") {
      this.filtros.push({ aplicar: (l) => valor(l, col) !== v });
    } else {
      throw new Error(`supabase-fake: not(${op}) não implementado`);
    }
    return this;
  }

  /** Disjunção PostgREST simples: "col.eq.valor,col.is.null". */
  or(expr: string): this {
    const termos = expr.split(",").map((t) => t.trim());
    this.filtros.push({
      aplicar: (l) =>
        termos.some((termo) => {
          const [col, op, ...resto] = termo.split(".");
          const bruto = resto.join(".");
          if (op === "eq") return String(valor(l, col)) === bruto;
          if (op === "is" && bruto === "null") return valor(l, col) === null || valor(l, col) === undefined;
          throw new Error(`supabase-fake: or("${termo}") não implementado`);
        }),
    });
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.ordenacoes.push({ col, asc: opts?.ascending !== false });
    return this;
  }

  limit(n: number): this {
    this.teto = n;
    return this;
  }

  range(de: number, ate: number): this {
    this.teto = ate - de + 1;
    return this;
  }

  single(): this {
    this.unico = "single";
    return this;
  }

  maybeSingle(): this {
    this.unico = "maybe";
    return this;
  }

  private selecionar(): Linha[] {
    let linhas = this.banco.tabela(this.nome).filter((l) => this.filtros.every((f) => f.aplicar(l)));
    for (const o of [...this.ordenacoes].reverse()) {
      linhas = [...linhas].sort((a, b) => {
        const va = valor(a, o.col) as never;
        const vb = valor(b, o.col) as never;
        if (va === vb) return 0;
        const cmp = va > vb ? 1 : -1;
        return o.asc ? cmp : -cmp;
      });
    }
    if (this.teto !== null) linhas = linhas.slice(0, this.teto);
    return linhas;
  }

  private violacaoUnicidade(nova: Linha, ignorar?: Linha): string | null {
    const cfg = this.banco.config.get(this.nome);
    for (const bruta of cfg?.unicos ?? []) {
      const r: RestricaoUnica = Array.isArray(bruta) ? { colunas: bruta } : bruta;
      if (r.onde && !r.onde(nova)) continue;
      const existente = this.banco
        .tabela(this.nome)
        .find(
          (l) =>
            l !== ignorar &&
            (!r.onde || r.onde(l)) &&
            r.colunas.every((c) => l[c] === nova[c] && nova[c] !== undefined)
        );
      if (existente) {
        const nome = r.nome ?? r.colunas.join("_");
        return `duplicate key value violates unique constraint "${nome}"`;
      }
    }
    return null;
  }

  private comDefaults(linha: Linha): Linha {
    const cfg = this.banco.config.get(this.nome);
    const saida: Linha = { ...linha };
    if (saida.id === undefined) saida.id = randomUUID();
    for (const [col, def] of Object.entries(cfg?.defaults ?? {})) {
      if (saida[col] === undefined) saida[col] = typeof def === "function" ? (def as () => unknown)() : def;
    }
    return saida;
  }

  private executar(): { data: unknown; error: unknown; count: number | null } {
    if (this.modo === "select") {
      if (this.contagem && this.soCabecalho) {
        return { data: null, error: null, count: this.selecionar().length };
      }
      const linhas = this.selecionar().map((l) => ({ ...l }));
      if (this.unico === "single") {
        if (linhas.length !== 1)
          return { data: null, error: { message: `esperava 1 linha, achou ${linhas.length}` }, count: null };
        return { data: linhas[0], error: null, count: null };
      }
      if (this.unico === "maybe") return { data: linhas[0] ?? null, error: null, count: null };
      return { data: linhas, error: null, count: this.contagem ? linhas.length : null };
    }

    if (this.modo === "insert") {
      const entradas = (Array.isArray(this.carga) ? this.carga : [this.carga!]).map((l) => this.comDefaults(l!));
      for (const e of entradas) {
        const viol = this.violacaoUnicidade(e);
        if (viol) return { data: null, error: { message: viol, code: "23505" }, count: null };
      }
      this.banco.tabela(this.nome).push(...entradas);
      return this.responderEscrita(entradas);
    }

    if (this.modo === "upsert") {
      const entradas = (Array.isArray(this.carga) ? this.carga : [this.carga!]).map((l) => ({ ...l! }));
      const resultado: Linha[] = [];
      for (const e of entradas) {
        const chave = this.onConflict;
        const alvo = chave
          ? this.banco.tabela(this.nome).find((l) => chave.every((c) => l[c] === e[c]))
          : undefined;
        if (alvo) {
          Object.assign(alvo, e);
          resultado.push(alvo);
        } else {
          const nova = this.comDefaults(e);
          this.banco.tabela(this.nome).push(nova);
          resultado.push(nova);
        }
      }
      return this.responderEscrita(resultado);
    }

    if (this.modo === "update") {
      const alvos = this.banco.tabela(this.nome).filter((l) => this.filtros.every((f) => f.aplicar(l)));
      for (const a of alvos) {
        const candidata = { ...a, ...this.carga };
        const viol = this.violacaoUnicidade(candidata, a);
        if (viol) return { data: null, error: { message: viol, code: "23505" }, count: null };
      }
      for (const a of alvos) Object.assign(a, this.carga);
      const resposta = this.responderEscrita(alvos);
      if (this.contagem) resposta.count = alvos.length;
      return resposta;
    }

    // delete
    const restantes = this.banco.tabela(this.nome).filter((l) => !this.filtros.every((f) => f.aplicar(l)));
    const removidas = this.banco.tabela(this.nome).length - restantes.length;
    this.banco.tabelas.set(this.nome, restantes);
    return { data: null, error: null, count: removidas };
  }

  private responderEscrita(linhas: Linha[]): { data: unknown; error: unknown; count: number | null } {
    if (!this.querSelect) return { data: null, error: null, count: null };
    const copia = linhas.map((l) => ({ ...l }));
    if (this.unico === "single") {
      if (copia.length !== 1)
        return { data: null, error: { message: `esperava 1 linha, achou ${copia.length}` }, count: null };
      return { data: copia[0], error: null, count: null };
    }
    if (this.unico === "maybe") return { data: copia[0] ?? null, error: null, count: null };
    return { data: copia, error: null, count: null };
  }

  then<T1 = unknown, T2 = never>(
    onFulfilled?: ((v: { data: unknown; error: unknown; count: number | null }) => T1 | PromiseLike<T1>) | null,
    onRejected?: ((e: unknown) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    try {
      return Promise.resolve(this.executar()).then(onFulfilled ?? undefined, onRejected ?? undefined);
    } catch (e) {
      return Promise.reject(e).then(onFulfilled ?? undefined, onRejected ?? undefined);
    }
  }
}

// ── Instância corrente, trocada por teste ────────────────────────────

let atual: BancoFake = new BancoFake();

export function novoBanco(seed?: Record<string, Linha[]>, config?: Record<string, ConfigTabela>): BancoFake {
  atual = new BancoFake(seed, config);
  return atual;
}

export function fakeAtual(): BancoFake {
  return atual;
}
