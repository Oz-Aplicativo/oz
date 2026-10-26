# OZ App

> **Sua noite, suas regras.** — Plataforma de descoberta de bares e benefícios exclusivos.

---

## 🌟 Sistema de Indicações de Bares (Picks)

### Visão geral
Qualquer usuário cliente pode ver a tela **Indicações** (aba ⭐ no menu inferior). Ela exibe todos os bares que os promoters estão recomendando **naquele momento** — somente bares com benefício ativo aparecem.

### Regras de negócio
| Evento | Comissão do promoter |
|--------|---------------------|
| Cliente ativa benefício **unitário** via bar indicado | **20%** do valor = R$1,00 |
| Cliente ativa **Noite Toda** via bar indicado | **10%** do valor = R$1,00 |
| Ativação grátis (free_credit) | Não comissiona |

### Ciclo de vida da indicação
1. **Promoter escolhe bar** → somente bares com benefício ativo aparecem no modal.
2. **Indicação fica visível** na tela de Indicações para todos os clientes.
3. **Benefício encerra às 06h** → indicação some automaticamente (cliente e promoter).
4. **Bar cancela manualmente** → indicação removida imediatamente de todos os promoters que indicavam aquele bar.

### Para o Promoter (perfil)
- Seção **Minha Indicação** mostra o bar escolhido, benefício ativo, e os ganhos acumulados por aquele bar.
- Banner de comissão: **Unitário 20% (R$1)** e **Noite Toda 10% (R$1)**.

### Para o Cliente (perfil)
- Card **"X indica — AO VIVO"** aparece automaticamente quando o promoter vinculado (referred_by) tem uma indicação ativa.
- Botão **"Ativar via indicação"** leva direto ao modal de ativação do bar.

### Para todos os usuários (tela Indicações)
- Header com contador **"N ao vivo"** piscando em vermelho.
- Banner informativo: preços e funcionamento.
- Filtros: 🔴 Ao vivo / 🎯 Unitário / 🌙 Noite Toda.
- Cards com: cover do bar, badge AO VIVO, nome do promoter, comissão, info do bar, benefício ativo com preço, botões Ver bar e Ativar via indicação.

---

## 📊 Pitch Deck para Investidores (`pitch-deck.html`)

Arquivo separado do app principal. Acesso via senha + aceitação de NDA.

### Acesso
- URL: `/pitch-deck.html`
- **Senha**: `oz2025inv`
- Requer: nome completo + aceite NDA + senha
- Sessão mantida em `sessionStorage` (`oz_pitch`)

### Estrutura — 14 slides
| # | Slide | Conteúdo |
|---|-------|---------|
| 01 | Proposta de Valor | Ecossistema OZ, pay-per-activation, 3 perfis |
| 02 | O Problema | Dores de cliente, bar e promoter com pain meters visuais |
| 03 | A Solução | Cards de diferencial, network effect diagram |
| 04 | Diferenciais | 5 diferenciais únicos vs mercado |
| 05 | Como Funciona | Fluxo de 5 passos de ativação |
| 06 | Tração & Métricas | **MVP: Pinheiros + Vila Madalena**, 400+ bares, `chart-mvp` |
| 07 | Modelo de Receita | Revenue flow, tabela de fontes, `chart-revenue` |
| 08 | Mercado & TAM | R$150B TAM, R$18B SAM, R$320M SOM, `chart-tam` |
| 09 | Competidores | OZ vs Sympla vs iFood vs Instagram, `chart-radar` |
| 10 | Projeções | Dual-axis growth line, break-even mês 8, `chart-growth` |
| 11 | Roadmap | Timeline 4 fases, `chart-roadmap` |
| 12 | Captação Seed 🔒 | **R$1,5M · R$7,5M valuation · 20% equity · 24M runway**, `chart-allocation` |
| 13 | Equipe 🔒 | Time fundador |
| 14 | Contato 🔒 | Next steps, CTA investidor |

