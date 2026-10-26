# 🌙 PROMPT COMPLETO — OZ APP

## VISÃO GERAL

Crie um **Progressive Web App (PWA) mobile-first** chamado **OZ** para o mercado de vida noturna urbana brasileiro. O app conecta clientes, bares parceiros e promoters, permitindo descoberta de bares, ativação de benefícios exclusivos e programa de indicações com pagamento via Pix.

---

## IDENTIDADE VISUAL — "Midnight Luxe"

### Conceito
Escuro intenso, dourado metálico, rosa quente. Sofisticação noturna para público 25–35 anos urbano.

### Paleta de Cores
```
Fundo base:       #080810  (preto profundo)
Fundo card:       #0f0f1a
Fundo elevado:    #181826
Borda sutil:      #20202e
Borda visível:    #2a2a3c
Dourado principal:#d4a843
Dourado escuro:   #c8931a
Dourado claro:    #e8b84b
Rosa principal:   #f43f72  (--rose)
Rosa escuro:      #d4265a
Texto primário:   #f0f0f8
Texto secundário: #9494b0
Texto terciário:  #5a5a78
Verde neon:       #39ff6e  (promoter)
```

### Tipografia
- **Display/Títulos:** `Plus Jakarta Sans` — pesos 700, 800
- **Corpo/UI:** `Inter` — pesos 400, 500, 600, 700

### Border Radius
- Pequeno: 8px | Médio: 14px | Grande: 20px | Pill: 999px

---

## ARQUITETURA TÉCNICA

- **HTML/CSS/JS puro** — sem frameworks
- **Layout:** Container fixo `position: fixed; left: 50%; transform: translateX(-50%)` com `max-width: 430px; width: 100%` — simula app mobile em desktop
- **Proporção:** 9:16 (padrão de app mobile)
- **Sistema de telas:** `div.screen` com `display:none` → `.screen.active` com `display:flex; flex-direction:column`
- **Persistência:** REST API via `fetch()` com endpoints `tables/{tabela}` (GET, POST, PATCH, DELETE)
- **Sessão:** `localStorage.setItem('oz_user', JSON.stringify(user))`

---

## ANIMAÇÃO DE ABERTURA (Splash Screen)

Estilo Netflix. Timeline:
1. **0.00s** — Tela preta cobre container 9:16 (`#oz-splash-wrap` / `#oz-splash`)
2. **0.15s** — Barra dourada sweep da esquerda para direita (estilo Netflix), duração 0.9s
3. **0.72s** — Logo OZ surge com `scale(0.82→1)` + fade-in, duração 0.6s
4. **1.55s** — Flash dourado radial expande e some, duração 0.4s
5. **2.10s** — Welcome screen ativa invisível por baixo
6. **2.35s** — Splash faz **dissolve**: `opacity: 0 + scale(1→1.12) + blur(0→6px)`, duração 1.1s
7. **2.55s** — Welcome sobe suavemente `translateY(18px→0) + opacity`, duração 0.9s
8. **3.50s** — Wrapper removido do DOM

**Se houver sessão salva** no localStorage: splash roda normalmente mas ao terminar navega direto para a tela do perfil do usuário (sem mostrar welcome).

### CSS da Animação
```css
/* Logo OZ — gradiente dourado metálico */
.oz-logo-text {
  font-family: Georgia, serif;
  font-size: 96px;
  font-weight: 700;
  background: linear-gradient(180deg, #f5e6a0 0%, #d4a843 18%, #c8931a 35%, #e8b84b 50%, #b8820f 65%, #d4a843 80%, #f0d070 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

@keyframes ozBarSweep {
  0%   { left: -8%; }
  100% { left: 108%; }
}
@keyframes ozLogoReveal {
  0%   { opacity: 0; transform: scale(0.82); }
  55%  { opacity: 1; transform: scale(1.06); }
  100% { opacity: 1; transform: scale(1); }
}
@keyframes ozSplashDissolve {
  0%   { opacity: 1; transform: scale(1);    filter: blur(0px); }
  40%  { opacity: 0.6; transform: scale(1.04); }
  100% { opacity: 0; transform: scale(1.12); filter: blur(6px); }
}
@keyframes ozWelcomeIn {
  0%   { opacity: 0; transform: translateY(18px) scale(0.97); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
```

