# OZ App — Documentação Técnica Completa
**Versão auditada:** Agosto 2026  
**Objetivo:** Permitir continuidade do projeto por novo desenvolvedor sem perda de lógica ou funcionalidade.

> **Convenção:** onde uma informação não foi encontrada diretamente no código-fonte, o item é marcado como `[não identificado]`. Nada aqui é presumido.

---

## Índice

1. [Visão Geral do Sistema](#1-visão-geral-do-sistema)
2. [Arquitetura](#2-arquitetura)
3. [Estrutura de Arquivos](#3-estrutura-de-arquivos)
4. [Design System & Paleta Visual](#4-design-system--paleta-visual)
5. [Autenticação e Sessão](#5-autenticação-e-sessão)
6. [Camada de API — Supabase REST](#6-camada-de-api--supabase-rest)
7. [Edge Functions (Servidor)](#7-edge-functions-servidor)
8. [Banco de Dados — Tabelas e Esquemas](#8-banco-de-dados--tabelas-e-esquemas)
9. [Row Level Security (RLS)](#9-row-level-security-rls)
10. [Estado Global da Aplicação](#10-estado-global-da-aplicação)
11. [Inventário Completo de Telas](#11-inventário-completo-de-telas)
12. [Fluxos de Usuário (Cliente)](#12-fluxos-de-usuário-cliente)
13. [Fluxos do Bar](#13-fluxos-do-bar)
14. [Fluxos do Promoter](#14-fluxos-do-promoter)
15. [Sistema de Pagamentos (Mercado Pago / PIX)](#15-sistema-de-pagamentos-mercado-pago--pix)
16. [Sistema de Comissões de Promoter](#16-sistema-de-comissões-de-promoter)
17. [Sistema de Créditos Gratuitos](#17-sistema-de-créditos-gratuitos)
18. [Sistema de Sessão de Noite ("Noite Toda")](#18-sistema-de-sessão-de-noite-noite-toda)
19. [Sistema de Convites (Indique e Ganhe)](#19-sistema-de-convites-indique-e-ganhe)
20. [Pollers em Tempo Real](#20-pollers-em-tempo-real)
21. [Chat e Presença Online](#21-chat-e-presença-online)
22. [Sistema de Likes Bar ↔ Usuário](#22-sistema-de-likes-bar--usuário)
23. [Calendários (Home, Bares, Agendamento)](#23-calendários-home-bares-agendamento)
24. [Painel Administrativo](#24-painel-administrativo)
25. [Tratamento de Erros](#25-tratamento-de-erros)
26. [Regras de Negócio Críticas](#26-regras-de-negócio-críticas)
27. [Segurança — Pontos de Atenção](#27-segurança--pontos-de-atenção)
28. [Integrações Externas](#28-integrações-externas)
29. [Modo Demo](#29-modo-demo)
30. [Checklist do Novo Desenvolvedor](#30-checklist-do-novo-desenvolvedor)

---

## 1. Visão Geral do Sistema

A **OZ App** é um marketplace de benefícios noturnos em São Paulo. O sistema conecta três tipos de atores:

| Ator | Papel |
|------|-------|
| **Cliente** | Descobre bares, ativa benefícios (paga via PIX), acumula histórico |
| **Bar** | Publica benefícios ao vivo ou agendados, acompanha lista de ativados em tempo real, gerencia perfil |
| **Promoter** | Indica bares a clientes, recebe comissão por pick quando o cliente ativa via seu link |

**Pilares técnicos:**
- SPA estático (zero build step — arquivo HTML direto no browser)
- Supabase como backend (Auth + PostgREST + Edge Functions)
- Mercado Pago como gateway de pagamento PIX
- Polling HTTP para "tempo real" (sem WebSocket)

---

## 2. Arquitetura

```
┌─────────────────────────────────────────────────────┐
│                   Browser (cliente)                  │
│                                                      │
│  index.html — SPA com todas as telas como <div>s    │
│  ├── js/supabase-auth.js  (wrapper Auth)            │
│  ├── js/app.js            (lógica principal, 614KB) │
│  ├── js/admin.js          (painel admin, 137KB)     │
│  └── css/ theme.css + style.css + admin.css         │
│                                                      │
│  admin.html           (painel admin — arquivo sep.) │
│  reset-password.html  (redefinição de senha)        │
└──────────────────────┬──────────────────────────────┘
                       │ fetch() — CORS
         ┌─────────────┼─────────────────┐
         ▼             ▼                 ▼
  Supabase Auth   PostgREST REST    Edge Functions
  /auth/v1        /rest/v1          /functions/v1
  (JWT, signUp,   (CRUD tabelas)    (Deno/TypeScript)
   signIn, etc.)
                                         │
                                         ▼
                                  Mercado Pago API
                                  (PIX, webhooks)
```

### Padrão de Telas (SPA)

Todas as telas são `<div id="screen-*">` dentro de `index.html`. A função `showScreen(id)` exibe a tela desejada e oculta as demais. Não há roteamento por URL — o estado de navegação é mantido em memória em `OZ.navigationStack[]`.

---

## 3. Estrutura de Arquivos

```
/
├── index.html                  # SPA principal (~187KB)
├── admin.html                  # Painel admin separado (~54KB)
├── reset-password.html         # Fluxo de redefinição de senha (~9KB)
│
├── js/
│   ├── supabase-auth.js        # Wrapper completo do Supabase Auth (9.5KB)
│   ├── app.js                  # Lógica principal da aplicação (614KB, ~10.550 linhas)
│   └── admin.js                # Lógica do painel admin (137KB)
│
├── css/
│   ├── theme.css               # Design tokens, componentes, animações (126KB)
│   ├── style.css               # Estilos complementares (469KB)
│   └── admin.css               # Estilos do painel admin (44KB)
│
├── images/
│   ├── oz-logo-new.png         # Logo OZ — tornado magenta vetorial (130KB)
│   └── oz-bg-night.jpg         # Foto de fundo da welcome screen (81KB)
│
└── edge-functions/
    ├── README.md               # Documentação das 12 edge functions
    └── sql/
        ├── transactions.sql               # Schema da tabela transactions + RLS
        ├── activations-pending-payment.sql # Schema de activations + RLS
        ├── rls-bars-policies.sql          # RLS da tabela bars
        ├── rls-activations-fix.sql        # RLS ativações (cliente + bar select)
        ├── fix-users-rls-trigger.sql      # RLS da tabela users + timestamps
        ├── fix-activations-enums.sql      # Diagnóstico/adição de valores ao enum
        └── rls-bars.sql                   # DEPRECATED — não executar
```

> **Nota:** O código-fonte das Edge Functions (arquivos `.ts` / `index.js` dentro de `edge-functions/`) não estava acessível no repositório local auditado. As assinaturas e comportamentos foram documentados a partir do `edge-functions/README.md` e das chamadas em `app.js`.

---

## 4. Design System & Paleta Visual

### Variáveis CSS (definidas em `css/theme.css :root`)

```css
/* Paleta OZ oficial */
--color-magenta:  #FF2ED1;   /* primário — destaques, badges, logo glow */
--color-violet:   #8A2BFF;   /* secundário — gradientes */
--color-cyan:     #00F5FF;   /* acento frio */
--color-lime:     #B4FF00;   /* CTA principal — botões de ação */
--color-black:    #010410;   /* fundo base */

/* Tipografia */
--font-display: 'Syne', sans-serif;  /* títulos */
--font-body:    'Syne', sans-serif;  /* corpo */
--font:         'Syne', sans-serif;  /* variável legada em style.css */
```

### Google Fonts
Todos os três arquivos HTML importam Syne via CDN:
```html
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&display=swap" rel="stylesheet">
```

### Animação do Logo
```css
/* Em theme.css — filter: drop-shadow segue o contorno vetorial do PNG */
@keyframes ozLogoPulse {
  0%,100% { filter: drop-shadow(0 0 10px rgba(255,46,209,0.60))
                    drop-shadow(0 0 24px rgba(255,46,209,0.30)); }
  50%     { filter: drop-shadow(0 0 16px rgba(255,46,209,0.90))
                    drop-shadow(0 0 36px rgba(255,46,209,0.50)); }
}
```

---

## 5. Autenticação e Sessão

### Arquivo: `js/supabase-auth.js`

**Configuração:**
```js
SUPA_URL  = 'https://qyxefytxyrmvotjnhoir.supabase.co'
SUPA_ANON = 'eyJhbGci...'  // chave pública anon
SESSION_KEY = 'oz_supabase_session'  // localStorage
```

### API Pública (`window.SupaAuth`)

| Método | Descrição |
|--------|-----------|
| `signUp(email, password, metadata)` | Cadastro via Supabase Auth |
| `signIn(email, password)` | Login — retorna `{ session, user }` |
| `signOut()` | Invalida sessão local e no Supabase |
| `getUser()` | Retorna usuário atual da sessão |
| `getSession()` | Retorna sessão ativa (renova se expirar em < 60s) |
| `isLoggedIn()` | Boolean — verifica se há sessão ativa |
| `getAccessToken()` | JWT de acesso (Bearer token para PostgREST) |
| `refreshSession()` | Renova token via `/auth/v1/token?grant_type=refresh_token` |
| `resetPassword(email)` | Envia e-mail de reset (redirect para `reset-password.html`) |
| `setSessionFromHash()` | Lê token do URL `#access_token=...` (implicit flow) |
| `exchangeCodeForSession(code)` | Troca código PKCE por sessão (`?code=`) |
| `updatePassword(newPassword)` | Atualiza senha com sessão ativa |

### Auto-refresh
`getSession()` verifica se o token expira em menos de 60 segundos. Se sim, chama `refreshSession()` automaticamente antes de retornar.

### Persistência
A sessão é armazenada em `localStorage` com a chave `oz_supabase_session` no formato:
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_at": 1234567890
}
```

### Fluxo de Redefinição de Senha
1. `doForgotPassword()` → chama `SupaAuth.resetPassword(email)` → Supabase envia e-mail
2. Usuário clica no link → redireciona para `reset-password.html?code=XXXX`
3. `reset-password.html` detecta `?code=` → chama `SupaAuth.exchangeCodeForSession(code)`
4. Com sessão válida, chama `SupaAuth.updatePassword(newPassword)`
5. Alternativa (implicit flow): URL com `#access_token=` → `SupaAuth.setSessionFromHash()`

---

## 6. Camada de API — Supabase REST

### Configuração em `js/app.js`

```js
SB_URL  = 'https://qyxefytxyrmvotjnhoir.supabase.co/rest/v1'
SB_ANON = 'eyJhbGci...'  // mesmo da auth
EDGE_BASE = 'https://qyxefytxyrmvotjnhoir.supabase.co/functions/v1'
```

### Helpers de API

#### `_sbUrl(path)` — Tradutor de paths
Converte o padrão legado `tables/tableName?params` para URLs PostgREST reais.

```js
// Entrada legada:
'tables/users?limit=10&page=2'

// Saída PostgREST:
'https://.../rest/v1/users?limit=10&offset=10'
```

A tabela **não** usa `tables/` como prefixo real — é uma convenção interna para compatibilidade com o padrão do projeto.

#### `sbHeaders(extra)` — Headers autenticados
```js
async function sbHeaders(extra = {}) {
  // Inclui Bearer token do usuário logado
  // ou chave anon se não houver sessão
}
```

#### CRUD helpers

```js
apiGet(path)               // GET — leitura
apiPost(path, body)        // POST — criação
apiPatch(path, body)       // PATCH — atualização parcial
apiDelete(path)            // DELETE — soft delete
```

**Timestamps automáticos:** Tabelas no conjunto `_TABLES_WITH_TS` recebem `updated_at: Date.now()` automaticamente no PATCH.

#### Edge Function helpers

```js
edgeFn(name, body)        // POST para /functions/v1/{name}
edgeFnGet(name, params)   // GET para /functions/v1/{name}?params
```

---

## 7. Edge Functions (Servidor)

Implementadas em Deno (TypeScript), hospedadas no Supabase. Executam com `service_role` — **bypassam RLS** completamente. São a única camada autorizada a:
- Criar transações financeiras
- Modificar status de ativações
- Gerar registros de `earnings` (comissões)
- Criar `free_credits` de compensação

### Inventário das 12 Edge Functions

| Nome | Método | Responsabilidade Principal |
|------|--------|---------------------------|
| `criar-transacao` | POST | Cria transação PIX no Mercado Pago; insere `activations` com `status='pending_payment'` |
| `webhook-pagamento` | POST | Recebe notificação MP; valida HMAC-SHA256; muda `pending_payment → active`; chama `gerar-earning` |
| `gerar-earning` | POST | Cria registro na tabela `earnings` para o promoter que fez o pick |
| `cancelar-ativacao` | POST | Cancela ativação individual pelo bar; cria `free_credit` de compensação |
| `cancelar-beneficio-status` | POST | Cancela todas as ativações de uma promoção/benefício; cria `free_credit` para cada cliente afetado; notifica via `notifications` |
| `confirmar-reserva` | POST | Confirma reserva antecipada; cria PIX para benefício agendado futuro |
| `gerar-pix-avulso` | POST | [não identificado — presumido: gera PIX fora do fluxo padrão] |
| `get-activation-status` | GET | Polling do status de pagamento PIX (`pending_payment → active`) |
| `sacar-comissao` | POST | Inicia solicitação de saque do saldo do promoter |
| `processar-saque` | POST | [não identificado — provavelmente: processa saque após aprovação] |
| `split-pick-commission` | POST | Divide comissão de pick entre promoter e OZ |
| `check-night-session` | GET | Verifica se existe sessão "Noite Toda" ativa para o usuário |

> **Fonte:** `edge-functions/README.md` + chamadas em `js/app.js`. Assinaturas completas estão no README das funções.

### Payloads conhecidos (mapeados do app.js)

**`criar-transacao` (POST)**
```json
{
  "user_id": "uuid",
  "bar_id": "uuid",
  "bar_name": "string",
  "benefit_type": "individual|night|free_used",
  "amount": 10.00,
  "promo_id": "uuid|null",
  "promoter_pick": "uuid|null",
  "night_session": "uuid|null",
  "benefit_date": "YYYY-MM-DD"
}
```

**`cancelar-beneficio-status` (POST)**
```json
{
  "bar_id": "uuid",
  "today": "YYYY-MM-DD",
  "promo_id": "uuid|null",
  "scheduled_benefit_id": "uuid|null",
  "cancel_activations": true,
  "compensar_clientes": true,
  "motivo": "string",
  "bar_name": "string",
  "promo_title": "string",
  "cutoff_ts": 1234567890
}
```

**Retorno de `cancelar-beneficio-status`:**
```json
{
  "ativacoes_canceladas": 5,
  "clientes_compensados": 5
}
```

---

## 8. Banco de Dados — Tabelas e Esquemas

### `users`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | text (UUID) | `auth.uid()` — ID do Supabase Auth |
| `name` | text | Nome completo |
| `email` | text | E-mail |
| `phone` | text | Telefone com máscara |
| `cpf` | text | CPF (clientes e promoters) |
| `cnpj` | text | CNPJ (bares) |
| `role` | text | `'cliente'` \| `'bar'` \| `'promoter'` |
| `birth_date` | text | Data de nascimento (YYYY-MM-DD) |
| `gender` | text | Gênero (`'M'`, `'F'`, `'NB'`, `'ND'`) |
| `photo_url` | text | URL da foto de perfil |
| `bar_id` | text | ID do bar (apenas role=bar) |
| `bar_name` | text | Nome do bar (cache local) |
| `bar_genre` | text | Gênero musical do bar |
| `bar_instagram` | text | Instagram do bar |
| `bar_release` | text | Descrição do bar |
| `responsible_name` | text | Nome do responsável (bar) |
| `approval_status` | text | `'pending'` \| `'approved'` \| `'rejected'` |
| `approval_note` | text | Motivo da rejeição (admin) |
| `promoter_type` | text | Tipo de atuação do promoter |
| `promoter_region` | text | Região de atuação |
| `promoter_instagram` | text | Instagram do promoter |
| `promoter_release` | text | Bio profissional |
| `pix_key` | text | Chave PIX do promoter (saque) |
| `referral_code` | text | Código único do promoter (para link de convite) |
| `invite_code` | text | Código de convite do cliente |
| `promoter_pick` | text | ID do bar que o promoter escolheu para comissão |
| `balance` | numeric | Saldo em carteira do promoter (comissões acumuladas) |
| `total_activations` | integer | Contador de ativações (denormalizado) |
| `total_visitors` | integer | Visitantes únicos (denormalizado, bar) |
| `created_at` | timestamptz | Criação do registro |
| `updated_at` | timestamptz | Última atualização |

### `bars`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | uuid | ID do bar (igual a `auth.uid()` do usuário dono) |
| `name` | text | Nome do bar |
| `neighborhood` | text | Bairro |
| `photo_url` | text | URL da foto/logo |
| `cover_url` | text | URL da foto de capa |
| `gallery` | jsonb | Array de URLs de fotos da galeria |
| `genre` | text | Gênero musical |
| `instagram` | text | Instagram |
| `address` | text | Endereço completo |
| `hours` | text | Horário de funcionamento |
| `whatsapp` | text | WhatsApp |
| `release` | text | Descrição/bio do bar |
| `description` | text | Alias de release |
| `event_tonight` | text | Evento da noite atual |
| `benefit` | text | Benefício atual (denormalizado) |
| `active` | boolean | Bar visível na plataforma |
| `approval_status` | text | Status de aprovação |
| `peak_hour` | text | Horário de pico (ex: "23h–01h") |
| `total_activations` | integer | Contador total (denormalizado) |

### `activations`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | uuid | PK |
| `user_id` | text | ID do cliente |
| `user_name` | text | Nome do cliente (snapshot) |
| `bar_id` | text | ID do bar |
| `bar_name` | text | Nome do bar (snapshot) |
| `type` | activation_type enum | Tipo da ativação (ver abaixo) |
| `status` | activation_status enum | Status atual (ver abaixo) |
| `amount` | numeric | Valor pago |
| `benefit_date` | text | Data do benefício (YYYY-MM-DD) |
| `promo_id` | text | ID da promoção vinculada |
| `promoter_pick` | text | ID do promoter que fez o pick |
| `night_session` | text | UUID da sessão de noite |
| `created_at` | bigint (ms) | Timestamp de criação |

**Valores do enum `activation_type`:**
- `individual` — ativação padrão unitária
- `night` — "Noite Toda" no bar principal
- `night_link` — "Noite Toda" em bar adicional
- `night_checkin` — check-in em bar via sessão de noite
- `free_used` — uso de crédito gratuito
- `free_credit` — geração de crédito (interno — não aparece em listas)
- `advance_individual` — reserva antecipada unitária
- `advance_night` — reserva antecipada noite toda
- `advance_free` — reserva antecipada com crédito

**Valores do enum `activation_status`:**
- `pending_payment` — PIX gerado, aguardando webhook
- `active` — pagamento confirmado
- `cancelled` — cancelada (pelo bar ou pelo sistema)
- `failed` — falha no pagamento
- `confirmado` — legado
- `usado` — legado

### `promotions`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | uuid | PK |
| `bar_id` | text | ID do bar |
| `bar_name` | text | Nome do bar |
| `title` | text | Título do benefício |
| `description` | text | Descrição detalhada |
| `benefit_type` | text | Tipo (geralmente `'livre'`) |
| `event_tonight` | text | Evento da noite |
| `valid_from` | text | Hora de início (ex: "20:00") |
| `valid_until` | text | Hora de fim (sempre "06:00") |
| `expiry_at` | timestamptz | Data/hora de expiração absoluta |
| `active` | boolean | Se está ativo |
| `activations_count` | integer | Contador de ativações |
| `max_activations` | integer | Limite (0 = sem limite) |
| `created_at` | bigint (ms) | Timestamp |

### `scheduled_benefits`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | uuid | PK |
| `bar_id` | text | ID do bar |
| `bar_name` | text | Nome do bar |
| `date` | text | Data (YYYY-MM-DD) |
| `title` | text | Título do benefício |
| `description` | text | Descrição |
| `event` | text | Evento |
| `category` | text | Categoria (Comidinha, Bebida, Entrada VIP, Desconto, Outros) |
| `max_activations` | integer | Limite (0 = sem limite) |
| `reservations_count` | integer | Contador de reservas |
| `activations_count` | integer | Contador de ativações |
| `active` | boolean | Se está ativo |
| `local_id` | text | ID local (gerado em `Date.now()` no cliente) |

### `transactions`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | uuid | PK |
| `user_id` | text | ID do usuário |
| `type` | text | `activation` \| `night` \| `reservation` \| `withdrawal` |
| `reference_id` | text | ID da ativação/reserva relacionada |
| `amount` | numeric(10,2) | Valor ≥ 0 |
| `status` | text | `pending` \| `approved` \| `failed` \| `refunded` \| `cancelled` \| `in_process` \| `rejected` |
| `payment_method` | text | Método de pagamento |
| `gateway` | text | Padrão: `'mercadopago'` |
| `gateway_tx_id` | text UNIQUE | ID da transação no Mercado Pago |
| `gateway_order_id` | text | Order ID do MP |
| `external_reference` | text | Referência externa |
| `gateway_payload` | jsonb | Payload bruto do MP (**nunca exposto ao frontend**) |
| `pix_qr_code` | text | QR Code PIX (base64 imagem) |
| `pix_copy_paste` | text | Código PIX copia-e-cola |
| `pix_expires_at` | timestamptz | Expiração do PIX |
| `paid_at` | timestamptz | Timestamp do pagamento confirmado |
| `created_at` | timestamptz | Criação |
| `updated_at` | timestamptz | Atualização |

### `earnings`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | uuid | PK |
| `promoter_id` | text | ID do promoter |
| `activation_id` | text | ID da ativação que gerou a comissão |
| `user_id` | text | ID do cliente que ativou |
| `bar_id` | text | ID do bar |
| `amount` | numeric | Valor da comissão |
| `reason` | text | Motivo/descrição |
| `status` | text | `'pendente'` \| `'pago'` |

### `withdrawals`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | uuid | PK |
| `promoter_id` | text | ID do promoter |
| `amount` | numeric | Valor solicitado |
| `status` | text | `'pendente'` \| `'processando'` \| `'pago'` |
| `pix_key` | text | Chave PIX do promoter no momento do saque |

### `reservations`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | uuid | PK |
| `user_id` | text | ID do cliente |
| `user_name` | text | Nome do cliente |
| `bar_id` | text | ID do bar |
| `bar_name` | text | Nome do bar |
| `benefit_date` | text | Data do benefício |
| `activation_type` | text | `advance_individual` \| `advance_night` |
| `amount` | numeric | Valor |
| `status` | text | `pending` \| `confirmed` \| `active` \| `pre_activated` \| `cancelled` \| `failed` |
| `confirmed_at` | timestamptz | Data de confirmação |

### `bar_likes`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | uuid | PK |
| `bar_id` | text | ID do bar |
| `bar_name` | text | Nome do bar |
| `user_id` | text | ID do usuário que curtiu |
| `user_name` | text | Nome do usuário |
| `user_photo` | text | URL da foto |
| `user_role` | text | `'cliente'` \| `'promoter'` |
| `bar_replied` | boolean | Se o bar respondeu |
| `bar_reply` | text | Texto da resposta do bar |
| `bar_reply_at` | timestamptz | Data da resposta |
| `liked_at` | timestamptz | Data da curtida |

### `chat_messages`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | uuid | PK |
| `sender_id` | text | ID do remetente |
| `sender_name` | text | Nome do remetente |
| `receiver_id` | text | ID do destinatário |
| `receiver_name` | text | Nome do destinatário |
| `content` | text | Texto da mensagem |
| `read` | boolean | Se foi lida |

### `user_presence`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | uuid | PK |
| `user_id` | text | ID do usuário |
| `user_name` | text | Nome |
| `user_avatar` | text | Inicial do nome |
| `user_role` | text | Role |
| `last_seen` | bigint (ms) | Timestamp do último heartbeat |
| `is_online` | boolean | Status online |
| `current_bar` | text | Nome do bar atual (se houver) |

### `reviews`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | uuid | PK |
| `bar_id` | text | ID do bar avaliado |
| `user_id` | text | ID do usuário |
| `user_name` | text | Nome do usuário |
| `rating` | integer | Nota (1–5) |
| `comment` | text | Comentário textual |

### `notifications`

Usada pela edge function `cancelar-beneficio-status` para notificar clientes. Schema [não identificado no audit — deduzido pela referência em edge-functions/README.md].

---

## 9. Row Level Security (RLS)

### Tabela `users`

| Operação | Política | Condição |
|----------|----------|----------|
| SELECT | `user_select_own` | `id = auth.uid()::text` |
| INSERT | `user_insert_own` | `id = auth.uid()::text` |
| UPDATE | `user_update_own` | `id = auth.uid()::text` |
| ALL | `admin_full_access` | `auth.jwt() ->> 'email' = 'admin@oz.com'` |

### Tabela `bars`

| Operação | Política | Condição |
|----------|----------|----------|
| SELECT | pública | qualquer usuário autenticado |
| INSERT | `bar_insert_own` | `id = auth.uid()::text` |
| UPDATE | `bar_update_own` | `id = auth.uid()::text` |
| DELETE | `bar_delete_own` | `id = auth.uid()::text` |
| ALL | `admin_full_access` | `auth.jwt() ->> 'email' = 'admin@oz.com'` |

### Tabela `activations`

| Operação | Política | Condição |
|----------|----------|----------|
| SELECT | `activation_select_own` | `user_id = auth.uid()::text` (cliente vê as suas) |
| SELECT | `activation_bar_select` | `bar_id = (SELECT bar_id FROM users WHERE id = auth.uid() AND role = 'bar')` |
| INSERT | `activation_insert_own` | `user_id = auth.uid()::text` |
| UPDATE | `activation_update_block` | `FALSE` (bloqueado — só Edge Functions com service_role) |
| ALL | `admin_full_access` | `auth.jwt() ->> 'email' = 'admin@oz.com'` |

### Tabela `transactions`

- **SELECT próprias:** usuário autenticado vê apenas as suas
- **INSERT/UPDATE/DELETE:** bloqueado — apenas Edge Functions (service_role)
- **Admin:** acesso total via JWT claim email

### Regra geral de segurança

> **Edge Functions com `service_role` bypassam completamente o RLS.** Todo dado financeiro sensível (criação de transações, atualização de status de pagamento, geração de earnings, cancelamento de ativações) passa obrigatoriamente pelas Edge Functions.

---

## 10. Estado Global da Aplicação

O objeto `OZ` em `js/app.js` é o store global da aplicação:

```js
const OZ = {
  // Usuário atual
  currentUser: null,            // objeto do banco (tabela users)
  
  // Navegação
  navigationStack: [],          // histórico de telas para goBack()
  previousScreen: null,         // tela anterior (para back específico)
  
  // Bares
  currentBar: null,             // bar sendo visualizado no detalhe
  favoriteBars: [],             // IDs de bares favoritados (localStorage oz_fav_bars)
  
  // Promoter
  _activePickPromoter: null,    // promoter que fez o pick na sessão atual
  _pickBarId: null,             // bar do pick ativo (zeramos ao mudar de bar)
  
  // Chat
  chatTarget: null,             // { id, name, avatar, photoUrl }
  chatMessages: {},             // { userId: [ msgObj ] } — apenas demo
  chatPollInterval: null,       // setInterval do chat modal
  
  // Pollers
  resultsPoller: null,          // pollBarResults — aba Resultados ao vivo
  ativadosPoller: null,         // pollAtivados — aba Ativados do dia
  explorePoller: null,          // pollBarExplore — aba Explorar (bar)
  prxExplorePoller: null,       // pollPromoterExplore — Explorar (promoter)
  
  // Calendários
  _hcal: { year, month, selectedDate },       // Home Calendar
  _cbc: { year, month, selectedDate },        // Bar Calendar (detalhe)
  _prxCal: { year, month, selectedDate },     // Promoter Explore Calendar
  schedCalYear, schedCalMonth, schedSelectedDate, // Calendário de agendamento do bar
  
  // Cache
  userNameCache: {},            // { userId: name }
  _ratingsCache: {},            // { barId: { avg, count } }
  allPromos: {},                // { barId: [promoObj] }
  _exploreAllBars: [],
  _exploreAllPromos: {},
  _prxExploreBars: [],
  _prxExplorePromos: {},
  _prxCalScheduled: {},         // { date: [{bar, sched}] }
  
  // Usuários online
  onlineUsers: [],
  
  // Estado de noite
  _activeNightSession: null,    // UUID da sessão de noite ativa
  
  // Cancelamento de promoção
  cancelPromoId: null,
  cancelPromoTitle: null,
  cancelPromoIsScheduled: false,
  
  // Edição de agendamento
  _bslEditApiId: null,
  _bslIsEditing: false,
  _bslActiveToday: false,       // há benefício agendado ativo hoje
  
  // Flags
  exploreReadOnly: false,       // bar está na aba explorar (sem ativar)
  
  // Snapshots para detecção de novidades
  _lastActsSnapshot: [],
  _lastPollAt: 0,
};
```

### Dados persistidos no `localStorage`

| Chave | Conteúdo |
|-------|----------|
| `oz_supabase_session` | Sessão JWT do Supabase |
| `oz_user` | Dados do usuário atual (cache) |
| `oz_fav_bars` | Array de IDs de bares favoritos |
| `oz_sched_cache_{barId}` | Cache de agendamentos do bar |
| `oz_sched_apimap_{barId}` | Mapeamento local_id → api_id |

---

## 11. Inventário Completo de Telas

Todas as telas são `<div id="screen-{nome}">` em `index.html`.

### Telas de Autenticação
| ID | Descrição | Acessa via |
|----|-----------|------------|
| `screen-welcome` | Boas-vindas com CTA Criar conta / Já tenho conta | Entrada |
| `screen-choose-register` | Seleção do tipo de cadastro | Botão "Criar minha conta" |
| `screen-login` | Login com e-mail/senha + esqueci senha | Botão "Já tenho conta" |
| `screen-register-cliente` | Formulário de cadastro do cliente | Card "Quero encontrar bares" |
| `screen-register-bar` | Formulário de cadastro do bar | Card "Sou um bar parceiro" |
| `screen-register-promoter` | Formulário de cadastro do promoter | Card "Sou promoter" |

### Telas do Cliente
| ID | Descrição |
|----|-----------|
| `screen-home` | Home — lista de bares, calendário, favoritos, agendados |
| `screen-bar-detail` | Detalhe de um bar — promoções, calendar, avaliações, chat |
| `screen-profile` | Perfil do cliente — dados, histórico, convites, favoritos, créditos |
| `screen-explore` | Explorar bares com benefício ativo agora |
| `screen-history` | Histórico de ativações e reservas |
| `screen-inbox` | Inbox de mensagens/notificações |

### Telas do Bar
| ID | Descrição |
|----|-----------|
| `screen-bar-panel` | Painel executivo — métricas, gráfico 7 dias, lista recente |
| `screen-bar-resultados` | Lista ao vivo de clientes ativados (polling 3s) |
| `screen-bar-beneficios` | Gestão de benefícios ao vivo e calendário de agendamentos |
| `screen-bar-profile` | Perfil do bar + gestão de fãs (likes) |
| `screen-bar-explorar` | Visão da plataforma — todos bares com benefício ativo |
| `screen-bar-perfil` | Edição de informações do bar (nome, foto, horário, etc.) |

### Telas do Promoter
| ID | Descrição |
|----|-----------|
| `screen-promoter-home` | Home do promoter — stats, pick ativo, ranking |
| `screen-promoter-explore` | Explorar bares — ao vivo e agendados (com ativação) |
| `screen-promoter-earnings` | Extrato de comissões e saque |
| `screen-promoter-profile` | Perfil do promoter |

### Modais Principais
| ID | Descrição |
|----|-----------|
| `modal-activate` | Ativação de benefício — PIX ou grátis |
| `modal-qr` | Exibição do QR Code PIX gerado |
| `modal-advance-activate` | Reserva antecipada de benefício agendado |
| `modal-night-checkin` | Check-in em bar adicional via Noite Toda |
| `modal-cancel-promo` | Cancelamento de benefício pelo bar (2 etapas) |
| `modal-bar-reply` | Resposta do bar ao fã (like) |
| `modal-client-edit` | Edição de perfil do cliente |
| `modal-chat` | Chat 1:1 com outro usuário |

---

## 12. Fluxos de Usuário (Cliente)

### 12.1 Cadastro
1. `screen-welcome` → "Criar minha conta" → `screen-choose-register`
2. Card "Quero encontrar bares" → `screen-register-cliente`
3. `doRegisterCliente()`:
   - Valida: nome, CPF (algoritmo completo), data de nascimento (≥18 anos), e-mail, senha (≥6 chars), confirmação
   - Verifica duplicata de CPF: `apiGet('tables/users?search=CPF')`
   - Verifica duplicata de e-mail: `apiGet('tables/users?search=EMAIL')`
   - Resolve código de referência: tenta como `referral_code` de promoter, depois como `invite_code` de cliente
   - Chama `SupaAuth.signUp(email, password, { name })`
   - Insere em `tables/users` com `id = auth.uid()`
   - Redireciona para `loginSuccess()`

### 12.2 Login
1. `screen-login` → `doLogin()`
2. `SupaAuth.signIn(email, password)`
3. Busca dados do usuário: `apiGet('tables/users/{userId}')`
4. Armazena em `localStorage.oz_user` e `OZ.currentUser`
5. `routeToHome()` → redireciona por role:
   - `cliente` → `screen-home`
   - `bar` → `screen-bar-panel`
   - `promoter` → `screen-promoter-home`

### 12.3 Ativação de Benefício
1. Usuário abre detalhe do bar (`screen-bar-detail`)
2. Clica em "Ativar" → `openActivateModal()`
3. Modal exibe: tipo de benefício, valor, botão de ação
4. Se usuário tem `free_credit` disponível → opção de usar grátis
5. Se pago:
   - Chama edge function `criar-transacao`
   - Recebe `{ pix_qr_code, pix_copy_paste, activation_id }`
   - Exibe `modal-qr` com QR Code e copia-e-cola
   - Inicia polling: `get-activation-status` a cada 3s
   - Ao receber `status=active` → fecha modal, mostra confirmação
6. Se grátis (`free_credit`):
   - `apiPost('tables/activations', { ..., type: 'free_used', amount: 0 })`
   - Confirmação imediata (sem PIX)

### 12.4 Noite Toda (R$10)
1. Usuário ativa "Noite Toda" no primeiro bar
2. Paga R$10 via PIX → status `active`
3. `night_session` UUID vincula todas as ativações subsequentes
4. Ao visitar um segundo bar:
   - Sistema detecta sessão ativa via `getActiveNightSession()`
   - Exibe `modal-night-checkin` com opção de check-in
   - Check-in é gratuito (sem novo pagamento)

### 12.5 Histórico
- `loadHistoryData()` — mescla `activations` + `reservations` do usuário
- Agrupa ativações com mesmo `night_session` como uma única "noite"
- Exibe em `screen-history`

### 12.6 Indique e Ganhe
- Cada cliente tem um `invite_code` único
- Compartilhar via WhatsApp: `shareInviteWhatsApp()` → link `oz.app/convite/{code}`
- Quando amigo se cadastra com o código e faz primeira ativação → invitador ganha 1 `free_credit`

---

## 13. Fluxos do Bar

### 13.1 Cadastro e Aprovação
1. `screen-register-bar` → `doRegisterBar()`
2. Valida: nome do bar, CNPJ, responsável, gênero, e-mail, senha
3. `SupaAuth.signUp()` → insere em `users` com `role='bar'` e `approval_status='pending'`
4. Insere também em `bars` com `active=false`
5. Bar fica bloqueado até aprovação pelo admin
6. Admin acessa `admin.html` → aprova → `approval_status='approved'`, `active=true`

### 13.2 Publicar Benefício ao Vivo
1. `screen-bar-beneficios` → aba "Ao Vivo"
2. Preenche título, descrição, horário início, evento (opcional), limite (opcional)
3. `createPromotion()`:
   - Verifica se já tem benefício ativo (guard: apenas 1 por vez)
   - Calcula `expiry_at = próximo 06:00`
   - `apiPost('tables/promotions', { bar_id, title, ... })`
4. Bar aparece na home dos clientes com badge "AO VIVO"

### 13.3 Agendar Benefício
1. Aba "Calendário" → seleciona data futura → formulário
2. `schedulePromotion()`:
   - Cria em `tables/scheduled_benefits`
   - Cache local em `localStorage.oz_sched_cache_{barId}`
3. Clientes veem no calendário da home (aba "Agendados")

### 13.4 Cancelar Benefício
1. `openCancelPromoModal()` → modal com campo de motivo (obrigatório)
2. `cancelPromotion()`:
   - Para benefício ao vivo: `apiPatch('tables/promotions/{id}', { active: false })`
   - Para agendado: `apiPatch('tables/scheduled_benefits/{id}', { active: false })`
   - Chama edge function `cancelar-beneficio-status`
   - Edge function: cancela ativações, cria `free_credits`, envia notificações
3. Promoters com pick neste bar têm `promoter_pick` limpado

### 13.5 Lista ao Vivo (Resultados)
- `screen-bar-resultados` → `startResultsPoller()` → polling a cada **3 segundos**
- Fonte: `activations` (hoje) + `reservations` (status: confirmed/active/pre_activated)
- Deduplicação por `user_id` (ativação real prevalece sobre reserva)
- Filtros de status: exclui `cancelled`, `failed`, `pending_payment`, `pending`
- Toast instantâneo ao detectar nova ativação

### 13.6 Cancelar Entrada Individual
- Botão "✕" no item da lista → confirmação em 2 cliques (4s timeout)
- `cancelBarActivation(actId, userId, userName)`:
  - Chama edge function `cancelar-ativacao`
  - Edge function: `status='cancelled'` + cria `free_credit` para cliente

### 13.7 Aba Ativados do Dia
- `screen-bar-panel` → aba "Ativados" → `startAtivadosPoller()` → polling a cada **5 segundos**
- Mesma lógica de mesclagem ativações + reservas da lista ao vivo

### 13.8 Explorar (visão da plataforma)
- `screen-bar-explorar` → `startExplorePoller()` → polling a cada **15 segundos**
- Lista todos os bares com benefício ativo agora ou agendado para hoje
- Bar pode ver perfil de outros bares (modo somente leitura — `OZ.exploreReadOnly = true`)

### 13.9 Editar Perfil do Bar
- `screen-bar-perfil` → `loadBarTabInfo()` → preenche formulário
- `saveBarInfo()` → `apiPatch('tables/bars/{barId}', { ... })`

### 13.10 Galeria de Fotos
- Campo `gallery` (array jsonb) na tabela `bars`
- `renderBarGalleryGrid(gallery)` — renderiza grid de fotos

---

## 14. Fluxos do Promoter

### 14.1 Cadastro e Aprovação
1. `screen-register-promoter` → `doRegisterPromoter()`
2. Valida: nome, CPF, tipo de atuação, região, Instagram (opcional), e-mail, senha
3. Gera `referral_code` único (baseado em nome + timestamp)
4. `SupaAuth.signUp()` → insere em `users` com `role='promoter'` e `approval_status='pending'`
5. Aguarda aprovação pelo admin

### 14.2 Pick de Bar (Sistema de Comissão)
1. Promoter acessa `screen-promoter-explore` → escolhe um bar
2. Clica em "Fazer Pick" → `OZ._activePickPromoter` e `OZ._pickBarId` são setados
3. Quando cliente ativa benefício via link/card do promoter:
   - `_findPickPromoter()` detecta o pick ativo
   - `processPickCommission(activationId)` chama edge function `split-pick-commission`
4. Comissão gerada em `earnings`; `balance` do promoter é incrementado

**Reset do pick:** ao trocar de bar (`openBarDetail()` com bar diferente do pick), `OZ._pickBarId` é zerado.

### 14.3 Explorar (Promoter)
- `screen-promoter-explore` → duas abas:
  - **"Ao Vivo":** `pollPromoterExplore()` a cada 15s — bares com benefício agora
  - **"Benefícios Agendados":** calendário `prxCal` — datas futuras com agendamentos
- Cards com botão "Ativar benefício" → abre direto no modal de ativação

### 14.4 Calendário de Agendados (Promoter)
- `prxCalInit()` → `prxCalLoadScheduled()` → `prxCalRender()`
- Datas futuras com bolinhas = têm benefício agendado
- Clique na data → lista de bares agendados para aquele dia
- Botão "Ativar por antecipação" → `openAdvanceActivateModal(sched, bar)`

### 14.5 Comissões e Saque
- `screen-promoter-earnings` → lista de registros de `earnings`
- Saldo total em `OZ.currentUser.balance`
- Botão "Solicitar saque" → chama edge function `sacar-comissao`
- Admin processa pagamento → `withdrawal.status = 'pago'`

---

## 15. Sistema de Pagamentos (Mercado Pago / PIX)

### Fluxo Completo

```
Cliente clica "Ativar"
       │
       ▼
app.js → edgeFn('criar-transacao', { ... })
       │
       ▼
Edge Function: criar-transacao
  ├── Cria registro em transactions (status=pending)
  ├── Cria registro em activations (status=pending_payment)
  ├── Chama API Mercado Pago → gera PIX
  └── Retorna { pix_qr_code, pix_copy_paste, activation_id, transaction_id }
       │
       ▼
app.js exibe modal-qr (QR Code + copia-e-cola)
       │
       ▼ (polling a cada 3s)
app.js → edgeFnGet('get-activation-status', { activation_id })
       │
       ▼ (quando status = active)
app.js fecha modal → exibe confirmação
       │
   (paralelamente)
       │
       ▼
Mercado Pago → POST /functions/v1/webhook-pagamento
  Edge Function: webhook-pagamento
  ├── Valida assinatura HMAC-SHA256
  ├── Consulta pagamento na API do MP
  ├── Se approved: UPDATE activations SET status='active'
  ├── UPDATE transactions SET status='approved', paid_at=now()
  └── Chama gerar-earning (se houver pick de promoter)
```

### Validação do Webhook
O webhook do Mercado Pago é validado com HMAC-SHA256 usando um segredo configurado nas variáveis de ambiente da Edge Function. O payload bruto jamais é exposto ao frontend (armazenado apenas no campo `gateway_payload jsonb`).

### Status de Transação
```
pending → approved (via webhook)
        → failed   (via webhook)
        → cancelled (cancelamento manual)
        → refunded  [não identificado no fluxo atual]
        → in_process
        → rejected
```

### PIX Expiração
Cada PIX tem uma `pix_expires_at` definida pelo Mercado Pago (geralmente 30 minutos). O polling para após detectar `active` ou timeout.

---

## 16. Sistema de Comissões de Promoter

### Pick Ativo
```js
OZ._activePickPromoter  // { id, name, referral_code }
OZ._pickBarId           // ID do bar do pick
```

### Funções envolvidas

```js
_findPickPromoter()         // Detecta promoter pelo referral_code na URL ou seleção manual
processPickCommission(actId) // Chama edge function split-pick-commission
splitPickCommission(...)     // Helper local (antes de chamar edge)
```

### Regras
- Pick é zerado quando o cliente muda para outro bar
- Apenas ativações com `status='active'` geram comissão
- A comissão é calculada no servidor (edge function) — o percentual não está hardcoded no frontend
- Registro em `earnings`: `{ promoter_id, activation_id, user_id, bar_id, amount, reason }`
- `users.balance` é incrementado no servidor (service_role bypassa RLS)

---

## 17. Sistema de Créditos Gratuitos

### Geração de `free_credit`

| Evento | Gerador | Destinatário |
|--------|---------|--------------|
| Amigo faz primeira ativação paga | app.js (após `loginSuccess`) | Usuário que indicou |
| Bar cancela benefício com clientes na lista | Edge fn `cancelar-beneficio-status` | Cada cliente afetado |
| Bar cancela entrada individual | Edge fn `cancelar-ativacao` | Cliente cancelado |

### Uso do Crédito
1. `openActivateModal()` verifica se há `free_credit` disponível
2. Se sim, exibe opção "Usar ativação grátis"
3. `apiPost('tables/activations', { type: 'free_used', amount: 0, status: 'active' })`
4. O `free_credit` é marcado como `status='cancelled'` (consumido)

### Painel de Créditos (Cliente)
- `loadFreeCreditsPanel()` — busca `activations` com `type IN ('free_credit', 'free_used')`
- Distingue por origem: `cancel` (compensação do bar) vs `invite` (bônus de convite)
- Exibe status: Disponível / Usado

---

## 18. Sistema de Sessão de Noite ("Noite Toda")

### Conceito
Por R$10, o cliente pode fazer check-in em múltiplos bares na mesma noite sem pagar novamente.

### Implementação

```js
getActiveNightSession()     // Busca sessão ativa em activations (type='night', status='active', hoje)
openNightCheckInModal()     // Exibe opção de check-in em bar adicional
```

### Fluxo
1. Cliente paga "Noite Toda" (R$10) → cria `activation` com `type='night'`, `night_session=UUID`
2. Ao abrir detalhe de outro bar → detecta sessão ativa → exibe modal de check-in
3. Check-in cria nova `activation` com `type='night_link'` ou `type='night_checkin'`, mesmo `night_session`
4. Amount do check-in = 0 (sem novo pagamento)

### Limite temporal
A sessão é válida enquanto o período da noite estiver ativo (até 06:00 do dia seguinte).

---

## 19. Sistema de Convites (Indique e Ganhe)

### `invite_code` do Cliente
- Gerado no cadastro (baseado no `id`)
- Exibido no perfil: `screen-profile` → aba convites

### `referral_code` do Promoter
- Gerado em `doRegisterPromoter()` — formato único baseado no nome + timestamp
- Usado para atribuição de pick

### Resolução no Cadastro
`doRegisterCliente()` tenta resolver o código informado:
1. Busca como `referral_code` de promoter → vincula como pick do promoter
2. Se não encontrar → busca como `invite_code` de cliente → vincula como convite

### Recompensa
Quando invitado faz **primeira** ativação paga → invitador ganha 1 ativação grátis (`free_credit`).

---

## 20. Pollers em Tempo Real

| Poller | Intervalo | Quando Ativo | Função |
|--------|-----------|-------------|--------|
| PIX Status | 3s | Modal QR aberto | `get-activation-status` |
| Resultados ao vivo (bar) | 3s | Aba Resultados aberta | `pollBarResults()` |
| Ativados do dia (bar) | 5s | Aba Ativados aberta | `pollAtivados()` |
| Explorar (bar) | 15s | Aba Explorar aberta | `pollBarExplore()` |
| Explorar (promoter) | 15s | Tela Explorar aberta | `pollPromoterExplore()` |
| Chat | 3s | Modal Chat aberto | `loadChatMessages()` |

### Gestão de pollers
Cada poller tem funções `start*` e `stop*`. Ao trocar de aba ou fechar modal, o poller é parado (`clearInterval`).

### `_todayStr()` — Regra do dia
```js
function _todayStr() {
  const now = new Date();
  // Antes das 06h pertence à noite anterior
  if (now.getHours() < 6) now.setDate(now.getDate() - 1);
  return localDateStr(now);  // YYYY-MM-DD
}
```

---

## 21. Chat e Presença Online

### Chat 1:1
- Tabela: `chat_messages`
- Filtra mensagens onde `(sender_id = eu AND receiver_id = outro) OR vice-versa`
- Polling a cada 3s enquanto modal aberto
- Demo: mensagens armazenadas apenas em `OZ.chatMessages[userId]` (sem persistência)

### Presença Online
- Tabela: `user_presence`
- `updatePresence()` — atualiza `last_seen` e `is_online=true`
- `markPresenceOffline()` — define `is_online=false` ao sair
- Considerado "online": `is_online=true` E `last_seen < 3 minutos atrás`
- Exibido na tela de perfil do cliente (seção retrátil)

---

## 22. Sistema de Likes Bar ↔ Usuário

### Fluxo do Like
1. Usuário clica ❤️ no detalhe do bar → `toggleLikeBar()`
2. Verifica se já curtiu: `apiGet('tables/bar_likes?limit=500')` filtra por `bar_id + user_id`
3. Se não curtiu: `apiPost('tables/bar_likes', { bar_id, user_id, user_name, ... })`
4. Chat com o bar é **desbloqueado** após o like
5. Bar pode ver a curtida e responder

### Resposta do Bar
1. Aba "Fãs" no painel do bar → `loadBarLikes(filter)`
2. `openBarReplyModal()` → textarea com limite 200 chars
3. `sendBarReply()` → `apiPatch('tables/bar_likes/{id}', { bar_replied: true, bar_reply: text })`

### Chat Desbloqueado pelo Like
- Seção `bar-chat-section` no detalhe do bar
- Mostra resposta do bar se `bar_replied=true`; caso contrário, "aguardando resposta"
- `loadBarLikeState()` determina o estado ao abrir o detalhe

---

## 23. Calendários (Home, Bares, Agendamento)

### Home Calendar (HCal) — Descobrir agendados
- Estado: `OZ._hcal`
- Renderiza mini-calendário na `screen-home` (aba "Agendados")
- Filtra `scheduled_benefits` por data selecionada
- Só datas futuras são selecionáveis na aba "Agendados"

### Bar Calendar (CBC) — Detalhe do bar
- Estado: `OZ._cbc`
- Exibe benefícios agendados do bar específico
- Botões "Ativar" e "Reservar por antecipação"

### Calendário de Agendamento (Bar)
- Estado: `OZ.schedCalYear / Month / SelectedDate`
- Tela `screen-bar-beneficios` (bar logado)
- Cache local em `localStorage`
- Sincroniza com API em `bslLoadFromAPI(barId)`
- Suporta edição e remoção de agendamentos
- Remoção de benefício do **dia atual** → usa modal de cancelamento (avisa clientes)

### Calendário Promoter Explore
- Estado: `OZ._prxCal`
- Tela `screen-promoter-explore` aba "Benefícios Agendados"
- Apenas datas futuras com agendamentos são clicáveis

---

## 24. Painel Administrativo

**Arquivo:** `admin.html` + `js/admin.js`  
**Acesso:** URL `/admin.html`  
**Credenciais hardcoded:**
```js
email: 'admin@oz.com'
pass:  'oz@admin2025'
```
> ⚠️ Estas credenciais estão visíveis no código-fonte. Ver seção de Segurança.

### Autenticação Admin
1. Valida localmente contra `ADMIN_CREDENTIALS`
2. Chama `SupaAuth.signIn('admin@oz.com', 'oz@admin2025')` — gera JWT com email claim
3. JWT ativa policy `admin_full_access` em todas as tabelas RLS
4. Estado persiste em `sessionStorage.oz_admin = '1'`
5. Auto-login no DOMContentLoaded se `oz_admin = '1'`

### Seções do Admin

| Seção | Função | Dados |
|-------|--------|-------|
| **Balanço** | KPIs financeiros gerais | `users`, `bars`, `activations`, `earnings`, `withdrawals` |
| **Approvals** | Aprovar/rejeitar bars e promoters | `users` |
| **Clientes** | Lista de clientes com ativações | `users`, `activations`, `earnings` |
| **Bares** | Lista de bares com métricas | `bars`, `activations` |
| **Promoters** | Lista de promoters com comissões | `users`, `earnings` |
| **Ativações** | Histórico completo de ativações | `activations` |
| **Reviews** | Avaliações negativas (≤ 2 estrelas) | `reviews` |
| **Benefícios** | [nome identificado mas detalhes não auditados] | `promotions`, `scheduled_benefits` |

### `sbAdminFetchAll(table)` — Paginação Completa
Para tabelas com muitos dados (`activations`, `earnings`, `withdrawals`), o admin usa uma função própria que faz fetch com `limit=500&offset` em loop até trazer todos os registros, autenticada com JWT fresco do admin (para evitar contaminação de sessão de outros usuários).

### `_getAdminJwt()` — JWT Isolado
Função exclusiva do admin que obtém JWT direto via `POST /auth/v1/token?grant_type=password` com as credenciais fixas, com cache em memória de 60 minutos.

### Aprovação de Bar
```js
approveUser(userId, 'bar')
// → apiPatch('users/{id}', { approval_status: 'approved' })
// → apiPatch('bars/{bar_id}', { approval_status: 'approved', active: true })
```

### Rejeição
- Modal com campo de motivo obrigatório
- `approval_note` armazenado no usuário

### Reverter para Pendente
- `revertUser()` → `approval_status = 'pending'`

### Métricas do Balanço
- **Receita bruta:** ativações com `status='active'` E `status='cancelled'` (bar cancelou, OZ ficou com o dinheiro) E `amount > 0`
- **Ganho líquido:** receita bruta − total de comissões (earnings)
- **ARPU:** receita do mês anterior / clientes únicos ativos no mês anterior
- **Saldo em carteira:** `SUM(users.balance)` dos promoters

---

## 25. Tratamento de Erros

### `ozFriendlyError(err, context)` — Tradução de Erros
Função que converte erros técnicos em mensagens "brand voice" da OZ:

```js
// Exemplos de mensagens geradas:
"Sem conexão. Verifique seu Wi-Fi ou dados e tente novamente."
"E-mail ou senha incorretos. Tente de novo."
"Esse CPF já está cadastrado na OZ."
"Você precisa ter pelo menos 18 anos para entrar na OZ."
"Erro interno. Nossa equipe já foi notificada."
```

### Padrão de Error Handling nos Forms
```js
try {
  btn.disabled = true;
  btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Processando...';
  // ... lógica ...
  showToast('Sucesso ✅', 'success');
} catch (err) {
  showToast(ozFriendlyError(err, 'contexto'), 'error');
} finally {
  btn.disabled = false;
  btn.innerHTML = 'Texto original';
}
```

### `showToast(msg, type)` 
Exibe notificação toast temporária. `type`: `'success'` | `'error'` | `''` (neutro).

### Erros silenciados
Algumas operações não-críticas (ex: `updatePresence`, `markPresenceOffline`) têm blocos `catch` vazios para não interromper o fluxo.

---

## 26. Regras de Negócio Críticas

1. **Um benefício ao vivo por vez por bar:** Guard em `createPromotion()` — verifica `isPromoActive()` antes de criar nova promoção.

2. **`isPromoActive(promo)`:** Uma promoção está ativa se `promo.active = true` E `now() < promo.expiry_at`. Para promoções sem `expiry_at` (legado), calcula se foi criada após o último 06:00.

3. **Corte de dia às 06:00:** `_todayStr()` considera que antes das 06h, a data ainda é do dia anterior (noite anterior).

4. **Ativação grátis sempre amount=0:** Nunca processa PIX para ativações gratuitas.

5. **Cancelamento pelo bar compensa cliente:** Sempre. Seja cancelamento individual (`cancelar-ativacao`) ou de benefício inteiro (`cancelar-beneficio-status`).

6. **Tipo de ativação na lista ao vivo:** Reservas (`reservations`) são convertidas para o formato de ativação para exibição. Reserva nunca aparece se já houver ativação real do mesmo `user_id`.

7. **Pick de promoter é por bar:** Ao trocar de bar, o pick é zerado. Comissão só é gerada para ativações no bar do pick.

8. **Bar não aprovado não publica benefícios:** Guard em `createPromotion()` e `schedulePromotion()`.

9. **Admin bypassa RLS:** O JWT com `email = 'admin@oz.com'` tem acesso total a todas as tabelas.

10. **Deduplicação na lista ao vivo:** Por `user_id` — ativação real prevalece sobre reserva; ativação não-cancelada prevalece sobre cancelada.

11. **Promoções ao vivo têm prioridade sobre agendadas:** Nas telas Explorar (bar e promoter), se um bar tem promoção ao vivo E agendamento para hoje, apenas a ao vivo é exibida no promoMap.

12. **Dados Demo nunca vão à API:** Verificação `if (userId.startsWith('demo-'))` impede qualquer operação de escrita no banco para usuários demo.

---

## 27. Segurança — Pontos de Atenção

### ⚠️ Credenciais hardcoded

| Item | Localização | Risco |
|------|-------------|-------|
| `SUPA_ANON` (chave pública) | `js/supabase-auth.js`, `js/app.js`, `js/admin.js` | Baixo — é a chave anon, projetada para ser pública |
| `ADMIN_CREDENTIALS` (email + senha admin) | `js/admin.js` | **Alto** — qualquer pessoa pode ler no DevTools |
| URL do Supabase | Todos os JS | Baixo — informação pública para clientes |

### ⚠️ Admin sem autenticação real no frontend
O painel admin verifica as credenciais localmente (`u !== ADMIN_CREDENTIALS.email`) antes de chamar o Supabase. Um atacante que modifique o JS local pode bypass essa verificação. A segurança real está no JWT do Supabase — o RLS `admin_full_access` exige `auth.jwt() ->> 'email' = 'admin@oz.com'`. Portanto, **o banco em si é seguro**, mas o painel pode ser acessado visualmente sem autenticação real.

### ✅ Proteções implementadas
- Webhook MP validado com HMAC-SHA256 no servidor
- `gateway_payload` nunca exposto ao frontend
- Todas as operações financeiras passam por Edge Functions (service_role isolado)
- UPDATE de `activations` bloqueado por RLS para usuários comuns
- Validação de CPF com algoritmo completo no frontend (e deveria ser replicada no servidor)
- Validação de idade ≥18 anos

### ℹ️ Sem autenticação de webhook por IP
[Não identificado — não há filtro de IP nas Edge Functions documentadas]

---

## 28. Integrações Externas

| Serviço | Uso | Configuração |
|---------|-----|-------------|
| **Supabase Auth** | Autenticação, JWT, reset de senha | `SUPA_URL`, `SUPA_ANON` em todos os JS |
| **Supabase PostgREST** | CRUD de todas as tabelas | Idem |
| **Supabase Edge Functions** | Pagamentos, comissões, cancelamentos | `EDGE_BASE` em `app.js` |
| **Mercado Pago** | Gateway PIX | Configurado nas variáveis de ambiente das Edge Functions (não expostas ao frontend) |
| **Google Fonts** | Tipografia (Syne) | CDN em todos os HTMLs |
| **Font Awesome** | Ícones | CDN no `index.html` e outros |
| **Chart.js** | Gráficos no painel do bar e admin | CDN |

---

## 29. Modo Demo

### Usuários Demo
```js
const DEMO_USERS = {
  cliente:  { id: 'demo-cliente', name: 'Ana Demo', role: 'cliente', ... },
  promoter: { id: 'demo-promoter', name: 'Leo Demo', role: 'promoter', ... },
  bar:      { id: 'demo-bar', bar_id: 'demo-bar', role: 'bar', ... },
};
```

### `quickLogin(role)`
Faz login sem autenticação real, setando diretamente `OZ.currentUser` com dados do `DEMO_USERS`.

### Proteções do Demo
- Qualquer `userId.startsWith('demo-')` pula chamadas de escrita na API
- Dados de chat são armazenados localmente em `OZ.chatMessages`
- Promoções do bar demo usam dados estáticos (`DEMO_BAR_DATA`)

---

## 30. Checklist do Novo Desenvolvedor

### 🔧 Configuração do Ambiente

- [ ] Clonar o repositório
- [ ] Abrir `index.html` diretamente no browser (sem build step)
- [ ] Para desenvolvimento local com chamadas à API: usar Live Server ou similar (evitar `file://` por CORS)
- [ ] Confirmar que o Supabase está acessível: abrir DevTools → Network → verificar que requisições para `qyxefytxyrmvotjnhoir.supabase.co` retornam 200

### 🗄️ Entendendo o Banco

- [ ] Acessar o Supabase Dashboard: `https://app.supabase.com/project/qyxefytxyrmvotjnhoir`
- [ ] Revisar tabelas em: Table Editor → verificar as 11 tabelas documentadas
- [ ] Verificar RLS em: Authentication → Policies
- [ ] Verificar Edge Functions em: Edge Functions → confirmar as 12 funções
- [ ] Verificar variáveis de ambiente das Edge Functions (MP credentials, HMAC secret)
- [ ] Executar SQL de verificação de enums se houver erros de tipo: `edge-functions/sql/fix-activations-enums.sql`

### 👤 Entendendo os Usuários

- [ ] Testar login demo: abrir `index.html`, usar `quickLogin('cliente')` no console
- [ ] Criar conta de cliente real via `screen-register-cliente`
- [ ] Criar conta de bar real → aprovar no painel admin (`admin.html`)
- [ ] Criar conta de promoter real → aprovar no admin
- [ ] Entender o campo `approval_status` — bar e promoter ficam bloqueados até aprovação

### 🏪 Entendendo os Bares

- [ ] Logar como bar → explorar `screen-bar-panel` (métricas)
- [ ] Publicar um benefício ao vivo → verificar que aparece na home do cliente
- [ ] Agendar um benefício para amanhã → verificar no calendário da home
- [ ] Cancelar o benefício → verificar que `cancelar-beneficio-status` é chamada
- [ ] Verificar aba "Ativados do dia" enquanto cliente ativa

### 💳 Entendendo os Pagamentos

- [ ] Testar ativação com conta de cliente (ambiente de teste Mercado Pago)
- [ ] Verificar que `activations.status = 'pending_payment'` após criação
- [ ] Verificar webhook: `webhook-pagamento` deve ser acessível publicamente
- [ ] Confirmar variável `MERCADOPAGO_WEBHOOK_SECRET` nas Edge Functions
- [ ] Verificar que `status → 'active'` após pagamento confirmado
- [ ] Testar polling: QR Modal deve atualizar automaticamente após confirmação

### 💰 Entendendo Promoters

- [ ] Logar como promoter → escolher um bar como "pick"
- [ ] Logar como cliente → ativar benefício no mesmo bar
- [ ] Verificar que `earnings` foi criado para o promoter
- [ ] Verificar que `users.balance` foi incrementado

### ⏱️ Entendendo os Pollers

- [ ] Abrir `screen-bar-resultados` como bar → verificar requisições no DevTools a cada 3s
- [ ] Confirmar que poller para ao fechar a tela (`stopResultsPoller()`)
- [ ] Verificar que múltiplos pollers não se acumulam (cada `start*` chama `stop*` antes)

### 🖥️ Telas e Navegação

- [ ] Mapear o fluxo completo de um cliente: welcome → cadastro → home → bar → ativação → histórico
- [ ] Mapear o fluxo do bar: cadastro → aprovação → painel → publicar benefício → lista ao vivo
- [ ] Mapear o fluxo do promoter: cadastro → aprovação → explorar → pick → comissão
- [ ] Testar `goBack()` em múltiplas telas — verificar `OZ.navigationStack`
- [ ] Verificar `screen-choose-register` — os 3 cards devem navegar corretamente

### 🔐 Segurança (ações prioritárias)

- [ ] **URGENTE:** Mover credenciais de admin (`admin@oz.com` / `oz@admin2025`) para variáveis de ambiente ou trocar para autenticação com token de serviço
- [ ] Considerar implementar rate limiting nas Edge Functions públicas (criação de PIX)
- [ ] Revisar se o webhook do MP tem autenticação por IP ou apenas por HMAC
- [ ] Avaliar se `gateway_payload` está realmente isolado — confirmar que nenhum endpoint expõe este campo

### 📱 Verificações Visuais

- [ ] Testar em viewport mobile (390px) — o app é projetado mobile-first
- [ ] Verificar que o logo tem glow magenta via `filter: drop-shadow` (não `box-shadow`)
- [ ] Verificar que a welcome screen tem a foto de fundo escurecida (`oz-bg-night.jpg`)
- [ ] Confirmar que a fonte Syne está sendo carregada em TODOS os três HTMLs
- [ ] Confirmar que botões primários são `#B4FF00` (lime) com texto preto

### 📄 Arquivos Críticos (não modificar sem entender)

| Arquivo | Por quê é crítico |
|---------|------------------|
| `js/supabase-auth.js` | Toda a autenticação passa por aqui |
| `js/app.js` linhas 136–369 | Helpers de API — mudança quebra todas as chamadas |
| `edge-functions/sql/rls-*.sql` | Define permissões do banco — erro aqui expõe dados |
| `css/theme.css` variáveis `:root` | Design system inteiro depende destas vars |

---

*Documentação gerada em Agosto 2026 com base em auditoria completa do código-fonte.*  
*Arquivos auditados: `index.html`, `admin.html`, `reset-password.html`, `js/supabase-auth.js`, `js/app.js` (completo, ~10.550 linhas), `js/admin.js` (completo), todos os SQLs em `edge-functions/sql/`, `edge-functions/README.md`.*
