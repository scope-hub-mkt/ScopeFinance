# ScopeFinance

Sistema de gestão financeira da **Scope Company** — back-end real (Next.js + Supabase) sobre a identidade visual preto/laranja do protótipo.

Módulos: Dashboard, Clientes, Contratos, **Assinaturas** (recorrência), Contas a receber, Contas a pagar, **Contas bancárias** e **Cartões** (leitura ao vivo do Asaas), Relatórios (BI) e **Notas Fiscais (NFS-e via Asaas)**.

> ⛔ **02/09/2026 — as telas `Em revisão` e `Fiscal` foram removidas** a pedido do dono. O que elas protegiam continua de pé: a recusa de cobrança para cliente provisório mora em `app/api/[resource]/route.ts`, e a alíquota datada da NFS-e em `lib/fiscal.ts`. Sumiu a tela, não a regra.

- **Contas a receber** = o que os clientes pagam à Scope (sites, assinaturas, projetos…).
- **Contas a pagar** = custos da Scope para existir (aluguel, funcionários, ferramentas…).
- **Assinaturas** têm direção (`receber` = cliente assina o CRM → vira cobrança a receber / `pagar` = a Scope assina uma ferramenta → vira despesa a pagar) e **geram automaticamente** as contas a cada ciclo.

## Stack
- **Next.js 15** (App Router, TypeScript) — front-end + API (route handlers)
- **Supabase** (Postgres + Auth)
- **Asaas** (NFS-e e, no futuro, assinaturas/cobranças)
- Deploy na **Vercel** (com Cron diário para a recorrência)

---