---

## TELAS DO APP

### SISTEMA DE NAVEGAÇÃO
- `showScreen(id)` — ativa uma tela removendo `.active` de todas e adicionando à nova
- `switchTab(tab)` — mapa de tabs com carregamento de dados
- `goBack()` — volta à tela anterior salva em `OZ.previousScreen`
- Transição: `opacity 0.28s ease + transform 0.28s ease` (translateY 12px → 0)

---

### TELA 1 — WELCOME (`#screen-welcome`)
**Estrutura:** `page-header-simple` (logo OZ pequeno) + `form-container` centralizado

**Elementos:**
- Logo OZ grande com **borda/bordado dourado**: box `border: 2px solid rgba(212,168,67,0.55)`, `border-radius: 28px`, cantos decorativos em CSS (pseudo-elementos `::before/::after` + spans `.oz-logo-corner`), animação `ozBorderPulse` pulsando a cada 3s
- Tagline: **"Sua noite, suas regras."** — 22px, bold, branco
- Subtítulo: "Descubra os melhores bares..." — 14px, cinza
- Botão **ENTRAR** — gradiente dourado metálico, texto preto, bold, `width: 100%`
- Divisor "ou crie sua conta" com linhas horizontais
- Label "Criar conta como:" em ouro suave uppercase
- Grid 3 cards: **Cliente** (rosa), **Bar** (dourado), **Promoter** (verde neon)

**Cards de papel:**
```
Cliente  → ícone fa-user    → cor rosa   (#f43f72)
Bar      → ícone fa-glass-cheers → cor dourada (#d4a843)
Promoter → ícone fa-star    → cor verde neon (#39ff6e)
```

---

### TELA 2 — LOGIN (`#screen-login`)
- Header simples com botão voltar + logo OZ pequeno
- Título "Bem-vindo de volta 👋"
- Campos: email + senha (com toggle visibilidade olho)
- Botão submit com spinner loading
- Link "Não tem conta?" → welcome

**Lógica de login:**
1. Busca `GET tables/users?limit=500`
2. Filtra por email + password
3. Se encontrar → `loginSuccess(user)` → salva no localStorage → redireciona por `role`
4. Se não encontrar → exibe erro

---

### TELAS 3–5 — CADASTROS

#### Cliente (`#screen-register-cliente`)
Campos obrigatórios:
- Nome completo, CPF (máscara `000.000.000-00`), data de nascimento (máx: 18 anos atrás), gênero (select), telefone/WhatsApp (máscara `(00) 00000-0000`), email, senha, código de indicação (opcional), checkbox 18+

Validações: CPF real com algoritmo, idade mínima 18, email único na base, todos obrigatórios

#### Bar (`#screen-register-bar`)
Campos: nome do bar, gênero/estilo (select com 11 opções), bairro/localização, CNPJ (máscara), responsável, telefone, Instagram (@), release/descrição, email, senha, checkbox termos

#### Promoter (`#screen-register-promoter`)
Campos: nome, CPF, WhatsApp, Instagram (@), região de atuação, tipo (Produtor/DJ/PRP/Agitador Cultural), release profissional (mín 50 chars), email, senha, chave Pix

Destaque visual de ganhos:
- R$5,00 por ativação do indicado
- Máx 5 ativações por indicado = R$25 por pessoa
- Sem limite de indicados
- Resgate via Pix a qualquer momento

**Geração automática:** `referral_code` único baseado no nome + número aleatório

---

### TELA 6 — CLIENTE HOME (`#screen-home`)

**Layout flex-column:**
- `home-scroll-area` (flex:1, overflow-y:auto) contém todo o conteúdo rolável
- `client-inline-nav` fixo no rodapé (flex-shrink:0)

**Top Bar:**
- Saudação dinâmica por horário (Bom dia 🌅 / Boa tarde ☀️ / Boa noite 🌙)
- Título "Bares parceiros"
- Avatar circular com inicial do nome → clica para ir ao perfil

