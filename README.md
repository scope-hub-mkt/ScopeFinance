# ScopeFinance

Sistema de gestão financeira da **Scope Company** — back-end real (Next.js + Supabase) sobre a identidade visual preto/laranja do protótipo.

Módulos: Dashboard, Clientes, Contratos, **Assinaturas** (recorrência), Contas a receber, Contas a pagar, Lançamentos, Contas bancárias, Cartões, Relatórios (BI) e **Notas Fiscais (NFS-e via Asaas)**.

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
3. Deploy. O domínio público da Vercel já serve o sistema.
4. **Cron**: o [`vercel.json`](vercel.json) agenda `GET /api/cron/recorrencia` todo dia às 06:00 UTC.
   Defina `CRON_SECRET` na Vercel — ela envia esse segredo no header `Authorization` automaticamente.

### Domínio próprio
Em **Project Settings → Domains**, adicione `financeiro.suaagencia.com.br` e aponte o DNS conforme a Vercel indicar.

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

## O que este sistema NÃO tem (leia antes de confiar)

O Gate G0 da Scope Dashboard auditou este repositório em 21/08/2026 e
registrou riscos que foram **aceitos, não resolvidos**. Parte caiu em
25/08/2026; o resto continua aberto e está aqui para não ser esquecido.

| Item | Estado |
|---|---|
| Suíte de testes | ✅ **existe desde 25/08/2026** — `npm test`, 103 casos (contrato, assinatura, recorrência, sincronia, colunas graváveis) |
| CI | ✅ **existe desde 25/08/2026** — `.github/workflows/ci.yml`: tipos, testes e build |
| Build passando | ✅ corrigido em 25/08/2026 — **estava quebrado** por um erro de lint em `assinaturas/page.tsx`, e ninguém tinha rodado `npm run build` |
| Unicidade de CPF/CNPJ | ✅ índice único normalizado (era o Ponto 1 do Gate G0) |
| Consumo de `cliente.criado` | ✅ implementado (era o Ponto 7 do Gate G0) |
| **Integração Asaas exercitada contra a API real** | ⛔ **NUNCA foi.** `lib/asaas.ts` existe e nenhuma chamada real foi feita. Existir arquivo não é integração que funciona |
| **Histórico de commits** | ⚠️ um único commit inicial até 25/08/2026 — não há evolução para auditar |
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
