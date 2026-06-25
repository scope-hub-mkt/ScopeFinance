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

## Estrutura
```
app/
  (app)/            páginas autenticadas (dashboard, clientes, ... , notas-fiscais)
  api/
    [resource]/     CRUD genérico de todas as tabelas
    acoes/          pagar, gerar-recorrencias, emitir-nf
    cron/recorrencia  endpoint do Vercel Cron
  login/            tela de login
components/          UI compartilhada (Modal, Badge, Sidebar, BaixaModal...)
lib/                store (client), supabase, asaas, recorrencia, types, format
supabase/schema.sql migração do banco
_reference/         protótipo original (.jsx) — apenas referência
```