**Tabs:** Descobrir | Meus Bares

**Aba Descobrir:**
- Search bar com ícone lupa, placeholder "Buscar por nome ou bairro..."
- Grid de cards de bar
- Empty state quando sem resultados

**Card de Bar:**
```
┌─────────────────────────┐
│  [FOTO hero 160px]      │
│  🏷️ gênero tag          │
│  Nome do Bar            │
│  📍 Bairro              │
│  ● Aberto agora         │
│  🎁 benefício ativo     │
│  [Ver benefício →]      │
└─────────────────────────┘
```

**Aba Meus Bares:** lista de bares favoritados com mesma estrutura de card

**Nav inferior (3 botões):**
- 🧭 Descobrir | 🕐 Histórico | 👤 Perfil

**Dados demo (5 bares fake):** Bar da Laje (Pinheiros/rooftop), Neon District (Vila Madalena/balada), The Purple Room (Consolação/lounge), Rooftop 360 (Jardins/rooftop), Boteco do Zé (Sta. Cecília/boteco)

---

### TELA 7 — DETALHE DO BAR (`#screen-bar-detail`)

**Hero image** fullwidth com `background-image + gradient overlay`

**Elementos:**
- Botão voltar (←) + botão favorito (♥) sobre o hero
- Tag de gênero do bar
- Nome do bar (grande, bold)
- Localização com ícone pin
- Badge status: **● Aberto agora** (verde) / **● Fechado** (cinza)
- Link Instagram se disponível
- Card "Atração da noite" com evento do dia
- Seção de benefício com card destaque
- Botão **"Ativar agora"** → abre modal de ativação

**Lógica de favorito:** toggle salva em `localStorage['oz_fav_bars']`

---

### TELA 8 — HISTÓRICO CLIENTE (`#screen-history`)

Layout flex-column com `history-scroll-area` + nav fixo

**Banner de economia:**
- "X ativações realizadas"
- "Benefícios em Y bares"

**Lista de ativações recentes:**
```
┌─────────────────────────────┐
│ 🍺 Nome do Bar              │
│    tipo do benefício        │
│    data e hora              │
│    💰 economia: R$XX        │
└─────────────────────────────┘
```
Empty state quando sem histórico

---

### TELA 9 — PERFIL CLIENTE (`#screen-profile`)

Layout flex-column com `profile-scroll-area` + nav fixo

**Hero cover** (gradiente rosa) + avatar flutuante com foto ou inicial
- Clique no avatar → abre file picker → seleciona foto → converte base64 → exibe imediatamente → salva via `PATCH tables/users/{id}`
- Ícone 📷 dourado no canto do avatar indica "toque para alterar"

**Stats strip:** Ativações | Bares | Amigos

**Dados pessoais:** nascimento, gênero, telefone

**Seções colapsáveis (toggle):**

1. **❤️ Meus Bares** — lista de bares favoritados com foto
2. **🎁 Indique e Ganhe** — link de convite `oz.app/convite/{code}`, contadores de convidados e ativações grátis, botões WhatsApp e Copiar
3. **💬 Chat Online** — badge com contagem online, lista de usuários reais online (polling `user_presence` a cada 90s), botão iniciar conversa
4. **🗺️ Mapa de Conquista** — grid de regiões da cidade (Pinheiros, V. Madalena, Consolação, Jardins, Sta. Cecília, Centro, Itaim, Moema, Brooklin), conquista baseada em bairros dos bares ativados, badges: 🚀 Primeiro Passo (1 região), 🗺️ Explorador (3), 🌙 Nômade Noturno (5), 🏆 Lenda da Cidade (9)

**Botão Sair da conta** (vermelho suave)

---

### TELA 10 — CHAT MODAL (`#modal-chat`)

