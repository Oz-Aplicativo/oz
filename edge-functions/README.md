# OZ App — Edge Functions (Supabase)

Pasta com todas as Edge Functions necessárias para proteger os valores financeiros do app OZ.
Cada função é executada **no servidor Supabase** usando `service_role`, garantindo que nenhum
valor financeiro seja definido pelo browser.

---

## Estrutura

```
edge-functions/
├── criar-transacao/            → Cria ativação pending_payment + PIX no Mercado Pago (NOVO FLUXO)
├── webhook-pagamento/          → Recebe notificação MP, valida e ativa o benefício (status → active)
├── get-activation-status/      → Polling de status para o frontend saber quando o benefício foi ativado
├── gerar-earning/               → Distribui comissões de promoter após uma ativação
├── processar-saque/             → Valida e cria solicitação de saque (withdrawal)
├── criar-ativacao/              → ⚠️ Não usado no fluxo pago — substituído por criar-transacao
├── criar-ativacao-noite/        → ⚠️ Não usado no fluxo pago — substituído por criar-transacao
├── grant-free-credit/           → Concede crédito gratuito ao indicador (1ª ativação do indicado)
├── confirmar-reserva/           → Cria / confirma / cancela reservas antecipadas
├── usar-credito-gratis/         → Consome free_credit → free_credit_used com validação de ownership
├── cancelar-ativacao/           → Bar cancela entrada individual + cria free_credit de compensação
├── cancelar-beneficio-status/   → Cancela reservas e ativações em lote ao cancelar promoção/benefício
```

---

## Fluxo de Pagamento Seguro (novo)

```
[Frontend] Confirmar ativação
     │
     ▼
[criar-transacao]
  ├── Cria activations com status='pending_payment'  ← benefício INATIVO
  ├── Cria pagamento PIX no Mercado Pago
  └── Retorna { activation_id, pix_copy_paste, pix_qr_code }
     │
     ▼
[Frontend] Exibe QR Code / código PIX + inicia polling a cada 3s
     │
     ▼
[get-activation-status?activation_id=...]
  └── Retorna { status: 'pending_payment' | 'active' | 'cancelled' }
     │
     ▼ (usuário paga o PIX)
     │
[Mercado Pago → webhook-pagamento]
  ├── Valida assinatura HMAC-SHA256
  ├── Busca detalhes do pagamento na API do MP
  ├── Atualiza transactions.status = 'approved'
  ├── Atualiza activations.status = 'active'  ← ÚNICO ponto que ativa o benefício
  ├── Atualiza contadores do usuário
  └── Distribui comissões para promoter(s)
     │
     ▼
[Frontend] Polling detecta status='active' → exibe tela de sucesso
```

**Regras de segurança:**
- O frontend **nunca** ativa benefícios diretamente
- O `amount` (R$5 / R$10) é sempre calculado no servidor
- Apenas o `webhook-pagamento` muda `pending_payment → active`
- Idempotência no webhook: verifica `earnings.activation_id` antes de criar comissões
- Idempotência no `criar-transacao`: reutiliza PIX existente se `qr_code` já tiver `pending_payment`

---

## Como fazer deploy

### Pré-requisitos
```bash
npm install -g supabase       # ou brew install supabase/tap/supabase
supabase login
supabase link --project-ref qyxefytxyrmvotjnhoir
```

### Deploy individual
```bash
supabase functions deploy criar-transacao
supabase functions deploy webhook-pagamento
supabase functions deploy get-activation-status
supabase functions deploy gerar-earning
supabase functions deploy processar-saque
supabase functions deploy criar-ativacao
supabase functions deploy criar-ativacao-noite
supabase functions deploy grant-free-credit
supabase functions deploy confirmar-reserva
supabase functions deploy usar-credito-gratis
supabase functions deploy cancelar-ativacao
supabase functions deploy cancelar-beneficio-status
```

### Deploy de todas de uma vez
```bash
for fn in criar-transacao webhook-pagamento get-activation-status gerar-earning processar-saque criar-ativacao criar-ativacao-noite grant-free-credit confirmar-reserva usar-credito-gratis cancelar-ativacao cancelar-beneficio-status; do
  supabase functions deploy $fn
done
```

> **Nota:** As variáveis `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`
> são injetadas automaticamente pelo Supabase em produção — não é necessário configurá-las.

---

## URLs públicas (após deploy)