### Gráficos Chart.js (7 total)
| Canvas ID | Slide | Tipo | Dados |
|-----------|-------|------|-------|
| `chart-mvp` | s06 | Bar agrupado | Bares/Promoters/Ativações — 3 meses MVP |
| `chart-revenue` | s07 | Donut | Composição da receita (4 fontes) |
| `chart-tam` | s08 | Bar horizontal (log) | TAM R$150B / SAM R$18B / SOM R$320M |
| `chart-radar` | s09 | Radar | OZ vs Sympla vs iFood vs Instagram — 6 atributos |
| `chart-growth` | s10 | Line dual-axis | Ativações/mês + Receita OZ/mês (12 meses) |
| `chart-roadmap` | s11 | Bar agrupado (log) | Bares + Promoters por fase (4 fases) |
| `chart-allocation` | s12 | Donut | Alocação do capital Seed (5 destinos) |

### Arquivos
- `pitch-deck.html` — HTML completo (14 slides + login NDA)
- `css/pitch.css` — Dark theme premium, todos os componentes pitch
- `js/pitch.js` — Login/nav/keyboard + Chart.js initialization (7 gráficos)
- `images/oz-logo.png` — Logo OZ (usado em login card e sidebar)

---

## 🎯 Visão geral

Aplicação web progressiva (PWA-style) com três perfis de usuário:

| Perfil | Acesso | Função principal |
|--------|--------|-----------------|
| **Cliente** | `/` → Entrar | Descobrir bares, ativar benefícios, avaliar |
| **Bar** | `/` → Criar conta como Bar | Publicar benefícios, gerenciar perfil e galeria |
| **Promoter** | `/` → Criar conta como Promoter | Indicar clientes, acompanhar ganhos |

---

## ✅ Funcionalidades implementadas

### Correção de bug crítico — fuso horário local vs UTC
- **Problema**: `nightDateKey()` e `nightDateKeyFromTs()` usavam `toISOString().slice(0,10)` que retorna data em **UTC**. No Brasil (BRT = UTC-3), isso fazia a virada acontecer às **03:00 BRT** em vez de **06:00 BRT**, bloqueando ativações incorretamente após as 03h.
- **Correção**: criada função `localDateStr(d)` que usa `getFullYear/Month/Date` (hora local). Todas as comparações de data agora usam hora local do dispositivo.
- **Impacto**: ativações do dia anterior nunca mais bloqueiam o cliente no dia seguinte após as 06h locais.

### Créditos grátis — regras
- Créditos grátis (`free_credit`) são concedidos por indicação ou compensação de cancelamento de bar.
- **Só podem ser usados para Unitário** — a Noite Toda sempre custa R$10.
- O banner no modal exibe o saldo e deixa claro: "Válido apenas para a ativação **Unitária**. A Noite Toda sempre custa R$10."
- `hasFree = freeCreditsAvailable > 0 && type === 'individual'` — garantido em `selectBenefit` e `confirmActivation`.

### Expiração diária às 06h00
- **`getExpiryTime()`**: calcula o próximo 06h00 (hoje ou amanhã) e retorna ISO string — usado em todas as ativações e promoções do bar.
- **`isPromoActive(promo)`**: corrigido para cobrir madrugada — compara com o início da "noite atual" (último 06h00 passado), evitando promos do dia anterior aparecerem na madrugada.
- **`scheduleExpiryWatcher()`**: timeout preciso até as próximas 06h00. Ao disparar: reseta cache de ativações do cliente (`usedIndividual`, `usedNight`, `usedNightBars`, `activeNightSession`), recarrega bares/promos na home, recarrega painel do bar, exibe toast "☀️ Nova rodada! Benefícios de ontem expiraram às 06h." Reagenda automaticamente.

### Tela pós-ativação (sem QR Code)
- **QR Code removido completamente** do fluxo de ativação.
- Ao ativar qualquer benefício (cliente ou promoter), exibe **tela de sucesso** com: ícone ✅ com anel pulsante verde, título "Benefício ativado!", mensagem "Aproveite o evento e curta a noite! 🎉", chip com nome do bar + tipo do benefício, badge roxo "Válido até as 06h00 de hoje", botão Fechar.
- Toast correspondente: "✅ Benefício ativado! Aproveite o evento 🎉" ou "🌙 Você está na lista! Aproveite a noite até as 6h 🎉".