**Funcionalidade REAL** (não demo):
- Polling da API `tables/chat_messages` a cada 3 segundos
- Mensagens salvas com `sender_id`, `receiver_id`, `content`, `read`
- Usuários demo: sem chat real (mensagens locais apenas)
- Presença online: `user_presence` atualizado a cada 90s com `is_online: true`, `last_seen: timestamp`, `current_bar`
- Ao fechar modal: para o polling (`clearInterval`)
- Ao fazer logout: marca presença como `is_online: false`

**UI:**
```
┌──────────────────────────┐
│ [X]  [A] Nome   ● online │
├──────────────────────────┤
│                          │
│  [balão theirs]          │
│           [balão mine]   │
│                          │
├──────────────────────────┤
│ [input...] [➤ enviar]   │
└──────────────────────────┘
```

---

### TELAS 11–12 — PAINEL DO BAR

#### Painel Principal (`#screen-bar-panel`)
**Layout:** header fixo + tab-bar + `app-scroll-area` + nav rodapé (Painel | Conta)

**Header:** foto hero do bar (background-image), nome + gênero do bar, 4 tabs

**Tab Painel:**
- 4 métricas em grid 2x2: Ativações | Visitantes únicos | Horário de pico | Benefícios ativos
- Botões de ação rápida: Novo Benefício | Editar informações

**Tab Informações:**
- Campos editáveis: Nome, Bairro, Gênero, Release, Instagram
- Upload de foto: área clicável com placeholder câmera → file picker → preview imediato → base64 salvo via `PATCH tables/bars/{id}`
- Campo alternativo de URL
- Status Ativo/Inativo
- Botão Salvar

**Tab Benefícios:**
Lista de promoções ativas com:
- Título, tipo, validade
- Contador de ativações
- Botão Pausar/Ativar
- Botão Nova Promoção → modal

**Tab Resultados:**
- Gráfico de ativações por dia (últimos 7 dias)
- Top benefícios mais ativados
- Horário de pico calculado

**Modal Nova Promoção:**
- Tipo: Drink Grátis | Desconto % | Entrada Grátis | Happy Hour | Livre
- Título personalizado
- Validade (data/hora início e fim)
- Botão criar → `POST tables/promotions`

#### Perfil do Bar (`#screen-bar-profile`)
- Hero cover (gradiente dourado) + avatar 🍺 com foto (clicável)
- Nome, badge "Bar Parceiro", email
- Dados: estilo, localização, CNPJ, responsável
- Botão "Editar informações" → vai para tab info
- Botão Sair da conta

---

### TELAS 13–15 — PROMOTER

#### Home Promoter (`#screen-promoter-home`)
Layout flex-column com `app-scroll-area` + nav (Início | Histórico | Perfil)

**Card Saldo:**
- "Saldo disponível: R$ X,XX"
- Botão Resgatar → modal de saque

**Card Código:**
- Código de indicação gerado automaticamente (nome + random)
- Botões: 📋 Copiar | 💬 WhatsApp | 📧 Email | 📱 SMS

**Stats:** Indicados | Ativações | Total ganho

**Regras visuais:**
- R$5 por ativação
- Máx 5 ativações por indicado
- Exemplos: 10 indicados × 5 ativações = R$250; 50 indicados × 5 ativações = R$1.250

#### Histórico Promoter (`#screen-promoter-history`)
Tabs: Indicados | Ativações | Ganhos
Lista real carregada via API com dados reais

#### Perfil Promoter (`#screen-promoter-profile`)
- Hero cover (gradiente verde) + avatar ⭐ com foto (clicável, salva via API)
- Stats: Indicados | Ativações | Ganhos (calculado: R$5/ativação, máx 5/indicado)
- Dados: Tipo, Instagram, Região, WhatsApp, Pix
- Botão Sair

---

### MODAL — ATIVAÇÃO DE BENEFÍCIO

Disparado do detalhe do bar pelo cliente:

**Opções de ativação:**
- Unitário → R$5,00 (1 ativação)
- Link da Noite Toda → R$10,00 (acesso geral)

Ao confirmar:
1. Valida que usuário está logado
2. `POST tables/activations` com `user_id, bar_id, bar_name, type, amount, promoter_code, qr_code, expires_at`
3. Gera QR Code via `QRCode.js`
4. Modal QR com: nome do bar, tipo do benefício, QR image, "expira às 6h"