```
https://qyxefytxyrmvotjnhoir.supabase.co/functions/v1/criar-transacao
https://qyxefytxyrmvotjnhoir.supabase.co/functions/v1/webhook-pagamento   ← chamado pelo MP, não pelo browser
https://qyxefytxyrmvotjnhoir.supabase.co/functions/v1/get-activation-status
https://qyxefytxyrmvotjnhoir.supabase.co/functions/v1/gerar-earning
https://qyxefytxyrmvotjnhoir.supabase.co/functions/v1/processar-saque
https://qyxefytxyrmvotjnhoir.supabase.co/functions/v1/criar-ativacao
https://qyxefytxyrmvotjnhoir.supabase.co/functions/v1/criar-ativacao-noite
https://qyxefytxyrmvotjnhoir.supabase.co/functions/v1/grant-free-credit
https://qyxefytxyrmvotjnhoir.supabase.co/functions/v1/confirmar-reserva
https://qyxefytxyrmvotjnhoir.supabase.co/functions/v1/usar-credito-gratis
https://qyxefytxyrmvotjnhoir.supabase.co/functions/v1/cancelar-ativacao
https://qyxefytxyrmvotjnhoir.supabase.co/functions/v1/cancelar-beneficio-status
```

---

## Referência das funções

### 1. `criar-transacao` ⭐ (ponto de entrada do fluxo pago)
Cria ativação com `status='pending_payment'` + pagamento PIX no Mercado Pago.
O `amount` é sempre calculado no servidor. O frontend só recebe o PIX para exibir.

**POST** `/.../criar-transacao`
```json
{
  "type":          "activation",
  "bar_id":        "uuid-do-bar",
  "bar_name":      "Bar da Laje",
  "qr_code":       "QR-abc123",
  "expires_at":    "2026-04-22T09:00:00Z",
  "promoter_id":   "uuid-do-promoter",
  "pick_promoter": "uuid-do-pick"
}
```
Para `type: "night"`, adicione também:
```json
{
  "night_session":       "QR-abc123",
  "night_pick_promoter": "uuid-do-pick"
}
```
**Resposta 201:**
```json
{
  "success": true,
  "activation_id": "uuid-da-ativacao",
  "transaction": {
    "id":             "uuid-da-transacao",
    "status":         "pending",
    "amount":         5.00,
    "pix_qr_code":    "<base64>",
    "pix_copy_paste": "00020126...",
    "pix_expires_at": "2026-04-22T03:36:47Z"
  }
}
```
**Erros comuns:**
- `400` — campos obrigatórios ausentes / bar inativo
- `409` — usuário já ativou este bar hoje (individual) ou esta sessão (noite)
- `502` — erro na API do Mercado Pago

---

### 2. `get-activation-status` ⭐ (polling do frontend)
Consultada a cada 3s pelo frontend para saber se o webhook já ativou o benefício.

**GET** `/.../get-activation-status?activation_id=<uuid>`

**Resposta — aguardando:**
```json
{ "status": "pending_payment" }
```
**Resposta — aprovado:**
```json
{
  "status": "active",
  "activation": {
    "id": "...", "type": "individual", "bar_id": "...",
    "bar_name": "Bar da Laje", "expires_at": "...", "amount": 5
  }
}
```
**Resposta — falhou:**
```json
{ "status": "cancelled" }
```

---

### 3. `webhook-pagamento` ⭐ (único que ativa o benefício)
Recebe notificações do Mercado Pago. É o **único responsável** por mudar `pending_payment → active`.


Distribui comissões de promoter com base nas regras do OZ (Cenários A–G).
Deve ser chamada **após** uma ativação paga já gravada (quando o app ainda não usar `criar-ativacao`).

**POST** `/.../gerar-earning`
```json
{ "activation_id": "uuid-da-ativacao" }
```
**Resposta 201:**
```json
{ "success": true, "earnings": [ {...}, {...} ] }
```
**Erros comuns:**
- `404` — ativação não encontrada
- `400` — tipo de ativação não gera comissão (free_credit, night_checkin, cancelled)
- `409` — comissões já processadas para esta ativação

---

### 2. `processar-saque`
Valida saldo, regra de 1 saque/mês e cria o withdrawal debitando o balance.