### Lógica de ativação de benefícios — Link da Noite Toda (VIP)
- **Quem tem o Link da Noite Toda** acessa **todos os bares** sem pagar novamente. Ao clicar "Ativar benefício agora" em qualquer bar, o modal pula as opções e entra direto na tela de confirmação VIP.
- **Modal VIP**: coroa dourada animada, badge roxo "Link da Noite Toda", nome do bar em destaque, chip com o benefício ativo do bar, nome do cliente e botão roxo "Confirmar entrada" → registra `night_checkin` com `user_name` e `bar_id` instantaneamente → bar vê o cliente na lista de resultados em tempo real (poller 10s).
- **Bloqueio de duplicado**: se o cliente já fez check-in neste bar hoje → exibe "Você já está na lista deste bar com o Link da Noite Toda" (sem opção de reativar).
- **Cenário individual bloqueado**: benefício individual já ativado no bar → exibe "Você já ativou este benefício" com ícone ✅ centralizado.
- **`checkDailyLimit`:** Retorna `usedIndividual` (Set de bar_ids individuais), `usedNight` (boolean), e `usedNightBars` (Set de bar_ids com night_checkin hoje).
- **Lista do bar**: `pollBarResults` exibe `night_checkin` com badge "🌙 Link da Noite" e toast "chegou agora!" para o bar. Válido até 06h00.

### Reativação em novo benefício do mesmo bar no mesmo dia
- Se um bar **cancela** um benefício e **abre outro** no mesmo dia, o cliente pode ativar no novo benefício normalmente.
- `openActivateModal` compara o `created_at` da promoção ativa com o timestamp da ativação do cliente: se a ativação do cliente for **anterior** ao início da nova promoção, o bloqueio é ignorado.
- Função auxiliar `_actIsAfterPromoStart(rawActs, userId, barId, promoStartTs, kind)` encapsula essa lógica para ativações individuais e night_checkin.
- Os registros brutos da API são salvos em `OZ._todayActs._rawActs` para uso nessa verificação sem nova chamada à API.

### Ativação pelo promoter — desbloqueio de `pending_payment`
- **Problema**: `checkDailyLimit` bloqueava o promoter mesmo quando sua ativação estava apenas em `pending_payment` (pagamento ainda em processamento, não confirmado). Isso impedia o promoter de tentar ativar novamente caso o pagamento falhasse.
- **Regra especial para `role === 'promoter'`**: em `openActivateModal`, após o cálculo padrão de `alreadyUsedInd`, é aplicado um override: se o usuário é promoter, re-verifica os `_rawActs` procurando uma ativação com `status === 'active'` para o mesmo `user_id + bar_id + data`. Só bloqueia o promoter se essa ativação confirmada existir.
- **Motivo do design**: `checkDailyLimit` é conservador por razão (evita fraudes em clientes comuns). Para promoters, o fluxo de pagamento pode falhar sem que o bar tenha prestado o serviço — portanto `pending_payment` não deve ser bloqueante.
- **Campos verificados no override**: `a.status === 'active'` AND (`a.benefit_date === todayStr` OR `nightDateKeyFromTs(a.created_at) === nightDateKey()`).
- **Não afeta**: clientes comuns, night_checkin e Noite Toda — o comportamento padrão permanece inalterado.

### Lista ao vivo do bar: nomes para benefícios agendados de hoje

**Problema raiz corrigido:** `pollBarResults` usava `localDateStr(new Date())` para calcular `todayStr` e o `promoStart`, ignorando a regra das 06h. Na madrugada (ex.: 02:00 do dia 07), `localDateStr` retornava `2025-04-07`, mas o evento foi agendado para `2025-04-06` — o agendamento não era encontrado e as ativações feitas às 23:00 tinham `created_at` anterior ao `promoStart` calculado como meia-noite do dia 07.