---

### MODAL — SAQUE PROMOTER

- Campo para chave Pix (pré-preenchido com cadastro)
- Valor mínimo R$20,00
- `POST tables/withdrawals` com `promoter_id, amount, status: 'pendente', pix_key`
- Zera saldo exibido

---

## BANCO DE DADOS (REST API)

### Tabelas e campos:

**users**
```
id, name, email, password, role (cliente|bar|promoter),
cpf, birth_date, gender, phone,
invite_code, referred_by, referral_code,
balance, activations_count, total_saved,
bar_name, bar_genre, bar_id, bar_instagram, bar_release, cnpj, responsible_name,
promoter_type, promoter_instagram, promoter_region, promoter_release, pix_key,
photo_url
```

**bars**
```
id, name, neighborhood, description, release, instagram,
benefit, featured_promo, event_tonight,
photo_url, active (bool), genre, owner_id,
total_activations, total_visitors, peak_hour
```

**activations**
```
id, user_id, bar_id, bar_name, type, amount,
qr_code, expires_at, promoter_code
```

**promotions**
```
id, bar_id, bar_name, title, description,
benefit_type, valid_from, valid_until,
active (bool), activations_count
```

**earnings**
```
id, promoter_id, promoter_code, user_id, activation_id,
amount, acts_this_user, reason, status
```

**withdrawals**
```
id, promoter_id, amount, status, pix_key, notes
```

**reviews**
```
id, bar_id, bar_name, user_id, user_name, rating, comment
```

**chat_messages**
```
id, sender_id, sender_name, receiver_id, receiver_name,
content, read (bool), created_at
```

**user_presence**
```
id, user_id, user_name, user_avatar, user_role,
is_online (bool), last_seen, current_bar
```

---

## LÓGICA DE NEGÓCIO CRÍTICA

### Login / Sessão
```javascript
// Salva sessão
localStorage.setItem('oz_user', JSON.stringify(user))

// Restaura na inicialização (após splash terminar — 3.6s)
const saved = localStorage.getItem('oz_user')
if (saved) routeToHome(JSON.parse(saved))

// Roteamento por role
cliente  → screen-home (loadBars)
bar      → screen-bar-panel (loadBarPanel)
promoter → screen-promoter-home (loadPromoterHome)
```

### Cálculo de Ganhos do Promoter
```javascript
// R$5 por ativação, máximo 5 ativações por indicado único
const actsPerUser = {}
let totalEarned = 0
acts.forEach(a => {
  if (!actsPerUser[a.user_id]) actsPerUser[a.user_id] = 0
  if (actsPerUser[a.user_id] < 5) {
    totalEarned += 5
    actsPerUser[a.user_id]++
  }
})
```

### Mapa de Conquista
```javascript
// Conquista baseada em bairros reais ativados
// Busca ativações do usuário → bares visitados → neighborhoods → match region
const CITY_REGIONS = [
  { id: 'pinheiros', name: 'Pinheiros', emoji: '🍷', keywords: ['pinheiros'] },
  { id: 'vilamadalena', name: 'V. Madalena', emoji: '🎸', keywords: ['vila madalena', 'madalena'] },
  // ... 9 regiões total
]
function matchRegion(neighborhood) {
  return CITY_REGIONS.find(r => r.keywords.some(k => neighborhood.toLowerCase().includes(k)))
}
```

### Chat Real com Polling
```javascript
// Abre chat → inicia polling 3s
OZ.chatPollInterval = setInterval(loadChatMessages, 3000)

// Fecha modal → para polling
clearInterval(OZ.chatPollInterval)

// Presença online atualizada a cada 90s
OZ.presenceInterval = setInterval(updatePresence, 90000)

// Logout → marca offline
await apiPatch(`tables/user_presence/${existing.id}`, { is_online: false })
```

### Upload de Foto
```javascript
// File → FileReader → base64 → preview imediato → salva via PATCH
reader.onload = async (e) => {
  avatarEl.style.backgroundImage = `url('${e.target.result}')`
  await apiPatch(`tables/users/${user.id}`, { photo_url: e.target.result })
}
reader.readAsDataURL(file)
```