## 1) Pré-requisitos
- Node 18+ (testado com Node 24)
- Conta no [Supabase](https://app.supabase.com) e na [Vercel](https://vercel.com)
- (Para NF) Conta no [Asaas](https://www.asaas.com) — comece pelo **sandbox**

## 2) Configurar o Supabase
1. Crie um projeto em https://app.supabase.com
2. Em **SQL Editor**, cole e rode todo o conteúdo de [`supabase/schema.sql`](supabase/schema.sql). Cria as tabelas, triggers (saldo automático) e RLS.
3. Em **Project Settings → API**, copie:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` (secreta) → `SUPABASE_SERVICE_ROLE_KEY`
4. Crie o usuário do CEO: **Authentication → Users → Add user** (e-mail + senha). 
   Dica: em **Authentication → Providers → Email**, desligue *Confirm email* para facilitar o primeiro acesso.

## 3) Variáveis de ambiente
Copie o exemplo e preencha:
```bash
cp .env.local.example .env.local
```
Mínimo para rodar: as três variáveis do Supabase. Asaas/Cron podem ficar em branco até você usar NF.

## 4) Rodar localmente
```bash
npm install
npm run dev
```
Abra http://localhost:3000 → faça login com o usuário criado no Supabase.

## 5) Deploy na Vercel
1. Suba este projeto para um repositório Git e **importe na Vercel** (ou rode `vercel`).
2. Em **Project Settings → Environment Variables**, cadastre as mesmas variáveis do `.env.local`
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, e quando for usar: `ASAAS_API_KEY`, `ASAAS_API_BASE`, `CRON_SECRET`, `ASAAS_NF_*`).
3. Deploy. O endereço canônico é **`https://finance.scopecompany.com.br`** —
   veja *Domínio próprio*, logo abaixo.
4. **Cron**: o [`vercel.json`](vercel.json) agenda `GET /api/cron/recorrencia` todo dia às 06:00 UTC.
   Defina `CRON_SECRET` na Vercel — ela envia esse segredo no header `Authorization` automaticamente.

### Domínio próprio — `finance.scopecompany.com.br`

**Desde 04/09/2026 o endereço canônico é `https://finance.scopecompany.com.br`.**
`scopefinance-chi.vercel.app` continua de pé e responde **308** para ele: um
endereço só, e nenhum link antigo morre.

#### A ordem é obrigatória, e inverter não dá erro — dá silêncio

O alvo do CNAME é gerado **por projeto**, no instante em que o domínio é
adicionado na Vercel (`<hash>.vercel-dns-017.com`). Criar o registro no DNS
antes produz um CNAME sintaticamente perfeito apontando para lugar nenhum, e
**nada fica vermelho** — nem na Vercel, nem na Hostinger.

1. **Vercel** → projeto `scopefinance` → *Settings › Domains › Add Existing* →
   `finance.scopecompany.com.br`. A tela passa a mostrar *Invalid
   Configuration* com o registro exigido. **É a única fonte do valor do
   passo 2** — não há como deduzi-lo nem reaproveitá-lo de outro projeto.
2. **Hostinger** → hPanel → Domínios → `scopecompany.com.br` → *DNS /
   Nameservers*. A zona é autoritativa lá (NS `dns-parking`), e já hospeda
   `painel`, `suportecrm` e `dashboard` na Vercel.

   | Tipo | Nome | Aponta para | TTL |
   |---|---|---|---|
   | `CNAME` | `finance` | `d54cba0101c0baeb.vercel-dns-017.com` | 300 |

   ⛔ **O nome é só o rótulo** (`finance`), nunca o domínio inteiro — a
   Hostinger completa a zona sozinha, e `finance.scopecompany.com.br` no campo
   vira `finance.scopecompany.com.br.scopecompany.com.br`.

   ⛔ **Não encoste em `@` (ALIAS), `MX`, `TXT` (SPF/DMARC) nem
   `*._domainkey`.** Ali mora o e-mail da empresa; um deles a menos e a Scope
   para de receber e-mail sem que nada nesta aplicação mude de cor.
3. **Vercel** → domínio `scopefinance-chi.vercel.app` → *Edit* → *Redirect to*
   `finance.scopecompany.com.br`, **308 Permanent**.

#### O passo que falha em silêncio: o Supabase Auth

**Authentication › URL Configuration → Site URL** =
`https://finance.scopecompany.com.br`.

⛔ **O Supabase não devolve erro para um `redirectTo` fora da allow-list:**
ele ignora e manda para a Site URL. Domínio novo com Site URL velha autentica
normalmente e deposita o usuário no endereço antigo — sem exceção, sem log,
sem tela vermelha.

⚖️ **Nenhuma Redirect URL foi acrescentada, e isso é escolha.** Este
repositório não chama `redirectTo` em lugar nenhum: o login é
`signInWithPassword`/`signUp` ([`app/login/page.tsx`](app/login/page.tsx)) e
todo desvio do [`middleware.ts`](middleware.ts) é relativo
(`request.nextUrl.clone()`). Allow-list curta é allow-list que alguém
consegue auditar.

⚠️ **A sessão do endereço antigo não atravessa.** O cookie do `@supabase/ssr`
é *host-only*: todo mundo faz login de novo, uma vez. É o desenho do cookie,
não defeito da migração.

#### O que mora fora do repositório — deploy nenhum alcança

| Onde | O quê | Como se muda |
|---|---|---|
| Painel do **Asaas** | os **dois** webhooks (`Scope Finance — negócio` e `— operacional`) | `node scripts/webhooks-asaas.mjs --aplicar` |
| Banco da **Dashboard** | `SCOPEFINANCE_API_BASE`, `SCOPEFINANCE_CRM_WEBHOOK_URL` e o `url_destino` da assinatura de webhook | *Administração → Integrações* e *Administração → API* |

⚠️ **O CRM não guarda endereço nosso** — e a suposição contrária manda mexer no
sistema errado. O `api.scopecompany.com.br` é **somente leitura**: quem entrega
em `/api/integracao/webhooks/crm` é a **Dashboard**, a cada 10 min, lendo o
destino de `SCOPEFINANCE_CRM_WEBHOOK_URL` no banco dela. Dois dos três
ponteiros são `POST` assinado com HMAC e janela de tempo.

⛔ **POST de terceiro seguindo 308 é arranjo, não desenho.** O 308 existe para
o navegador e para o link esquecido; o Asaas é a fonte do fato financeiro
(`D-99`) e a entrega dele tem de acertar o endereço na primeira tentativa.

⚠️ **Antes de rodar `webhooks-asaas.mjs`, olhe o `ASAAS_API_KEY` do
`.env.local`.** Medido em 04/09/2026: o valor estava gravado como
`\$aact_prod_…` — a barra que escapa o `$` no shell tinha entrado no arquivo.
O script mandava a barra junto e o Asaas respondia `invalid_access_token`. O
sintoma acusa a chave; a chave estava certa.

#### Medido em 04/09/2026, depois da troca

| Sonda | Resultado |
|---|---|
| `finance.scopecompany.com.br` → CNAME | `d54cba0101c0baeb.vercel-dns-017.com` · Vercel `misconfigured: false` |
| `GET https://finance.scopecompany.com.br/login` | **200**, certificado válido |
| `HEAD https://scopefinance-chi.vercel.app/login` | **308** → `https://finance.scopecompany.com.br/login` (caminho preservado) |
| `POST …/api/integracao/webhooks/asaas` sem token | **401** |
| `POST …/api/integracao/webhooks/crm` sem HMAC | **401** |
| `GET …/api/integracao/webhooks/asaas` | `provisionado: true`, fila `pendentes: 0`, `falhos: 0`, `alerta: false` |
| Webhooks no painel do Asaas | os **dois** em `finance.scopecompany.com.br`, `enabled`, `interrupted: false`, 49 + 24 = **73** eventos |
| A chamada **exata** do workflow, com o `CRON_SECRET` real | `exit 0` e o JSON da varredura: `pendentes: 0`, `falhos: 0`, `alerta: false` |
| Ponte da Dashboard → Finance, com a chave real | `GET /api/integracao/saude` **200**, `faltando: []`, `fila_de_saida: 0`, banco alcançável |

⚖️ **A troca em [`.github/workflows/asaas-varredura.yml`](.github/workflows/asaas-varredura.yml)
conserta uma falha silenciosa, não só um endereço.** O passo usa
`curl -fsS` **sem `-L`**. Medido: contra o endereço antigo isso devolve
`exit 0` com o corpo `Redirecting...` — o `grep '"alerta":true'` não acha
nada, o workflow fica **verde e nunca chama o cron**. Contra o endereço novo,
credencial errada devolve `exit 22` (401) e o workflow fica vermelho, que é o
comportamento que o §4.9 comprou.

⛔ **E o workflow ganhou guarda contra a classe, não contra este endereço.**
Trocar a URL conserta o caso; conferir que a resposta **parece** a resposta
cobre também corpo vazio e página de erro HTML. Se o JSON da varredura não
vier, o job falha dizendo isso — em vez de passar em branco.

---

## Como funcionam as Assinaturas (recorrência)
- Cada assinatura **Ativa** tem `proximo_venc` e um `ciclo` (mensal/trimestral/anual).
- O motor ([`lib/recorrencia.ts`](lib/recorrencia.ts)) cria a conta da competência vencida (a **receber** ou a **pagar**) e avança o próximo vencimento.
- É **idempotente** (constraint `UNIQUE(assinatura_id, competencia)`): rodar duas vezes não duplica.
- Disparo: **automático** via Vercel Cron, ou **manual** pelo botão *“Gerar cobranças”* na tela de Assinaturas.

## Como funciona a Nota Fiscal (NFS-e via Asaas)
1. No painel do **Asaas**, configure a emissão de NFS-e (dados da empresa, certificado/portal e o **código de serviço municipal**).
2. Defina `ASAAS_API_KEY` (sandbox primeiro) e, se quiser, os padrões `ASAAS_NF_MUNICIPAL_SERVICE_CODE` e alíquotas `ASAAS_NF_*`.
3. O cliente precisa ter **CPF/CNPJ**. Ao emitir, o sistema garante o *customer* no Asaas, cria a nota, autoriza e guarda número/PDF/XML.
4. Emita por **Notas Fiscais → Emitir NF**, ou pelo botão de recibo em **Contas a receber**.

## Próximo passo (futuro): integração total com o Asaas
Os campos `asaas_customer_id` / `asaas_subscription_id` / `asaas_payment_id` já existem no schema para, depois, sincronizar assinaturas e cobranças hospedadas no Asaas com este sistema.

---

## Integração com a Scope Dashboard

### O que cada lado faz

| Direção | Como | O quê |
|---|---|---|
| Dashboard **lê** daqui | `GET /api/integracao/*`, chave `Bearer` | clientes, resumo (KPIs), série mensal, pagamentos recebidos |
| Dashboard **escreve** aqui | `POST /api/integracao/contas-pagar` | comissão aprovada vira despesa (idempotente por `referencia_externa`) |
| Dashboard → aqui, por evento | `POST /api/integracao/eventos`, HMAC | `cliente.criado` / `cliente.atualizado` |
| Aqui → Dashboard, por evento | outbox `integracao_enviados` → webhook de entrada dela | cliente cadastrado **nesta** tela |
| Reconciliação | `GET {dashboard}/api/v1/clientes-mestre` | rede de segurança: fecha o buraco de um evento perdido |

**As leituras são síncronas** (a Dashboard chama e espera). **As escritas de
cadastro são por evento com entrega imediata**: gravamos na outbox e
entregamos logo depois de responder — nunca durante, senão uma Dashboard
lenta atrasaria o cadastro de cliente daqui. O cron das 06:15 UTC é a rede de
segurança, não o caminho normal.

### Provisionar (6 variáveis, 3 pares)

Todas em `.env.local.example`, com o que cada uma liga. Na Vercel elas vão em
**Project Settings → Environment Variables**. A tela `/integracao` mostra
quais faltam.

⚠️ **A tela mede presença da variável, não que o valor esteja certo.** Uma
chave preenchida errado fica verde e falha em silêncio. Use o botão **Testar
conexão** — só uma chamada real distingue "preenchido" de "funciona".

### Ordem de plugagem

1. Rode o `supabase/schema.sql` de novo (é idempotente) — ele cria as tabelas
   de integração e o índice único do documento.
   ⚠️ **Se o índice falhar, ele está funcionando:** já existem CNPJs
   duplicados. A query de diagnóstico está no próprio arquivo, na seção 1.
2. Gere os segredos (`openssl rand -hex 32`) e cadastre os dois lados.
3. Na Dashboard: **Administração → Integrações** (URL e chave daqui) e
   **Administração → Webhooks de entrada** (conexão de origem `scopefinance`).
4. Teste pela tela `/integracao` → **Testar conexão** e **Sincronizar agora**.

---

## Modo Corporativo × Modo Privacidade (`RF-90`)

A barra de topo — que **nasceu com esta feature**, em 31/08/2026 — tem um
interruptor de olho. Ligado, todo valor e toda identidade da tela ficam
ilegíveis; desligado, o sistema mostra tudo como sempre mostrou.

**Para que serve.** O manager apresenta os painéis em reunião com cliente,
como prova de competência da equipe. Sem o interruptor, a única saída é não
mostrar a tela — ou mostrar o faturamento e a carteira inteira para quem
ainda é prospecto.

⛔ **Não é controle de acesso.** O valor continua no HTML, na resposta da API
e no DOM: quem abrir o inspetor lê tudo. A ameaça coberta é **olho na sala e
captura de tela**. Quem pode ver o quê continua sendo decidido no servidor.

| Onde | O quê |
|---|---|
| `lib/privacidade.ts` | o contrato: chave, atributo, padrão e o script inline |
| `app/globals.css` §Modo Privacidade | a regra de máscara — a lista do que borra |
| `components/TopBar.tsx` | a barra de topo e o interruptor |
| `components/ui.tsx` → `<Dinheiro>` | **todo dinheiro em JSX passa por aqui** |
| `tests/privacidade.test.ts` | a guarda que recusa `{fmt(x)}` solto em JSX |

⚠️ **Ao escrever dinheiro numa tela nova, use `<Dinheiro v={x} />`, não
`{fmt(x)}`.** `fmt()` continua existindo para quem precisa da string (um
`title`, uma concatenação, um CSV) — mas em JSX ele nasce sem máscara, e a
bateria de testes recusa. Para identidade (nome, CNPJ, e-mail, telefone) a
marca é `className="sigilo"` ou `<Sigilo>`.

A decisão completa, com as quatro respostas do dono, está no repositório da
Dashboard: `docs/DECISIONS.md` §`D-92`.

---

## O que este sistema NÃO tem (leia antes de confiar)

O Gate G0 da Scope Dashboard auditou este repositório em 21/08/2026 e
registrou riscos que foram **aceitos, não resolvidos**. Parte caiu em
25/08/2026; o resto continua aberto e está aqui para não ser esquecido.

| Item | Estado |
|---|---|
| Suíte de testes | ✅ **existe desde 25/08/2026** — `npm test`, **415 casos** em 24 arquivos (+1 pulado). ♻️ Medido em 04/09/2026; eram 377 em 02/09, 123 em 26/08 e 103 em 25/08 |
| CI | ✅ **existe desde 25/08/2026** — `.github/workflows/ci.yml`: tipos, **lint**, testes e build |
| **Lint** | ✅ **passou a existir de verdade em 25/08/2026.** O script era `next lint` **sem ESLint instalado e sem config** — um comando que promete análise e entrega silêncio: saía limpo porque não olhava para nada. Agora ESLint é dependência real, há `eslint.config.mjs`, e o CI tem passo próprio de lint (0 erros, **18 avisos** — medido em 04/09/2026; eram 17 em 02/09 e 23 antes) |
| Unicidade de CPF/CNPJ | ✅ índice único normalizado (era o Ponto 1 do Gate G0) |
| Consumo de `cliente.criado` | ✅ implementado (era o Ponto 7 do Gate G0) |
| **Integração Asaas exercitada contra a API real** | ✅ **passou a ser em 02/09/2026.** `/bancos` e `/cartoes` leem a conta de produção a cada abertura — saldo (`/finance/balance`), extrato (`/financialTransactions`), titular, chave Pix e as cobranças no cartão (`/payments?billingType=CREDIT_CARD` + `/installments`). ⚠️ O que forçou a mudança foi uma medição: a tabela `bancos` dizia **R$ 429,47** e a conta tinha **R$ 13,79** |
| **Histórico de commits** | ✅ **7 commits, todos publicados** em `origin/main` (`40947b2`) — ♻️ corrigido em 26/08/2026: a linha dizia *"um único commit inicial"* e subestimava o próprio repositório. A evolução de 25 e 26/08 (integração, lint de verdade, `/saude`, `L-63`, `L-64`) **é auditável** |
| **Testes com Postgres real** | ⚠️ os testes usam um Supabase em memória: provam a regra de negócio, **não** o SQL. Constraint de banco só é exercitada rodando o schema |

---

## Estrutura
```
app/
  (app)/            páginas autenticadas (dashboard, clientes, ..., integracao)
  api/
    [resource]/     CRUD genérico de todas as tabelas
    acoes/          pagar, gerar-recorrencias, emitir-nf
    cron/recorrencia  endpoint do Vercel Cron
  login/            tela de login
    integracao/     ponte com a Scope Dashboard (leitura, eventos, saúde, sync)
    cron/integracao entrega da outbox + reconciliação (06:15 UTC)
components/          UI compartilhada (Modal, Badge, Sidebar, BaixaModal...)
lib/                store (client), supabase, asaas, recorrencia, types, format
  integracao/       contrato (puro), auth (HMAC), config, sincronia
supabase/schema.sql migração do banco
tests/              suíte vitest — `npm test`
_reference/         protótipo original (.jsx) — apenas referência
```