**Correções aplicadas:**
- **`pollBarResults`**: usa `_todayStr()` (respeita regra das 06h) para encontrar o agendamento de hoje. O `promoStart` para agendados é agora `06h00 do dia do evento` (não meia-noite), garantindo que ativações feitas durante toda a noite (das 06h até as 05h59 do dia seguinte) sejam incluídas.
- **`_checkPromoLimit`** (agendados): usa `_todayStr()` e `dayStart = 06h00 do dia do evento` ao contar ativações reais.
- **`initPromoTab`**: usa `_todayStr()` para detectar se há agendamento ativo hoje.
- **`loadPicksScreen`**: usa `_todayStr()` para filtrar agendamentos de hoje na tela de indicações.
- **`loadPromoterPickCard`**: usa `_todayStr()` para encontrar o agendamento de hoje no card do promoter.

### Aparecimento imediato do cliente na lista do bar após ativação

- **`user_name` gravado em todas as ativações**: `confirmActivation` agora inclui o campo `user_name` (nome do cliente) em todos os registros criados em `tables/activations` — tanto para ativações individuais (`individual`), grátis (`free_used`) quanto Noite Toda (`night_link`). O `night_checkin` já gravava.
- **Resolução de nome sem chamada extra à API**: `pollBarResults` popula `OZ.userNameCache` diretamente do campo `user_name` do registro de ativação. Só chama `tables/users` para registros antigos (sem `user_name`). Isso elimina a latência de uma chamada de rede extra.
- **Renderização usa `a.user_name` antes do cache**: `_renderPromoList` e `renderDayList` usam `act.user_name || OZ.userNameCache[act.user_id]`, garantindo que o nome apareça imediatamente mesmo antes da resolução via API.
- **Busca na lista funciona com `user_name` diretamente**: o filtro de clientes na lista do bar usa `a.user_name || cache` para encontrar clientes mesmo antes de qualquer chamada extra.
- **Intervalo do poller reduzido de 10 s para 3 s**: `startResultsPoller` agora usa `setInterval(pollBarResults, 3_000)`. Isso garante que uma nova ativação aparece na lista do bar em **no máximo 3 segundos**, independentemente de quando o cliente ativou dentro do ciclo.
- **Schema `activations` atualizado**: adicionado campo `user_name` (text) para armazenar o nome do cliente no momento da ativação.

### Limite máximo de ativações — indisponibilidade do benefício

Quando um bar define um **limite máximo de ativações** ao publicar um benefício (campo `max_activations`), o sistema detecta automaticamente quando esse limite é atingido e exibe indisponibilidade em todos os pontos de acesso:

- **Tela Home (cards de bares)**: badge "ESGOTADO" cinza substitui "ATIVO" verde; descrição muda para "Todas as N vagas foram preenchidas. Benefício indisponível."; botão "Ver benefício" vira "Vagas esgotadas" (desabilitado); o card recebe opacidade reduzida.
- **Detalhe do bar (CTA principal)**: botão "Ativar benefício" fica desabilitado com texto "Vagas esgotadas"; card do benefício fica cinza/apagado; eyebrow mostra "VAGAS ESGOTADAS"; subtítulo informa a quantidade de vagas preenchidas.
- **Modal de ativação**: ao tentar ativar, `_checkPromoLimit` consulta a API em tempo real (dado fresco) e, se esgotado, exibe bloco "Vagas esgotadas" com ícone 🚫, contagem de vagas e hint para explorar outros bares.
- **Tela Indicações (picks)**: cards de bares esgotados recebem badge "ESGOTADO" cinza, chip de vagas em vermelho, aviso textual e botão "Vagas esgotadas" desabilitado. A comissão do promoter é substituída por "Indisponível".
- **Perfil do Promoter (Minha Indicação)**: badge "ESGOTADO" cinza aparece no card do bar indicado; o título da promo exibe aviso em vermelho.

**Funções implementadas:**
- `_checkPromoLimit(barId)` — consulta a API para verificar se o limite foi atingido (dado fresco). Suporta tanto promos ao vivo (`tables/promotions`) quanto benefícios agendados para hoje (`tables/scheduled_benefits`): conta ativações reais do dia em `tables/activations` para garantir consistência mesmo que o PATCH de `activations_count` falhe.
- `_showVagasEsgotadas(max)` — renderiza o bloco de esgotado no modal de ativação.