---

## COMPONENTES DE UI REUTILIZÁVEIS

### Toast
```javascript
showToast(msg, type) // type: 'success' | 'error' | 'info' | ''
// Aparece no topo, auto-some em 3s
```

### Modais
```javascript
openModal(id)   // adiciona .open
closeModal(id)  // remove .open
closeModalOnOverlay(e) // fecha ao clicar fora
```

### Máscaras de Input
```javascript
maskCPF(input)   // 000.000.000-00
maskPhone(input) // (00) 00000-0000
maskCNPJ(input)  // 00.000.000/0000-00
```

### Validações
```javascript
validateCPF(cpf)        // algoritmo real dos dígitos verificadores
validateAge(date, 18)   // mínimo 18 anos
validateEmail(email)    // regex
```

### Seções Colapsáveis
```javascript
toggleSection(id) // mostra/oculta, rotaciona seta ▼→▲
// Ao abrir chat-section: chama loadOnlineUsers() automaticamente
```

---

## CSS ARCHITECTURE

### Sistema de Telas
```css
.screen {
  position: fixed; top: 0; bottom: 0;
  left: 50%; right: auto;
  transform: translateX(-50%) translateY(12px);
  width: 100%; max-width: 430px;
  display: none; flex-direction: column;
  opacity: 0;
  transition: opacity 0.28s ease, transform 0.28s ease;
}
.screen.active {
  display: flex; opacity: 1;
  transform: translateX(-50%) translateY(0);
}
```

### App Screen Flex (telas com nav fixo)
```css
.app-screen-flex         → display:flex; flex-direction:column; overflow:hidden
.app-scroll-area         → flex:1; overflow-y:auto
.app-bottom-nav          → flex-shrink:0; sticky no rodapé
```

### Padrão de Card
```css
background: var(--black-2);
border: 1px solid var(--black-4);
border-radius: 16px;
padding: 16px;
```

### Padrão de Botão Primário
```css
background: linear-gradient(135deg, var(--rose-dark), var(--rose));
color: white; font-weight: 700;
border-radius: var(--r-md);
padding: 14px 20px;
width: 100%;
```

### Responsive Desktop
```css
@media (min-width: 520px) {
  body { background: #050508; }
  .screen {
    width: min(430px, calc(100vh * 9/16));
    box-shadow: 0 0 80px rgba(0,0,0,0.8);
  }
}
```

---

## DADOS DEMO (sem login real)

3 usuários demo com acesso por botão (para testes):
- **cliente@demo.oz** → Lucas Lima, Cliente
- **bar@demo.oz** → Bar da Laje, Bar
- **promoter@demo.oz** → Ana Souza, Promoter (saldo R$75)

5 bares fake pré-carregados com fotos do Unsplash, benefícios, eventos e avaliações.

---

## DEPENDÊNCIAS EXTERNAS (CDN)

```html
<!-- Fontes -->
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">

<!-- Ícones -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css">

<!-- QR Code -->
<script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
```

---

## NOTAS IMPORTANTES

1. **Sem frameworks** — HTML/CSS/JS vanilla puro
2. **Mobile-first** — toda UI pensada para toque, targets mínimos de 44px
3. **Dark mode only** — sem tema claro
4. **Demo users nunca fazem chamadas reais à API** — verificado via `id.startsWith('demo-')`
5. **Foto em base64** — armazenada diretamente no campo `photo_url` da tabela users/bars
6. **Chat** — desativado para usuários demo; ativo apenas para contas reais
7. **Presença online** — janela de 3 minutos de inatividade para considerar offline
8. **Referral code** — gerado no cadastro: `nome.slice(0,3).toUpperCase() + random4digits`
9. **Senhas** — armazenadas em texto plano na API (simplificação — sem hash)
10. **Logout** — limpa localStorage + marca presença offline + para todos os intervals

---

*Prompt gerado em 18/03/2026 — OZ App v2*