**POST** `/.../processar-saque`
```json
{
  "amount": 50.00,
  "pix_key": "email@exemplo.com",
  "notes": "Saque mensal"
}
```
**Resposta 201:**
```json
{
  "success": true,
  "withdrawal": { "id": "...", "status": "pendente", ... },
  "balance_anterior": 75.00,
  "balance_atual": 25.00
}
```
**Erros comuns:**
- `403` — usuário não é promoter
- `400` — saldo insuficiente / valor < R$20 / pix_key ausente
- `409` — já existe saque no mês corrente

---

### 3. `criar-ativacao`
Cria ativação individual com amount R$5 **fixo no servidor** e já distribui comissões.

**POST** `/.../criar-ativacao`
```json
{
  "bar_id":        "uuid-do-bar",
  "bar_name":      "Bar da Laje",
  "qr_code":       "QR-abc123",
  "expires_at":    "2026-04-22T03:00:00Z",
  "promoter_id":   "uuid-do-promoter",
  "promoter_code": "ANA2024",
  "pick_promoter": "uuid-do-pick"
}
```
**Resposta 201:**
```json
{
  "success": true,
  "activation": { "id": "...", "amount": 5, ... },
  "earnings": [ {...} ]
}
```
**Erros comuns:**
- `404` — bar não encontrado
- `400` — bar inativo
- `409` — usuário já ativou este bar hoje

---

### 4. `criar-ativacao-noite`
Cria ativação Noite Toda com amount R$10 **fixo no servidor** (plataforma retém R$5).

**POST** `/.../criar-ativacao-noite`
```json
{
  "bar_id":               "uuid-do-bar",
  "bar_name":             "Bar da Laje",
  "qr_code":              "QR-NIGHT-abc",
  "expires_at":           "2026-04-22T06:00:00Z",
  "night_session":        "2026-04-21",
  "promoter_id":          "uuid-do-ref",
  "night_pick_promoter":  "uuid-do-pick"
}
```
**Resposta 201:**
```json
{
  "success": true,
  "activation": { "id": "...", "amount": 10, "type": "night_link", ... },
  "earnings": [ {...} ]
}
```
**Erros comuns:**
- `409` — usuário já ativou Noite Toda nesta sessão

---

### 5. `grant-free-credit`
Concede 1 crédito gratuito ao cliente indicador quando o indicado faz sua 1ª ativação.
Idempotente (verifica se já foi concedido antes de criar).

**POST** `/.../grant-free-credit`
```json
{
  "new_user_id": "uuid-do-novo-usuario",
  "inviter_id":  "uuid-do-indicador"
}
```
**Resposta 201:**
```json
{
  "success": true,
  "credit": { "id": "...", "type": "free_credit", "expires_at": "...", ... }
}
```
**Resposta 200 (sem ação):**
```json
{ "message": "...", "skipped": true }
```

---

### 6. `confirmar-reserva`
Gerencia o ciclo de vida das reservas antecipadas (criar / confirmar / cancelar).

**POST** `/.../confirmar-reserva`

**Criar reserva:**
```json
{
  "action":                "criar",
  "scheduled_benefit_id": "uuid",
  "bar_id":               "uuid",
  "bar_name":             "Bar da Laje",
  "benefit_date":         "2026-04-25T20:00:00Z",
  "benefit_title":        "Happy Hour Especial"
}
```

**Confirmar reserva:**
```json
{
  "action":         "confirmar",
  "reservation_id": "uuid"
}
```

**Cancelar reserva:**
```json
{
  "action":         "cancelar",
  "reservation_id": "uuid"
}
```

---

### 7. `usar-credito-gratis`
Consome um `free_credit` do usuário, alterando para `free_credit_used` com validação de ownership.

**POST** `/.../usar-credito-gratis`
```json
{ "credit_id": "uuid-do-credito" }
```
**Resposta 201:**
```json
{ "success": true, "credit": { "id": "...", "type": "free_credit_used", ... } }
```
**Erros comuns:**
- `403` — crédito não pertence ao usuário autenticado
- `400` — tipo não é `free_credit` / já cancelado
- `200` — já estava consumido (idempotente)

---

### 8. `cancelar-ativacao`
Bar cancela entrada individual de um cliente. Cria automaticamente o `free_credit` de compensação no servidor.

**POST** `/.../cancelar-ativacao`
```json
{
  "activation_id": "uuid",
  "user_id":       "uuid-do-cliente",
  "user_name":     "Nome do Cliente"
}
```
**Resposta 201:**
```json
{
  "success":     true,
  "activation":  { "id": "...", "status": "cancelled", ... },
  "free_credit": { "id": "...", "type": "free_credit", ... }
}
```
**Erros comuns:**
- `403` — ativação não pertence ao bar autenticado
- `400` — tipo não cancelável (`free_credit`, `night_checkin`, etc.)
- `200` — já estava cancelada (idempotente)