**Regras aplicadas igualmente a benefícios agendados para hoje:**
- **`_checkPromoLimit`** detecta esgotado para agendados consultando `tables/scheduled_benefits` + contagem real em `tables/activations`.
- **`confirmActivation`** incrementa `activations_count` em `tables/scheduled_benefits` (não em `tables/promotions`) quando `_source === 'scheduled'`.
- **`_fullDetail` na tela de detalhe do bar** agora aplica o visual de esgotado também para benefícios agendados de hoje (não apenas promos ao vivo).
- **Cards da aba "Benefícios Agendados"** mostram badge "ESGOTADO", descrição de indisponibilidade e botão desabilitado quando o limite é atingido.
- **Cards de Picks (tela Indicações)** calculam `isFull` usando `benefitObj` (= `promo || sched`), cobrindo agendados de hoje.
- **Card do promoter (Minha Indicação)** verifica esgotado também para `schedToday`, não apenas para `promo` ao vivo.
- **Schema `scheduled_benefits`** atualizado com campo `activations_count` (number) para rastrear ativações reais do dia.

**Botão "Ativar" nos Picks:**
- Benefício agendado para hoje nos picks agora exibe botão **"Ativar"** (antes era "Ver benefício agendado") e abre o modal padrão com opções unitário/noite toda — mesmo comportamento do benefício ao vivo.

### Regras de cancelamento e crédito de compensação
- **Cancelamento pelo bar**: o bar pode cancelar a entrada de um cliente (botão ✕ na lista de resultados, com confirmação em dois cliques).
- **Ao cancelar**: a ativação é marcada como `status: 'cancelled'` E é criado um registro `free_credit` para o cliente (com `origin: 'bar_cancellation'`).
- **Crédito de compensação**: o cliente recebe uma ativação grátis utilizável em **qualquer bar** como **Unitário** (nunca para Noite Toda).
- **Regra fundamental**: o cliente **só entra na lista de um bar ao ativar** — ativação cancelada remove o cliente da lista visual. Para entrar novamente, o cliente precisa ativar (pagar ou usar crédito grátis).
- **`checkDailyLimit` com cancelamentos**: ativações com `status: 'cancelled'` são ignoradas, permitindo que o cliente reative no mesmo bar no mesmo dia.
- **Deduplicação no bar** (`pollBarResults`): preferência por ativação **ativa** sobre cancelada quando ambas existem para o mesmo cliente no mesmo dia — assim, ao reativar, o cliente aparece como "ativo" na lista do bar.
- **Histórico do cliente**: item de compensação exibe "Compensação recebida — [bar] cancelou sua entrada" com badge dourado "Crédito disponível para uso". Ativações canceladas não aparecem no histórico.
- **Modal de ativação**: exibe dica clara "Você só entra na lista do bar ao **ativar**. Se o bar cancelar sua entrada, você recebe uma ativação grátis como compensação."

### Cancelamento de benefício com motivo + notificação aos clientes
- **Modal de cancelamento (2 fases)**:
  - **Fase 1 — Motivo**: o bar deve informar o motivo do cancelamento (campo obrigatório, máx 300 caracteres, validação + shake visual se vazio). Botão "Cancelar e avisar clientes".
  - **Fase 2 — Confirmação de envio**: após cancelar com sucesso, o modal muda para a tela "Mensagem enviada! Sua mensagem foi encaminhada para todos os clientes que ativaram este benefício." com botão Fechar.
- **Envio de mensagem via `chat_messages`**: para cada cliente afetado (que ativou o benefício cancelado), é criado um registro em `chat_messages` com o texto: "📢 [Bar] cancelou o benefício '[título]'. Motivo: [motivo]. Como compensação, você recebeu 1 ativação grátis para usar em qualquer lista. 🎁"
- **Uma única mensagem**: o bar só pode enviar a mensagem no momento do cancelamento. O modal fecha e exibe confirmação, sem possibilidade de reenvio.

### Inbox de notificações do cliente
- **Card "Notificações"** na aba Perfil: abre ao clicar, carrega mensagens recebidas de bares.
- **Badge de não lidas**: número em vermelho aparece no card e no botão "Perfil" da navegação inferior. Atualizado automaticamente ao entrar na aba Perfil e no login.
- **Marcação como lida**: ao abrir o inbox, todas as mensagens são automaticamente marcadas como `read: true` na API e os badges somem.
- **Visual das mensagens**: remetente em laranja (nome do bar), data/hora, tag "Nova" para mensagens não lidas, conteúdo com quebra de linha.

### Cliente
- **Tela Home — Layout Netflix**:
  - Top bar com saudação, nome do usuário, avatar com foto de perfil, botão de busca expansível
  - Tabs estilo Netflix: "Descobrir" / "Meus Bares" / **"Benefícios Agendados"**
  - **Aba Benefícios Agendados**: calendário interativo com dots indicando dias com benefícios, filtro de data, lista de cards de bares agendados (badge âmbar com data, info de benefício, botão "Ver benefício")
  - Ao selecionar uma data no calendário, filtra bares com benefícios agendados para aquele dia; para "hoje" também inclui bares com promoção ativa via `tables/promotions`
  - Cards em scroll horizontal com **poster vertical** (160×240px), gradiente cinematográfico, badge "AO VIVO" em vermelho Netflix, nome, bairro, benefício e atração musical sobrepostos na imagem
  - Seções separadas: "🔥 Bares com benefício ativo" e "🎵 Com atração ao vivo"
  - Skeleton de carregamento em formato de posters
- Detalhe do bar com:
  - **Foto de capa** (`cover_url`) no hero em tela cheia
  - **Galeria de fotos** em scroll horizontal (toque para abrir modal fullscreen com navegação por setas)
  - **Aba Sobre**: descrição, grid de infos (estilo, bairro, horário de pico, ativações), + bloco de extras (Horário de funcionamento, Endereço com link Google Maps, WhatsApp com link direto)
  - **Aba Benefícios**: cards visuais com ícone colorido por tipo, badge, descrição e metadados
  - **Aba Avaliações**: score geral, barras por estrela, lista de reviews, formulário de avaliação
  - Botões flutuantes: Voltar, Favoritar, Compartilhar (Web Share API)
  - CTA principal "Ativar benefício agora"
  - **Benefícios agendados**: seção na aba Benefícios mostrando próximos eventos com card de data, título, descrição e atração
  - **Reserva de vaga**: botão "Reservar vaga" em cada benefício agendado → modal de confirmação com contador de vagas disponíveis
  - Confirmação/cancelamento de reserva com atualização em tempo real
- Histórico de ativações
- Perfil do cliente com edição de avatar
- **Inbox de notificações**: card "Notificações" na aba Perfil com cabeçalho em destaque mostrando nome do bar (avatar circular laranja + nome em negrito), data/hora, tag "Nova" para não lidas e badge de contagem na barra de navegação
- ~~Mapa de Conquista~~ removido do app

### Lista de clientes em tempo real (painel do bar)
- **Lista por promoção ativa**: a lista só existe enquanto há uma promoção/benefício ativo. Sem promo ativa → exibe estado "Lista encerrada".
- **Sem botão de cancelar cliente**: o bar não pode mais remover clientes individualmente da lista — a lista é somente visualização.
- **Fechamento automático às 06h00**: ao bater 06h00, `_onDailyExpiry` chama `closeResultsList('expiry')`, para o poller e exibe card "Lista encerrada — A lista encerrou automaticamente às 06h00."
- **Fechamento ao cancelar evento**: ao cancelar o benefício ativo via `cancelPromotion()`, a lista fecha imediatamente via `closeResultsList('cancel')`.
- **Reabertura automática**: ao publicar novo benefício, o `startResultsPoller` retoma o polling e detecta a nova promo ativa, abrindo a lista novamente.
- **Renderização `renderResultsPromo`**: cabeçalho com nome do evento, badge "Lista aberta" pulsante, hora de fechamento, campo de busca, contador "N na lista", lista numerada com posição, nome, horário e badge de tipo (Unitário / Link da Noite / Grátis).
- **Deduplicação por promoção**: 1 entrada por `user_id` (não por dia), priorizando ativação ativa sobre cancelada.