---

### 9. `cancelar-beneficio-status`
Cancela em lote reservas e ativações do dia quando um bar cancela uma promoção ou benefício agendado.
O servidor valida que todos os registros pertencem ao bar autenticado antes de alterar qualquer status.

**POST** `/.../cancelar-beneficio-status`
```json
{
  "bar_id":                "uuid-do-bar",
  "today":                 "2026-04-22",
  "scheduled_benefit_id": "uuid",
  "cancel_activations":   true
}
```
**Resposta 200:**
```json
{
  "success":              true,
  "reservas_canceladas":  3,
  "ativacoes_canceladas": 5,
  "erros":                []
}
```

---

### 10. `criar-transacao`
Inicia uma cobrança no **Mercado Pago** e registra a transação em `transactions` com `status='pending'`.
O `amount` é **sempre calculado no servidor** — nunca recebido do browser.

**Secret necessário:** `MP_ACCESS_TOKEN`

**POST** `/.../criar-transacao`
```json
{
  "type":           "activation",
  "reference_id":   "uuid-da-ativacao-ou-reserva",
  "payment_method": "pix",
  "token":          "(opcional — obrigatório para credit_card, gerado pelo SDK MP no browser)",
  "installments":   1
}
```
**Tipos aceitos e valores:**
| type         | Valor   |
|--------------|---------|
| `activation` | R$5,00  |
| `night`      | R$10,00 |
| `reservation`| R$5,00  |

**Resposta 201 (PIX):**
```json
{
  "success": true,
  "transaction": {
    "id":             "uuid",
    "status":         "pending",
    "amount":         5.00,
    "payment_method": "pix",
    "pix_qr_code":    "<base64 da imagem do QR Code>",
    "pix_copy_paste": "00020126...",
    "pix_expires_at": "2026-04-23T14:00:00Z"
  }
}
```
**Resposta 200 (idempotente — cobrança já existente):**
```json
{ "success": true, "transaction": { ... }, "reused": true }
```
**Erros comuns:**
- `400` — `type` inválido / `reference_id` ausente / `payment_method` inválido
- `401` — JWT ausente ou expirado
- `409` — operação já foi paga (`status=approved`)
- `502` — erro na API do Mercado Pago
- `503` — `MP_ACCESS_TOKEN` não configurado

---

### 11. `webhook-pagamento`
Recebe notificações assíncronas do **Mercado Pago** (IPN e Webhooks v2) e atualiza o status da transação.
**Não usa JWT de usuário** — suporta verificação de assinatura HMAC-SHA256 (Webhooks v2).

**Secrets necessários:** `MP_ACCESS_TOKEN` (para buscar detalhes do pagamento), `MP_WEBHOOK_SECRET` (opcional)

**Formatos aceitos:**
| Formato | Body | Identificação |
|---------|------|---------------|
| IPN (legado) | `{ "id": "...", "topic": "payment" }` | `payload.id` |
| Webhooks v2  | `{ "action": "payment.updated", "data": { "id": "..." }, "type": "payment" }` | `payload.data.id` |

**Status do Mercado Pago → status interno:**
| Status MP      | Status interno | Ação pós-evento                                      |
|----------------|----------------|------------------------------------------------------|
| `approved`     | `approved`     | Confirma ativação/reserva e gera comissões           |
| `pending`      | `pending`      | Nenhuma ação (aguarda próxima notificação)            |
| `in_process`   | `in_process`   | Nenhuma ação (em análise pelo MP)                    |
| `rejected`     | `rejected`     | Cancela ativação/reserva com `pending_payment`       |
| `cancelled`    | `cancelled`    | Cancela ativação/reserva                             |
| `refunded`     | `refunded`     | Marca como estornado (sem reverter comissões)        |
| `charged_back` | `refunded`     | Idem estorno                                         |

**Resposta sempre 200** — o Mercado Pago para de reenviar ao receber 2xx.

---

## Constantes financeiras (todas definidas no servidor)