### Bar (Painel executivo)
- **Header**: fundo com `cover_url`, logo/avatar com `photo_url`
- **Aba Painel**: KPIs (Ativações, Visitantes, Horário de pico, Benefícios ativos) + ações rápidas
- **Aba Perfil**:
  - **Foto de capa** — upload pela galeria do celular ou URL (caixa 180px)
  - **Foto de perfil / Logo** — avatar circular + botão "Escolher da galeria"
  - **Galeria** — grid 3×3 com upload múltiplo da galeria, preview e remoção individual
  - Campos: Nome, Bairro, Endereço, **Horário de funcionamento (Time Range Picker)**, Gênero, Sobre, Instagram, WhatsApp, Status
  - **Time Range Picker**: 7 botões de dia da semana + 2 dropdowns (Abre às / Fecha às) com preview e validação em tempo real
- **Aba Explorar**: layout Netflix com posters verticais em scroll horizontal, header com contador ao vivo e barra de busca integrada
- **Aba Benefícios**: publicar/agendar benefícios, ver ativo atual
  - Agendamento salvo na API (`scheduled_benefits`) + localStorage — visível para clientes
  - **Seção "Reservas por data"**: lista agrupada por data mostrando quem reservou vaga
- **Aba Resultados**: contadores de Ativações e Visitantes (sem valores monetários), histórico de ativações
- Perfil do bar com logout

### Promoter
- **Aba Explorar**: tabs internas **"Ao Vivo"** e **"Benefícios Agendados"**
  - **Aba Ao Vivo**: cards de bares com benefício ativo agora (badge vermelho "AO VIVO") + bares com agendamento para hoje (badge âmbar "HOJE"), botão "Ativar benefício" com modal de ativação
  - **Aba Benefícios Agendados**: calendário interativo (`prxCalRender`, `prxCalSelect`, `prxCalApplyFilter`) mostrando todos os dias com agendamentos em qualquer bar. Ao selecionar uma data, exibe lista de cards com info completa do benefício e botão "Ver benefício" (abre detalhe do bar diretamente na aba Benefícios/calendário)
- Home com código de indicação, saldo e métricas
- Histórico de ativações
- **Perfil com edição completa**: nome, tipo, Instagram, região, WhatsApp, Pix
  - Botão "Editar" inline na seção de visualização
  - Formulário com toggle suave (view ↔ edit)
  - Salva via `apiPatch('tables/users/{id}')` + localStorage
  - Atualiza a view sem recarregar
- **Indicação de Bar com comissão**: seção "Minha Indicação" no perfil do promoter — o promoter escolhe 1 bar da plataforma para recomendar. A cada ativação **paga** (unitária R$5 ou noite toda R$10) realizada no bar indicado, o promoter recebe automaticamente **20% do valor** (R$1,00 ou R$2,00). Ativações grátis (`free_credit`/`free_used`) não geram comissão. Não há teto de ativações. Os ganhos acumulados por este bar são exibidos na própria seção ("Ganhos por este bar" + "Ativações geradas"). No histórico de Ganhos, itens de pick_commission aparecem com badge âmbar "Indicação de bar", valor em verde e ícone de estrela. Salvo em `users.promoter_pick`; comissão registrada em `earnings` com `origin: 'pick_commission'`. Inclui busca por nome/bairro, lista com badge "AO VIVO" para bares com benefício ativo, card do bar indicado com capa, nome, bairro e promo ativa, botão Trocar e botão Remover indicação. Salvo em `users.promoter_pick`. O card aparece no perfil do cliente (com fundo dourado/âmbar) mostrando "X indica →" com foto, nome e promoção do bar; clicar abre diretamente o detalhe do bar.
- **Inbox de notificações**: seção "Notificações" no perfil do promoter que exibe mensagens recebidas (incluindo notificação de cancelamento de benefício do bar). Badge de não lidas na navegação de todas as telas do promoter. Marcação automática como lida ao abrir.
- **Chat com clientes ativados**: seção "Chat com clientes" no perfil do promoter. Exibe apenas clientes que ativaram pelo código do promoter. Conversa individual com polling a cada 5s. Aba mostra badge de mensagens não lidas.
- **Crédito grátis por cancelamento**: quando um bar cancela um benefício, além dos clientes afetados, os promoters cujo código foi usado nas ativações também recebem 1 crédito grátis e mensagem de notificação no chat.