| Constante          | Valor  | Descrição                                   |
|--------------------|--------|---------------------------------------------|
| `AMOUNT_INDIVIDUAL`| R$5    | Ativação individual                         |
| `AMOUNT_NIGHT`     | R$10   | Ativação Noite Toda                         |
| `PLATFORM_CUT`     | R$5    | Plataforma retém nas ativações noite        |
| `DISTRIBUTABLE`    | R$5    | Valor distribuível ao promoter              |
| `MAX_ACTS`         | 3      | Cap de ativações pagas que geram comissão   |
| `PICK_FLAT`        | R$1    | Comissão fixa do pick-promoter              |
| `REF_FULL`         | R$5    | Comissão ref quando não há pick diferente   |
| `REF_SPLIT`        | R$4    | Comissão ref quando há pick diferente       |
| `SAQUE_MINIMO`     | R$20   | Valor mínimo de saque                       |
| `FREE_CREDIT_EXPIRY`| 90d   | Prazo de validade do crédito gratuito       |

---

## Variáveis de ambiente (Supabase Secrets)

| Variável                    | Obrigatória           | Descrição                                                   |
|-----------------------------|-----------------------|-------------------------------------------------------------|
| `SUPABASE_URL`              | ✅ Automática          | Injetada pelo Supabase em todas as funções                  |
| `SUPABASE_ANON_KEY`         | ✅ Automática          | Injetada automaticamente                                    |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ Automática          | Injetada automaticamente                                    |
| `MP_ACCESS_TOKEN`           | Apenas para pagamentos | Access Token do Mercado Pago (`APP_USR-...` ou `TEST-...`) |
| `MP_WEBHOOK_SECRET`         | Opcional (recomendado) | Segredo para validar assinatura HMAC dos webhooks MP v2    |

**Como configurar secrets no Supabase:**
```bash
supabase secrets set MP_ACCESS_TOKEN=APP_USR-...
supabase secrets set MP_WEBHOOK_SECRET=seu-segredo-aqui
```
Ou pelo Dashboard → **Edge Functions → Secrets**.

**Como obter o MP_ACCESS_TOKEN:**
1. Dashboard Mercado Pago → Seu negócio → Credenciais
2. Copiar **Access Token** (produção) ou **Access Token** (teste/sandbox)

**Como configurar o webhook no Mercado Pago:**
1. Dashboard MP → Seu negócio → Webhooks → Adicionar webhook
2. URL: `https://qyxefytxyrmvotjnhoir.supabase.co/functions/v1/webhook-pagamento`
3. Selecionar evento: **Pagamentos** (`payment`)
4. Copiar o **Secret** gerado e salvar como `MP_WEBHOOK_SECRET` no Supabase

---

## Segurança

- Todas as funções validam o JWT do usuário via `userClient.auth.getUser()`.
- Operações no banco usam `createClient(url, SERVICE_ROLE_KEY)` — nunca exposta ao browser.
- Valores financeiros (amount, balance) são calculados **apenas no servidor**.
- Proteção contra reprocessamento: `gerar-earning` verifica `earnings.activation_id` antes de criar.
- Proteção contra duplicatas: `grant-free-credit` verifica por `qr_code ILIKE 'FREE-INVITE-{id}%'`.
- Rollback automático: `processar-saque` reverte o débito de balance se a inserção em withdrawals falhar.
- Webhook autenticado via HMAC-SHA256 (Webhooks v2 do MP) — rejeita requisições com assinatura inválida quando `MP_WEBHOOK_SECRET` está configurado.
- `criar-transacao` é idempotente — retorna transação existente se `reference_id` já tiver cobrança `pending` ou `approved`.
- `webhook-pagamento` busca dados completos do pagamento na API do MP (o webhook IPN só envia o ID).
- `external_reference` no formato `oz-{reference_id}` garante rastreabilidade mesmo sem `gateway_tx_id`.

---

## Como integrar no app.js (próxima etapa)

Substitua as chamadas diretas `apiPost('tables/activations', ...)` por chamadas às Edge Functions:

```javascript
// Antes (inseguro — browser define amount):
await apiPost('tables/activations', { ..., amount: 5 });

// Depois (seguro — servidor define amount):
const token = await SupaAuth.getAccessToken();
const res = await fetch(
  'https://qyxefytxyrmvotjnhoir.supabase.co/functions/v1/criar-ativacao',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      bar_id:    bar.id,
      bar_name:  bar.name,
      qr_code:   qrCode,
      expires_at: expiry,
      promoter_id:   OZ.currentUser.referred_by,
      pick_promoter: OZ._activePickPromoter,
    }),
  }
);
const data = await res.json();
```