### Chat Cliente-Promoter
- **Card "Chat com meu Promoter"** no perfil do cliente: aparece **somente após** o cliente ter feito pelo menos 1 ativação usando código de promoter.
- Exibe nome do promoter, indicador de presença online (ponto verde) e subtítulo "🟢 Online agora" ou "Toque para conversar".
- Ao clicar abre modal de chat em tela cheia com: avatar do promoter, status online, histórico de mensagens com bolhas (eu/eles), campo de input e botão de envio.
- Polling a cada 5s enquanto o modal estiver aberto.
- Mensagens do promoter são marcadas como lidas automaticamente ao abrir o chat.
- Poll do chat é limpo ao fechar o modal.

### Autenticação
- Login por e-mail/senha (tabela `users`)
- Registro de Cliente, Bar e Promoter
- Sessão salva em `localStorage` com restauração imediata ao reabrir
- ~~Splash screen~~ removida — app abre instantaneamente

---

## 📁 Estrutura de arquivos

```
index.html          — SPA completa (todas as telas)
js/
  app.js            — lógica principal (~2800 linhas)
css/
  style.css         — estilos componentes (~3600 linhas)
  theme.css         — tema visual (cores, tipografia, layout)
```

---

## 🗄️ Tabelas (RESTful Table API)

### `bars`
| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | text | ID único |
| `name` | text | Nome do bar |
| `neighborhood` | text | Bairro |
| `description` | rich_text | Descrição geral |
| `release` | rich_text | Texto "Sobre o bar" visível ao cliente |
| `instagram` | text | @ Instagram (sem @) |
| `photo_url` | text | Foto de perfil / logo |
| `cover_url` | text | **Foto de capa** (hero no cliente) |
| `gallery` | array | URLs das fotos da galeria (até 6) |
| `address` | text | Endereço completo |
| `hours` | text | Horário (ex: Seg–Sex 18:00–02:00) |
| `whatsapp` | text | WhatsApp do bar |
| `genre` | text | Gênero/estilo musical |
| `active` | bool | Visível para clientes |
| `owner_id` | text | ID do usuário dono |
| `total_activations` | number | Contador de ativações |
| `total_visitors` | number | Contador de visitantes |
| `peak_hour` | text | Horário de pico |

### `users`
Clientes, Bars e Promoters — campo `role` define o perfil.

### `promotions`
Benefícios publicados pelos bares — `bar_id`, `title`, `description`, `benefit_type`, `valid_from`, `active`.

### `activations`
Registro de cada vez que um cliente ativa um benefício.

### `scheduled_benefits`
Benefícios agendados pelo bar para datas futuras — `bar_id`, `date` (YYYY-MM-DD), `title`, `description`, `event`, `max_activations`, `reservations_count`, `active`.

### `reservations`
Reservas de clientes para benefícios agendados — `scheduled_benefit_id`, `bar_id`, `user_id`, `user_name`, `benefit_date`, `benefit_title`, `status` (pending/confirmed/cancelled/used).

### `reviews`
Avaliações dos clientes sobre os bares — `bar_id`, `user_id`, `score`, `text`.

---

## 🔗 Rotas principais (SPA)

| Rota / Tela | ID da tela |
|-------------|-----------|
| Boas-vindas | `screen-welcome` |
| Login | `screen-login` |
| Home (cliente) | `screen-home` |
| Detalhe do bar (cliente) | `screen-bar-detail` |
| Histórico (cliente) | `screen-history` |
| Perfil (cliente) | `screen-profile` |
| Painel (bar) | `screen-bar-panel` |
| Perfil (bar) | `screen-bar-profile` |
| Home (promoter) | `screen-promoter-home` |
| Histórico (promoter) | `screen-promoter-history` |
| Perfil (promoter) | `screen-promoter-profile` |

---

## 🚀 Próximos passos sugeridos

- [ ] Notificações push quando um bar publica benefício
- [ ] Filtro/busca de bares por gênero ou bairro na Home
- [ ] Mapa de localização dos bares
- [ ] Dashboard de analytics mais detalhado para o bar (gráfico por dia)
- [ ] Sistema de fidelidade: selos por número de visitas
- [ ] Preview da página do bar para o próprio bar antes de publicar
