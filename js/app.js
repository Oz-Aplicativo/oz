/* ====================================================
   OZ APP — JavaScript v2
   3 perfis: Cliente · Bar · Promoter
   ==================================================== */

/* ══════════════════════════════════
   ESTADO GLOBAL
══════════════════════════════════ */
const OZ = {
  currentUser:     null,
  currentBar:      null,
  selectedBenefit: null,
  previousScreen:  'screen-home',
  favoriteBars:    JSON.parse(localStorage.getItem('oz_fav_bars') || '[]'),
  chatTarget:      null,
  chatMessages:    {},
  onlineUsers:     [],
  chatPollInterval:   null,
  presenceInterval:   null,
  // ── Pick commission state ──────────────────────────────────────────
  // _activePickPromoter: ID do promoter cujo link foi clicado na tela de indicações.
  //   null  → cliente abriu o bar diretamente (home/favoritos) → sem pick commission.
  //   string → cliente veio via link de indicação específico → SOMENTE esse promoter recebe.
  // _pickBarId: ID do bar para o qual o pick é válido.
  //   Se o cliente navegar para outro bar, o pick é descartado automaticamente.
  _activePickPromoter: null,
  _pickBarId:          null,
};

/* ══════════════════════════════════
   DEMO USERS
══════════════════════════════════ */
const DEMO_USERS = {
  cliente: {
    id: 'demo-cliente', name: 'Lucas Lima', email: 'cliente@demo.oz',
    role: 'cliente', cpf: '000.000.000-00', birth_date: '1997-06-15',
    gender: 'masculino', phone: '(11) 99999-0001',
    referral_code: null, referred_by: null,
    balance: 0, activations_count: 3, total_saved: 15,
  },
  promoter: {
    id: 'demo-promoter', name: 'Ana Souza', email: 'promoter@demo.oz',
    role: 'promoter', cpf: '111.111.111-11', phone: '(11) 99999-0002',
    promoter_type: 'prp', promoter_instagram: 'anasouza.prp',
    promoter_region: 'Vila Madalena, Pinheiros',
    promoter_release: 'PRP com 5 anos de experiência em festas na Vila Madalena.',
    referral_code: 'ANA2024', referred_by: null,
    balance: 75.00, activations_count: 0,
    pix_key: 'ana@demo.oz',
  },
  bar: {
    id: 'demo-bar', name: 'Bar da Laje', email: 'bar@demo.oz',
    role: 'bar', bar_name: 'Bar da Laje', bar_genre: 'rooftop',
    cnpj: '00.000.000/0001-00', responsible_name: 'Carlos Mendes',
    phone: '(11) 99999-0003', bar_id: 'fb1',
    balance: 0, activations_count: 0,
  },
};

/* ══════════════════════════════════
   CONSTANTES GLOBAIS
══════════════════════════════════ */
const WEEKDAY_NAMES = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
const WEEKDAY_SHORT = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

/* ══════════════════════════════════════════════════════════════
   OZ — TRADUTOR DE ERROS DE REDE (Tom de Voz OZ)
   Transforma mensagens técnicas em respostas humanas da marca.
══════════════════════════════════════════════════════════════ */
function ozFriendlyError(err) {
  const raw = (err?.message || String(err) || '').toLowerCase();

  /* Erros de conectividade / CORS / file:// */
  if (
    raw.includes('networkerror') ||
    raw.includes('network error') ||
    raw.includes('failed to fetch') ||
    raw.includes('network request failed') ||
    raw.includes('load failed') ||
    raw.includes('fetcherror') ||
    raw.includes('cors')
  ) {
    return '📡 Sem conexão com a OZ. Verifique sua internet e tenta de novo — a gente tá aqui.';
  }

  /* Timeout */
  if (raw.includes('timeout') || raw.includes('timed out') || raw.includes('aborted')) {
    return '⏱️ A OZ demorou pra responder. Tenta de novo em alguns segundos.';
  }

  /* E-mail já cadastrado */
  if (
    raw.includes('already registered') ||
    raw.includes('already been registered') ||
    raw.includes('duplicate') ||
    raw.includes('unique') ||
    raw.includes('já cadastrado')
  ) {
    return '📧 Esse e-mail já tá na OZ. Tenta fazer login ou recupera sua senha.';
  }

  /* Senha fraca / inválida */
  if (raw.includes('password') && (raw.includes('weak') || raw.includes('short'))) {
    return '🔐 Senha muito simples. Escolhe outra com pelo menos 6 caracteres.';
  }

  /* Credenciais inválidas no login */
  if (
    raw.includes('invalid login') ||
    raw.includes('invalid credentials') ||
    raw.includes('email not confirmed') ||
    raw.includes('invalid email or password')
  ) {
    return '🚫 E-mail ou senha incorretos. Confere e tenta de novo.';
  }

  /* Sessão expirada */
  if (raw.includes('jwt expired') || raw.includes('token expired') || raw.includes('session expired')) {
    return '⏰ Sua sessão expirou. Faz login de novo pra continuar curtindo.';
  }

  /* Erro genérico de servidor */
  if (raw.includes('500') || raw.includes('internal server')) {
    return '⚠️ A OZ tá com um probleminha técnico agora. Tenta em instantes.';
  }

  /* CPF/CNPJ duplicado (mensagem do Supabase) */
  if (raw.includes('cpf') && raw.includes('duplicate')) {
    return '🪪 Esse CPF já foi cadastrado na OZ. Só pode ter um cadastro por CPF.';
  }

  /* Fallback: retorna mensagem original mas com prefixo amigável */
  return err?.message || 'Algo deu errado. Tenta de novo!';
}

/* ══════════════════════════════════
   SUPABASE — CONFIG & API HELPERS
══════════════════════════════════ */
const SB_URL   = 'https://qyxefytxyrmvotjnhoir.supabase.co/rest/v1';
const SB_ANON  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5eGVmeXR4eXJtdm90am5ob2lyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3Mjk4NzQsImV4cCI6MjA5MjMwNTg3NH0.6TSq1HjRyS9D2lBGvrjLT0oTPT-QT752DgdBbHrltq8';

/* Gera headers REST atualizados com token de sessão (se disponível) */
async function sbHeaders(extra = {}) {
  const token = (typeof SupaAuth !== 'undefined')
    ? await SupaAuth.getAccessToken()
    : SB_ANON;
  return {
    'Content-Type':  'application/json',
    'apikey':         SB_ANON,
    'Authorization': `Bearer ${token}`,
    ...extra,
  };
}

/* Compatibilidade: headers estáticos (sem await) para uso síncrono legado */
const SB_HEADS = {
  'Content-Type':  'application/json',
  'apikey':         SB_ANON,
  'Authorization': `Bearer ${SB_ANON}`,
};

/*
 * Traduz path no formato legado  "tables/tabela?param=val"  ou  "tables/tabela/id"
 * para a URL Supabase correspondente, convertendo também os parâmetros de busca.
 *
 * Convenções legadas suportadas:
 *   GET  tables/tabela?limit=N&page=P&search=X&sort=col  → SELECT com paginação
 *   GET  tables/tabela/id                                → SELECT por id
 *   POST tables/tabela                                   → INSERT
 *   PATCH tables/tabela/id                               → UPDATE por id
 *   DELETE tables/tabela/id                              → DELETE por id
 */
function _sbUrl(path, method = 'GET', body = null) {
  // Remove prefixo "tables/" se presente
  const clean = path.replace(/^tables\//, '');

  // Separa segmento base dos query params legados
  const [base, qs] = clean.split('?');
  const parts      = base.split('/');
  const table      = parts[0];
  const recordId   = parts[1] || null;

  const params = new URLSearchParams();

  if (recordId) {
    // Operação em registro específico: filtra por id
    params.set('id', `eq.${recordId}`);
  } else if (qs) {
    // Traduz query params legados
    const legacy = new URLSearchParams(qs);

    // Paginação
    const limit  = parseInt(legacy.get('limit')  || '100', 10);
    const page   = parseInt(legacy.get('page')   || '1',   10);
    const offset = (page - 1) * limit;
    params.set('limit',  String(limit));
    params.set('offset', String(offset));

    // Ordenação
    const sort = legacy.get('sort');
    if (sort) params.set('order', `${sort}.desc`);

    // Busca textual livre → ilike em múltiplas colunas relevantes por tabela
    const search = legacy.get('search');
    if (search) {
      const s = search.replace(/'/g, "''");   // escapa aspas simples
      // Mapa de colunas pesquisáveis por tabela
      const searchCols = {
        users:              ['email', 'name', 'cpf', 'referral_code', 'invite_code'],
        bars:               ['name', 'neighborhood'],
        activations:        ['user_name', 'bar_name'],
        scheduled_benefits: ['bar_id', 'title', 'date'],
        earnings:           ['promoter_id', 'reason'],
        withdrawals:        ['promoter_id'],
        reviews:            ['bar_id', 'user_name'],
        reservations:       ['bar_id', 'user_id'],
        promotions:         ['bar_id', 'title'],
        chat_messages:      ['sender_id', 'receiver_id'],
        bar_likes:          ['bar_id', 'user_id'],
      };
      const cols = searchCols[table] || ['id'];
      const orFilter = cols.map(c => `${c}.ilike.*${s}*`).join(',');
      params.set('or', `(${orFilter})`);
    }
  } else if (method === 'GET') {
    // GET sem params: retorna até 500
    params.set('limit', '500');
  }

  return `${SB_URL}/${table}?${params.toString()}`;
}

/* GET — retorna { data: [], total: N } no formato legado */
async function apiGet(path) {
  const url  = _sbUrl(path, 'GET');
  const hdrs = await sbHeaders({ 'Prefer': 'count=exact' });
  const r    = await fetch(url, { headers: hdrs });
  if (!r.ok) throw new Error(`GET ${path}: ${r.status}`);
  const data  = await r.json();
  const range = r.headers.get('Content-Range') || '';
  const total = parseInt((range.split('/')[1] || '0'), 10) || (Array.isArray(data) ? data.length : 0);
  // Compatibilidade: se o path era tables/tabela/id, retorna objeto direto
  const clean = path.replace(/^tables\//, '');
  if (clean.split('?')[0].split('/').length === 2 && !clean.includes('?')) {
    return Array.isArray(data) ? (data[0] || null) : data;
  }
  return { data: Array.isArray(data) ? data : [], total };
}

// Tabelas que possuem colunas created_at / updated_at (timestamptz)
const _TABLES_WITH_TS = new Set(['transactions', 'chat_messages', 'user_presence']);

/* POST — retorna o objeto criado */
async function apiPost(path, body) {
  const clean = path.replace(/^tables\//, '').split('?')[0];
  const table = clean.split('/')[0];
  const url   = `${SB_URL}/${table}`;
  const hdrs  = await sbHeaders({ 'Prefer': 'return=representation' });
  // Só envia timestamps para tabelas que têm essas colunas
  const extraTs = _TABLES_WITH_TS.has(table)
    ? { created_at: body.created_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString() }
    : {};
  const r = await fetch(url, {
    method:  'POST',
    headers: hdrs,
    body:    JSON.stringify({ ...body, ...extraTs }),
  });
  if (!r.ok) {
    const errBody = await r.json().catch(() => ({}));
    throw new Error(`POST ${path}: ${r.status} — ${errBody?.message || errBody?.hint || JSON.stringify(errBody)}`);
  }
  const result = await r.json();
  return Array.isArray(result) ? result[0] : result;
}

/* PATCH — atualiza registro por id */
async function apiPatch(path, body) {
  const url   = _sbUrl(path, 'PATCH');
  const hdrs  = await sbHeaders({ 'Prefer': 'return=representation' });
  const clean = path.replace(/^tables\//, '').split('?')[0];
  const table = clean.split('/')[0];
  const extraTs = _TABLES_WITH_TS.has(table)
    ? { updated_at: new Date().toISOString() }
    : {};
  const r = await fetch(url, {
    method:  'PATCH',
    headers: hdrs,
    body:    JSON.stringify({ ...body, ...extraTs }),
  });
  if (!r.ok) {
    const errBody = await r.json().catch(() => ({}));
    throw new Error(`PATCH ${path}: ${r.status} — ${errBody?.message || errBody?.hint || JSON.stringify(errBody)}`);
  }
  const result = await r.json();
  return Array.isArray(result) ? result[0] : result;
}

/* DELETE — remove registro por id */
async function apiDelete(path) {
  const url  = _sbUrl(path, 'DELETE');
  const hdrs = await sbHeaders();
  const r    = await fetch(url, { method: 'DELETE', headers: hdrs });
  if (!r.ok && r.status !== 204) throw new Error(`DELETE ${path}: ${r.status}`);
}

/* ══════════════════════════════════════════════════════════════════════
   edgeFn() — helper para chamadas às Edge Functions do Supabase
   Todas as operações financeiras passam por aqui (amount nunca vem
   do browser — o servidor define o valor correto).

   @param {string} fnName  — nome da função (ex: 'criar-ativacao')
   @param {object} body    — payload sem campos financeiros (amount, balance…)
   @returns {object}       — resposta JSON da Edge Function
   @throws  {Error}        — em caso de HTTP ≥ 400
══════════════════════════════════════════════════════════════════════ */
const EDGE_BASE = 'https://qyxefytxyrmvotjnhoir.supabase.co/functions/v1';

async function edgeFn(fnName, body = {}) {
  const token = (typeof SupaAuth !== 'undefined')
    ? await SupaAuth.getAccessToken()
    : SB_ANON;

  const r = await fetch(`${EDGE_BASE}/${fnName}`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
      'apikey':         SB_ANON,
    },
    body: JSON.stringify(body),
  });

  const json = await r.json().catch(() => ({}));

  if (!r.ok) {
    // Loga detalhes completos no console para facilitar diagnóstico
    console.error(`[edgeFn] ${fnName} falhou — HTTP ${r.status}`, json);
    const msg = json?.error || json?.message || `Edge Function ${fnName} retornou ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    err.body   = json;
    throw err;
  }

  return json;
}

/* ── GET para Edge Functions (polling de status) ─────────────────────────── */
async function edgeFnGet(fnName, params = {}) {
  const token = (typeof SupaAuth !== 'undefined')
    ? await SupaAuth.getAccessToken()
    : SB_ANON;

  const qs  = new URLSearchParams(params).toString();
  const url = `${EDGE_BASE}/${fnName}${qs ? '?' + qs : ''}`;

  const r = await fetch(url, {
    method:  'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'apikey':         SB_ANON,
    },
  });

  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json?.error || `${fnName} retornou ${r.status}`);
  return json;
}
function showScreen(id, savePrev = true) {
  /* Fecha feed ao navegar */
  if (window.OZFeed) OZFeed.close();

  const active = document.querySelector('.screen.active');
  if (active && savePrev) OZ.previousScreen = active.id;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const t = document.getElementById(id);
  if (t) { t.classList.add('active'); t.scrollTop = 0; }

  /* Reseta tela de recuperação de senha ao abrir */
  if (id === 'screen-forgot-password') {
    _fpFoundUser   = null;
    _fpPassVisible = false;
    const emailEl = document.getElementById('fp-email');
    if (emailEl) emailEl.value = '';
    const errEl = document.getElementById('fp-error');
    if (errEl) errEl.style.display = 'none';
    const ask      = document.getElementById('fp-state-ask');
    const found    = document.getElementById('fp-state-found');
    const notfound = document.getElementById('fp-state-notfound');
    if (ask)      ask.style.display      = 'block';
    if (found)    found.style.display    = 'none';
    if (notfound) notfound.style.display = 'none';
  }
  // Para os pollers ao sair das telas correspondentes
  if (id !== 'screen-bar-panel' && id !== 'screen-bar-explorar') { stopResultsPoller(); stopExplorePoller(); stopAtivadosPoller(); }
  if (id !== 'screen-promoter-explore') { stopPromoterExplorePoller(); }
  const isPromoterScreen = id.startsWith('screen-promoter');
  if (!isPromoterScreen)                { stopPromoterStatsPoller(); }
}

function goBack() { showScreen(OZ.previousScreen, false); }

function switchTab(tab) {
  const map = {
    // cliente
    'home':             () => { showScreen('screen-home', false); checkNightBanner(); },
    'picks':            () => { loadPicksScreen(); showScreen('screen-picks', false); },
    'history':          () => { loadHistory(); showScreen('screen-history', false); checkNightBanner(); },
    'profile':          () => { loadClienteProfile(); showScreen('screen-profile', false); },
    // bar
    'bar-panel':        () => { loadBarPanel(); showScreen('screen-bar-panel', false); updateBarNav('painel'); },
    'bar-beneficios':   () => { loadBarBeneficios(); showScreen('screen-bar-beneficios', false); updateBarNav('beneficios'); },
    'bar-explorar':     () => { loadBarExplore(); showScreen('screen-bar-explorar', false); updateBarNav('explorar'); },
    'bar-perfil':       () => { loadBarPerfil(); showScreen('screen-bar-perfil', false); },
    'bar-profile':      () => { loadBarProfile(); showScreen('screen-bar-profile', false); updateBarNav('profile'); },
    // promoter
    'promoter-home':    () => { loadPromoterHome();    showScreen('screen-promoter-home',    false); checkPromoterInboxBadge(); },
    'promoter-explore': () => { loadPromoterExplore(); showScreen('screen-promoter-explore', false); checkPromoterInboxBadge(); },
    'promoter-history': () => { loadPromoterHistory(); showScreen('screen-promoter-history', false); checkPromoterInboxBadge(); },
    'promoter-profile': () => { loadPromoterProfile(); showScreen('screen-promoter-profile', false); },
  };
  if (map[tab]) map[tab]();
}

/* Atualiza estado ativo do nav do Bar nas telas Painel, Benefícios, Explorar e Conta */
function updateBarNav(active) {
  document.querySelectorAll(
    '#screen-bar-panel .bin-item, #screen-bar-beneficios .bin-item, #screen-bar-explorar .bin-item, #screen-bar-profile .bin-item'
  ).forEach(btn => {
    const icon = btn.querySelector('i');
    const isPainel     = icon && icon.classList.contains('fa-th-large');
    const isBeneficios = icon && icon.classList.contains('fa-bolt');
    const isExplorar   = icon && icon.classList.contains('fa-compass');
    const isProfile    = icon && icon.classList.contains('fa-user-circle');
    btn.classList.toggle('active',
      active === 'painel'     ? isPainel     :
      active === 'beneficios' ? isBeneficios :
      active === 'explorar'   ? isExplorar   :
      isProfile
    );
  });
}

/* Carrega a tela de Benefícios do Bar */
function loadBarBeneficios() {
  const user = OZ.currentUser;
  if (!user) return;

  // Sincroniza nome no header da tela
  const nameEl = document.getElementById('bar-beneficios-name');
  if (nameEl) nameEl.textContent = user.bar_name || user.name || 'Meu Bar';

  // Sincroniza avatar
  const logoEl = document.getElementById('bex-logo-img-b');
  if (logoEl && user.photo_url) {
    logoEl.style.backgroundImage    = `url('${user.photo_url}')`;
    logoEl.style.backgroundSize     = 'cover';
    logoEl.style.backgroundPosition = 'center';
    logoEl.textContent = '';
  }

  // ── Controle de aprovação ──────────────────────────────
  const approved    = !user.approval_status || user.approval_status === 'approved';
  const bannerEl    = document.getElementById('bar-approval-banner');
  const calSection  = document.querySelector('#screen-bar-beneficios .bsl-cal-section');
  const formPanel   = document.getElementById('sched-form-panel');
  const listSection = document.getElementById('bsl-list-section');

  if (bannerEl)    bannerEl.style.display    = approved ? 'none' : 'block';
  if (calSection)  { calSection.style.opacity = approved ? '' : '0.35'; calSection.style.pointerEvents = approved ? '' : 'none'; }
  if (formPanel)   { formPanel.style.opacity  = approved ? '' : '0.35'; formPanel.style.pointerEvents  = approved ? '' : 'none'; }
  if (listSection) { listSection.style.opacity = approved ? '' : '0.35'; listSection.style.pointerEvents = approved ? '' : 'none'; }

  // Inicializa o calendário de benefícios
  if (user.bar_id) {
    apiGet(`tables/promotions?limit=200`).then(res => {
      initPromoTab(res.data || [], user.bar_id);
    }).catch(() => initPromoTab([], user.bar_id || ''));
  }
}

/* Carrega a tela de Perfil do Bar (aba inferior) — popula os campos de edição */
async function loadBarPerfil() {
  const user = OZ.user || OZ.currentUser;
  if (!user) return;
  // Reutiliza loadBarTabInfo que já preenche todos os campos
  // Busca dados frescos do servidor se possível
  try {
    const res  = await apiGet(`tables/users/${user.id}`);
    const data = res || user;
    loadBarTabInfo(data);
  } catch(e) {
    loadBarTabInfo(user);
  }
}

/* ══════════════════════════════════
   MÁSCARAS DE INPUT
══════════════════════════════════ */
function maskCPF(input) {
  let v = input.value.replace(/\D/g, '').slice(0, 11);
  if (v.length > 9)      v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{0,2})/, '$1.$2.$3-$4');
  else if (v.length > 6) v = v.replace(/(\d{3})(\d{3})(\d{0,3})/,        '$1.$2.$3');
  else if (v.length > 3) v = v.replace(/(\d{3})(\d{0,3})/,                '$1.$2');
  input.value = v;
}

function maskCNPJ(input) {
  let v = input.value.replace(/\D/g, '').slice(0, 14);
  if (v.length > 12)     v = v.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2})/, '$1.$2.$3/$4-$5');
  else if (v.length > 8) v = v.replace(/(\d{2})(\d{3})(\d{3})(\d{0,4})/,         '$1.$2.$3/$4');
  else if (v.length > 5) v = v.replace(/(\d{2})(\d{3})(\d{0,3})/,                 '$1.$2.$3');
  else if (v.length > 2) v = v.replace(/(\d{2})(\d{0,3})/,                         '$1.$2');
  input.value = v;
}

function maskPhone(input) {
  let v = input.value.replace(/\D/g, '').slice(0, 11);
  if (v.length > 10)     v = v.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
  else if (v.length > 6) v = v.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
  else if (v.length > 2) v = v.replace(/(\d{2})(\d{0,5})/,         '($1) $2');
  input.value = v;
}

function togglePassword(id) {
  const el = document.getElementById(id);
  el.type = el.type === 'password' ? 'text' : 'password';
}

/* Feedback em tempo real de confirmação de senha */
function checkPassMatch(passId, confirmId, hintId) {
  const pass    = (document.getElementById(passId)?.value || '');
  const confirm = (document.getElementById(confirmId)?.value || '');
  const hint    = document.getElementById(hintId);
  if (!hint) return;
  if (!confirm) { hint.textContent = ''; hint.style.color = ''; return; }
  if (pass === confirm) {
    hint.textContent = '✓ Senhas coincidem';
    hint.style.color = '#22c55e';
  } else {
    hint.textContent = '✗ As senhas não coincidem';
    hint.style.color = '#f87171';
  }
}

/* ══════════════════════════════════
   VALIDAÇÕES
══════════════════════════════════ */
function validateCPF(cpf) {
  const c = cpf.replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(c[i]) * (10 - i);
  let r = 11 - (sum % 11); if (r > 9) r = 0;
  if (r !== parseInt(c[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(c[i]) * (11 - i);
  r = 11 - (sum % 11); if (r > 9) r = 0;
  return r === parseInt(c[10]);
}

function validateAge(birthDateStr, minAge = 18) {
  const birth = new Date(birthDateStr);
  const now   = new Date();
  const age   = now.getFullYear() - birth.getFullYear()
    - (now < new Date(now.getFullYear(), birth.getMonth(), birth.getDate()) ? 1 : 0);
  return age >= minAge;
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateCNPJ(cnpj) {
  const c = cnpj.replace(/\D/g, '');
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  // Validação básica de dígitos verificadores
  let sum = 0, w = [5,4,3,2,9,8,7,6,5,4,3,2];
  for (let i = 0; i < 12; i++) sum += parseInt(c[i]) * w[i];
  let r = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  if (r !== parseInt(c[12])) return false;
  sum = 0; w = [6,5,4,3,2,9,8,7,6,5,4,3,2];
  for (let i = 0; i < 13; i++) sum += parseInt(c[i]) * w[i];
  r = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  return r === parseInt(c[13]);
}

/* ══════════════════════════════════
   AUTH — LOGIN
══════════════════════════════════ */
async function doLogin() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  errEl.style.display = 'none';

  if (!email || !password) { showAlertEl(errEl, 'Preencha e-mail e senha.'); return; }

  // Credenciais do admin — redireciona para o painel
  if (email === 'admin@oz.com' && password === 'oz@admin2025') {
    sessionStorage.setItem('oz_admin', '1');
    window.location.href = 'admin.html';
    return;
  }

  setLoading('login-btn-text', 'login-spinner', 'Entrando...');
  try {
    // 1) Autenticar via Supabase Auth
    await SupaAuth.signIn(email, password);

    // 2) Buscar perfil do usuário na tabela users
    const res  = await apiGet(`tables/users?search=${encodeURIComponent(email)}&limit=50`);
    const user = (res.data || []).find(u => (u.email || '').toLowerCase() === email.toLowerCase());
    if (!user) throw new Error('Conta não encontrada. Verifique seu e-mail.');
    loginSuccess(user);
  } catch (err) {
    showAlertEl(errEl, ozFriendlyError(err));
  } finally {
    setLoading('login-btn-text', 'login-spinner', 'Entrar na OZ', false);
  }
}

function quickLogin(role) { loginSuccess(DEMO_USERS[role]); }

/* ══════════════════════════════════
   ESQUECI MINHA SENHA
══════════════════════════════════ */
let _fpFoundUser = null; // guarda o usuário encontrado
let _fpPassVisible = false;

async function doForgotPassword() {
  const email  = (document.getElementById('fp-email')?.value || '').trim().toLowerCase();
  const errEl  = document.getElementById('fp-error');
  if (!email) { showAlertEl(errEl, 'Digite seu e-mail para continuar.'); return; }

  setLoading('fp-btn-text', 'fp-spinner', 'Enviando...');
  errEl.style.display = 'none';

  try {
    // Envia e-mail de redefinição de senha via Supabase Auth
    await SupaAuth.resetPassword(email);

    // Exibe estado de sucesso (e-mail enviado)
    _fpFoundUser   = { email };
    const sentEmailEl = document.getElementById('fp-sent-email');
    if (sentEmailEl) sentEmailEl.textContent = email;

    document.getElementById('fp-state-ask').style.display    = 'none';
    document.getElementById('fp-state-notfound').style.display = 'none';
    document.getElementById('fp-state-found').style.display  = 'block';

  } catch (err) {
    // Supabase retorna sucesso mesmo para e-mails inexistentes (evita enumeração)
    // Mas se houver erro de rede ou config, mostramos mensagem genérica
    showAlertEl(errEl, 'Erro ao enviar. Verifique sua conexão e tente novamente.');
  } finally {
    setLoading('fp-btn-text', 'fp-spinner', 'Enviar link de redefinição', false);
  }
}

function fpTogglePassword() {
  /* Removido: senhas não são mais armazenadas nem exibidas */
}

async function fpCopyPassword() {
  /* Removido: senhas não são mais armazenadas nem exibidas */
}

function fpGoLogin() {
  /* Pré-preenche o e-mail na tela de login */
  const emailEl = document.getElementById('login-email');
  if (emailEl && _fpFoundUser?.email) emailEl.value = _fpFoundUser.email;
  showScreen('screen-login');
}

/* ══════════════════════════════════
   REDEFINIÇÃO DE SENHA
   Ativada quando o usuário chega via
   link de recovery do Supabase Auth.
══════════════════════════════════ */
async function doResetPassword() {
  const pass    = (document.getElementById('rp-password')?.value         || '');
  const confirm = (document.getElementById('rp-password-confirm')?.value || '');
  const errEl   = document.getElementById('rp-error');
  const succEl  = document.getElementById('rp-success');

  errEl.style.display  = 'none';
  succEl.style.display = 'none';

  if (pass.length < 6) {
    showAlertEl(errEl, 'A senha deve ter no mínimo 6 caracteres.');
    return;
  }
  if (pass !== confirm) {
    showAlertEl(errEl, '❌ As senhas não coincidem. Verifique e tente novamente.');
    return;
  }

  setLoading('rp-btn-text', 'rp-spinner', 'Salvando...');
  try {
    await SupaAuth.updatePassword(pass);

    // Exibe estado de sucesso
    document.getElementById('rp-state-form').style.display    = 'none';
    document.getElementById('rp-state-done').style.display    = 'block';
    document.getElementById('rp-state-invalid').style.display = 'none';
  } catch (err) {
    showAlertEl(errEl, ozFriendlyError(err));
  } finally {
    setLoading('rp-btn-text', 'rp-spinner', '<i class="fa fa-lock"></i> Salvar nova senha', false);
  }
}

function fpRetry() {
  _fpFoundUser   = null;
  _fpPassVisible = false;
  const emailEl = document.getElementById('fp-email');
  if (emailEl) { emailEl.value = ''; emailEl.focus(); }
  document.getElementById('fp-state-ask').style.display      = 'block';
  document.getElementById('fp-state-notfound').style.display = 'none';
  document.getElementById('fp-state-found').style.display    = 'none';
  const errEl = document.getElementById('fp-error');
  if (errEl) errEl.style.display = 'none';
}

function loginSuccess(user) {
  OZ.currentUser = user;
  localStorage.setItem('oz_user', JSON.stringify(user));
  // Limpa caches de sessão anterior para evitar contaminação entre logins
  OZ._lastActsSnapshot = [];
  OZ._lastPollAt = 0;
  OZ.userNameCache = {};
  routeToHome(user);
  showToast(`Olá, ${user.name.split(' ')[0]}! 🎉`, 'success');
  // Atualiza presença online (apenas usuários reais)
  if (!user.id.startsWith('demo-')) {
    updatePresence();
    // Mantém presença atualizada a cada 90s
    if (OZ.presenceInterval) clearInterval(OZ.presenceInterval);
    OZ.presenceInterval = setInterval(updatePresence, 90000);
  }
}

function routeToHome(user) {
  if (user.role === 'cliente') {
    loadBars(); // carrega dados em background
    loadClienteProfile();
    showScreen('screen-home');
    checkNightBanner();
    setTimeout(checkInboxBadge, 1500);
    // Polling periódico do badge de notificações (a cada 30 s)
    if (!OZ._inboxBadgePoller) {
      OZ._inboxBadgePoller = setInterval(checkInboxBadge, 30_000);
    }
  } else if (user.role === 'bar') {
    // Sincroniza bar_genre do user → bars.genre para que o filtro do cliente funcione
    if (user.bar_id && user.bar_genre) {
      apiPatch(`tables/bars/${user.bar_id}`, { genre: user.bar_genre }).catch(() => {});
    }
    loadBarPanel(); // carrega dados em background
    showScreen('screen-bar-panel');
    updateBarNav('painel');
  } else if (user.role === 'promoter') {
    loadPromoterHome(); // carrega dados em background
    showScreen('screen-promoter-home');
    checkPromoterInboxBadge();
  }
}

function doLogout() {
  markPresenceOffline();
  if (OZ.presenceInterval)   { clearInterval(OZ.presenceInterval);   OZ.presenceInterval   = null; }
  if (OZ.chatPollInterval)   { clearInterval(OZ.chatPollInterval);   OZ.chatPollInterval   = null; }
  if (OZ._inboxBadgePoller)  { clearInterval(OZ._inboxBadgePoller);  OZ._inboxBadgePoller  = null; }
  stopResultsPoller();
  stopAtivadosPoller();
  stopExplorePoller();
  stopPromoterExplorePoller();
  stopPromoterStatsPoller();
  OZ._promoterStatsCache = null;
  // Limpa caches de sessão para evitar contaminação entre logins
  OZ._lastActsSnapshot = [];
  OZ._lastPollAt = 0;
  OZ.userNameCache = {};
  OZ.currentUser = null;
  localStorage.removeItem('oz_user');
  // Encerra sessão no Supabase Auth (não-bloqueante)
  if (typeof SupaAuth !== 'undefined') SupaAuth.signOut().catch(() => {});
  showScreen('screen-welcome');
  showToast('Até logo! 👋');
}

/* ══════════════════════════════════
   CADASTRO — CLIENTE
══════════════════════════════════ */
async function doRegisterCliente() {
  const errEl  = document.getElementById('reg-cliente-error');
  const succEl = document.getElementById('reg-cliente-success');
  errEl.style.display = 'none';
  succEl.style.display = 'none';

  const name      = document.getElementById('c-name').value.trim();
  const cpf       = document.getElementById('c-cpf').value.trim();
  const birthdate = document.getElementById('c-birthdate').value;
  const gender    = document.getElementById('c-gender').value;
  const phone     = document.getElementById('c-phone').value.trim();
  const email           = document.getElementById('c-email').value.trim();
  const password        = document.getElementById('c-password').value;
  const passwordConfirm = document.getElementById('c-password-confirm').value;
  const referral        = document.getElementById('c-referral').value.trim().toUpperCase();
  const terms           = document.getElementById('c-terms').checked;
  const privacy          = document.getElementById('c-privacy').checked;

  // Validações
  if (!name)      { showAlertEl(errEl, 'Informe seu nome completo.'); return; }
  if (!cpf)       { showAlertEl(errEl, 'Informe seu CPF.'); return; }
  if (!validateCPF(cpf)) { showAlertEl(errEl, 'CPF inválido. Verifique o número informado.'); return; }
  if (!birthdate) { showAlertEl(errEl, 'Informe sua data de nascimento.'); return; }
  if (!validateAge(birthdate, 18)) {
    showAlertEl(errEl, '❌ Você precisa ter 18 anos ou mais para se cadastrar no Oz.'); return;
  }
  if (!gender)    { showAlertEl(errEl, 'Selecione seu gênero.'); return; }
  if (!email || !validateEmail(email)) { showAlertEl(errEl, 'Informe um e-mail válido.'); return; }
  if (password.length < 6) { showAlertEl(errEl, 'A senha deve ter no mínimo 6 caracteres.'); return; }
  if (password !== passwordConfirm) { showAlertEl(errEl, '❌ As senhas não coincidem. Verifique e tente novamente.'); return; }
  if (!terms)     { showAlertEl(errEl, 'Você deve confirmar que tem 18 anos e aceitar os Termos de Uso.'); return; }
  if (!privacy)   { showAlertEl(errEl, 'Você deve aceitar a Política de Privacidade para continuar.'); return; }

  setLoading('c-btn-text', 'c-spinner', 'Criando conta...');
  try {
    // Checar e-mail duplicado
    await checkEmailDuplicate(email);
    // Checar CPF duplicado
    await checkCPFDuplicate(cpf);

    // ── Verificar código de convite: aceita código de PROMOTER (referral_code)
    //    ou de CLIENTE (invite_code). Tenta promoter primeiro; se não achar, tenta cliente.
    let referredById   = null;
    let inviterIsClient = false;
    if (referral) {
      // Usa anon key diretamente — usuário ainda não autenticado no momento do cadastro
      const anonHdrs = {
        'Content-Type': 'application/json',
        'apikey':        SB_ANON,
        'Authorization': `Bearer ${SB_ANON}`,
      };

      // 1) Tenta como referral_code de promoter (busca exata no servidor)
      const promoterRes = await fetch(
        `${SB_URL}/users?referral_code=eq.${encodeURIComponent(referral)}&role=eq.promoter&limit=1`,
        { headers: anonHdrs }
      ).then(r => r.json()).catch(() => []);
      const promoterRef = Array.isArray(promoterRes) ? promoterRes[0] : null;

      // 2) Tenta como invite_code de cliente (busca exata no servidor)
      const clientRes = !promoterRef ? await fetch(
        `${SB_URL}/users?invite_code=eq.${encodeURIComponent(referral)}&role=eq.cliente&limit=1`,
        { headers: anonHdrs }
      ).then(r => r.json()).catch(() => []) : [];
      const clientRef = Array.isArray(clientRes) ? clientRes[0] : null;

      const refUser = promoterRef || clientRef;
      if (!refUser) { showAlertEl(errEl, 'Código de convite não encontrado. Verifique e tente novamente.'); return; }
      referredById    = refUser.id;
      inviterIsClient = !!clientRef;
    }

    // ── Criar usuário no Supabase Auth (email + senha)
    // Após signup, faz login imediato para garantir access_token válido
    // (quando "Confirm email" está OFF no Supabase, signup já retorna token;
    //  quando está ON, é necessário fazer signIn logo em seguida)
    let authId = null;
    try {
      const { user: authUser, session: signupSession } = await SupaAuth.signUp(email, password);
      authId = authUser?.id;
      // Se signup não retornou access_token (confirm email ativo), faz login imediato
      if (!signupSession?.access_token) {
        try {
          const { user: loginUser } = await SupaAuth.signIn(email, password);
          authId = loginUser?.id || authId;
        } catch (_) {
          // Login falhou (ex: email não confirmado) — continua com authId do signup
        }
      }
    } catch (signupErr) {
      const msg = signupErr.message || '';
      if (msg.toLowerCase().includes('already registered') || msg.toLowerCase().includes('already been registered')) {
        // Tenta login para recuperar o authId
        try {
          const { user: loginUser } = await SupaAuth.signIn(email, password);
          authId = loginUser?.id;
          // Verifica se o registro na tabela users já existe
          if (authId) {
            const existing = await apiGet(`tables/users/${authId}`).catch(() => null);
            if (existing?.id) {
              // Registro já existe — faz login normalmente
              showAlertEl(succEl, '✅ Conta recuperada! Entrando...', 'success');
              setTimeout(() => loginSuccess(existing), 1200);
              return;
            }
          }
        } catch (_) {
          throw new Error('Este e-mail já está cadastrado. Tente fazer login ou recupere sua senha.');
        }
      } else {
        throw signupErr;
      }
    }

    // Gera invite_code único para o novo cliente
    const inviteCode = generateReferralCode(name);

    const newUser = await apiPost('tables/users', {
      ...(authId ? { id: authId } : {}),
      name, cpf, birth_date: birthdate, gender, phone, email,
      role: 'cliente',
      invite_code:   inviteCode,
      referral_code: null,
      referred_by:   referredById,
      balance: 0, activations_count: 0, total_saved: 0,
    });

    showAlertEl(succEl, '✅ Bem-vindo à OZ! Entrando...', 'success');
    localStorage.removeItem('oz_ref');
    setTimeout(() => loginSuccess(newUser), 1200);
  } catch (err) {
    showAlertEl(errEl, ozFriendlyError(err));
  } finally {
    setLoading('c-btn-text', 'c-spinner', '<i class="fa fa-user-plus"></i> Criar conta de Cliente', false);
  }
}

/* ══════════════════════════════════
   CADASTRO — BAR
══════════════════════════════════ */
async function doRegisterBar() {
  const errEl  = document.getElementById('reg-bar-error');
  const succEl = document.getElementById('reg-bar-success');
  errEl.style.display = 'none';
  succEl.style.display = 'none';

  const barname       = document.getElementById('b-barname').value.trim();
  const genre         = document.getElementById('b-genre').value;
  const hood          = document.getElementById('b-hood').value.trim();
  const address       = document.getElementById('b-address').value.trim();
  const cnpj          = document.getElementById('b-cnpj').value.trim();
  const respname      = document.getElementById('b-respname').value.trim();
  const phone         = document.getElementById('b-phone').value.trim();
  const instagram     = (document.getElementById('b-instagram')?.value || '').trim().replace(/^@/,'');
  const release       = (document.getElementById('b-release')?.value || '').trim();
  const benefit       = (document.getElementById('b-benefit')?.value || '').trim();
  const event_tonight = (document.getElementById('b-event')?.value || '').trim();
  const email           = document.getElementById('b-email').value.trim();
  const password        = document.getElementById('b-password').value;
  const passwordConfirm = document.getElementById('b-password-confirm').value;
  const terms           = document.getElementById('b-terms').checked;
  const privacy          = document.getElementById('b-privacy').checked;

  if (!barname)  { showAlertEl(errEl, 'Informe o nome do estabelecimento.'); return; }
  if (!genre)    { showAlertEl(errEl, 'Selecione o gênero/estilo do bar.'); return; }
  if (!hood)     { showAlertEl(errEl, 'Informe o bairro ou localização.'); return; }
  if (!address)  { showAlertEl(errEl, 'Informe o endereço completo do estabelecimento.'); return; }
  if (!cnpj)     { showAlertEl(errEl, 'Informe o CNPJ do estabelecimento.'); return; }
  if (!validateCNPJ(cnpj)) { showAlertEl(errEl, 'CNPJ inválido. Verifique o número informado.'); return; }
  if (!respname) { showAlertEl(errEl, 'Informe o nome do responsável.'); return; }
  if (!phone)    { showAlertEl(errEl, 'Informe o telefone de contato.'); return; }
  if (!email || !validateEmail(email)) { showAlertEl(errEl, 'Informe um e-mail válido.'); return; }
  if (password.length < 6) { showAlertEl(errEl, 'A senha deve ter no mínimo 6 caracteres.'); return; }
  if (password !== passwordConfirm) { showAlertEl(errEl, '❌ As senhas não coincidem. Verifique e tente novamente.'); return; }
  if (!OZ._regBarPhotoUrl) { showAlertEl(errEl, 'Adicione uma foto do estabelecimento para continuar.'); return; }
  if (!terms)    { showAlertEl(errEl, 'Aceite os Termos de Parceria para continuar.'); return; }
  if (!privacy)  { showAlertEl(errEl, 'Você deve aceitar a Política de Privacidade para continuar.'); return; }

  setLoading('b-btn-text', 'b-spinner', 'Cadastrando...');
  try {
    await checkEmailDuplicate(email);

    // ── Criar usuário no Supabase Auth (email + senha)
    // Após signup, faz login imediato para garantir access_token válido
    // (quando "Confirm email" está OFF no Supabase, signup já retorna token;
    //  quando está ON, é necessário fazer signIn logo em seguida)
    let authId = null;
    try {
      const { user: authUser, session: signupSession } = await SupaAuth.signUp(email, password);
      authId = authUser?.id;
      // Se signup não retornou access_token (confirm email ativo), faz login imediato
      if (!signupSession?.access_token) {
        try {
          const { user: loginUser } = await SupaAuth.signIn(email, password);
          authId = loginUser?.id || authId;
        } catch (_) {
          // Login falhou (ex: email não confirmado) — continua com authId do signup
        }
      }
    } catch (signupErr) {
      const msg = signupErr.message || '';
      if (msg.toLowerCase().includes('already registered') || msg.toLowerCase().includes('already been registered')) {
        try {
          const { user: loginUser } = await SupaAuth.signIn(email, password);
          authId = loginUser?.id;
          if (authId) {
            const existing = await apiGet(`tables/users/${authId}`).catch(() => null);
            if (existing?.id) {
              showAlertEl(errEl, 'Este e-mail já está cadastrado. Faça login normalmente.');
              return;
            }
          }
        } catch (_) {
          throw new Error('Este e-mail já está cadastrado. Tente fazer login ou recupere sua senha.');
        }
      } else {
        throw signupErr;
      }
    }

    const newBar = await apiPost('tables/bars', {
      ...(authId ? { id: authId } : {}),
      name: barname, neighborhood: hood, address,
      description: release, release, instagram,
      benefit: benefit || '', featured_promo: '',
      photo_url: OZ._regBarPhotoUrl || '', active: false,
      event_tonight, total_activations: 0,
      total_visitors: 0, peak_hour: '',
      genre,
      approval_status: 'pending',
    });

    const newUser = await apiPost('tables/users', {
      ...(authId ? { id: authId } : {}),
      name: barname, email,
      role: 'bar',
      bar_name: barname, bar_genre: genre, bar_id: newBar.id,
      cnpj, responsible_name: respname, phone,
      bar_instagram: instagram, bar_release: release,
      balance: 0, activations_count: 0,
      approval_status: 'pending',
    });

    showAlertEl(succEl, '✅ Bar cadastrado! Seu rolê tá no mapa. Entrando...', 'success');
    OZ._regBarPhotoUrl = '';
    const userWithBarId = { ...newUser, bar_id: newBar.id };
    setTimeout(() => loginSuccess(userWithBarId), 1200);
  } catch (err) {
    showAlertEl(errEl, ozFriendlyError(err));
  } finally {
    setLoading('b-btn-text', 'b-spinner', '<i class="fa fa-glass-cheers"></i> Cadastrar estabelecimento', false);
  }
}

/* ══════════════════════════════════
   CADASTRO — PROMOTER
══════════════════════════════════ */
async function doRegisterPromoter() {
  const errEl  = document.getElementById('reg-promoter-error');
  const succEl = document.getElementById('reg-promoter-success');
  errEl.style.display = 'none';
  succEl.style.display = 'none';

  const name      = document.getElementById('p-name').value.trim();
  const cpf       = document.getElementById('p-cpf').value.trim();
  const birthDate = document.getElementById('p-birth-date').value;
  const gender    = document.getElementById('p-gender').value;
  const phone     = document.getElementById('p-phone').value.trim();
  const instagram = document.getElementById('p-instagram').value.trim().replace(/^@/,'');
  const region    = document.getElementById('p-region').value.trim();
  const ptype     = document.getElementById('p-type').value;
  const release   = document.getElementById('p-release').value.trim();
  const email           = document.getElementById('p-email').value.trim();
  const password        = document.getElementById('p-password').value;
  const passwordConfirm = document.getElementById('p-password-confirm').value;
  const pix             = document.getElementById('p-pix').value.trim();
  const terms           = document.getElementById('p-terms').checked;
  const privacy          = document.getElementById('p-privacy').checked;

  if (!name)      { showAlertEl(errEl, 'Informe seu nome completo.'); return; }
  if (!cpf)       { showAlertEl(errEl, 'Informe seu CPF.'); return; }
  if (!validateCPF(cpf)) { showAlertEl(errEl, 'CPF inválido. Verifique o número informado.'); return; }
  if (!birthDate) { showAlertEl(errEl, 'Informe sua data de nascimento.'); return; }
  if (!gender)    { showAlertEl(errEl, 'Selecione seu gênero.'); return; }
  (() => {
    const hoje = new Date();
    const nasc = new Date(birthDate + 'T00:00:00');
    let idade = hoje.getFullYear() - nasc.getFullYear();
    const m = hoje.getMonth() - nasc.getMonth();
    if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
    if (idade < 18) throw Object.assign(new Error('menor'), { _block: true });
  })();
  if (!phone)     { showAlertEl(errEl, 'Informe seu telefone/WhatsApp.'); return; }
  if (!instagram) { showAlertEl(errEl, 'Informe seu @ do Instagram.'); return; }
  if (!region)    { showAlertEl(errEl, 'Informe sua região de atuação.'); return; }
  if (!ptype)     { showAlertEl(errEl, 'Selecione seu tipo de atuação.'); return; }
  if (release.length < 50) { showAlertEl(errEl, 'Seu release deve ter no mínimo 50 caracteres.'); return; }
  if (!email || !validateEmail(email)) { showAlertEl(errEl, 'Informe um e-mail válido.'); return; }
  if (password.length < 6) { showAlertEl(errEl, 'A senha deve ter no mínimo 6 caracteres.'); return; }
  if (password !== passwordConfirm) { showAlertEl(errEl, '❌ As senhas não coincidem. Verifique e tente novamente.'); return; }
  if (!pix)       { showAlertEl(errEl, 'Informe sua chave Pix para receber pagamentos.'); return; }
  if (!terms)     { showAlertEl(errEl, 'Aceite os Termos de Parceria para continuar.'); return; }
  if (!privacy)   { showAlertEl(errEl, 'Você deve aceitar a Política de Privacidade para continuar.'); return; }

  setLoading('p-btn-text', 'p-spinner', 'Criando conta...');
  try {
    await checkEmailDuplicate(email);
    await checkCPFDuplicate(cpf, birthDate);

    // ── Criar usuário no Supabase Auth (email + senha)
    // Após signup, faz login imediato para garantir access_token válido
    let authId = null;
    try {
      const { user: authUser, session: signupSession } = await SupaAuth.signUp(email, password);
      authId = authUser?.id;
      if (!signupSession?.access_token) {
        try {
          const { user: loginUser } = await SupaAuth.signIn(email, password);
          authId = loginUser?.id || authId;
        } catch (_) {}
      }
    } catch (signupErr) {
      const msg = signupErr.message || '';
      if (msg.toLowerCase().includes('already registered') || msg.toLowerCase().includes('already been registered')) {
        try {
          const { user: loginUser } = await SupaAuth.signIn(email, password);
          authId = loginUser?.id;
          if (authId) {
            const existing = await apiGet(`tables/users/${authId}`).catch(() => null);
            if (existing?.id) {
              showAlertEl(errEl, 'Este e-mail já está cadastrado. Faça login normalmente.');
              return;
            }
          }
        } catch (_) {
          throw new Error('Este e-mail já está cadastrado. Tente fazer login ou recupere sua senha.');
        }
      } else {
        throw signupErr;
      }
    }

    // Gera código de indicação único para o promoter
    const code = generateReferralCode(name);

    const newUser = await apiPost('tables/users', {
      ...(authId ? { id: authId } : {}),
      name, cpf, phone,
      birth_date: birthDate,
      gender,
      promoter_instagram: instagram,
      promoter_region: region,
      promoter_type: ptype,
      promoter_release: release,
      email,
      role: 'promoter',
      referral_code: code, pix_key: pix,
      balance: 0, activations_count: 0,
      approval_status: 'pending',
    });

    showAlertEl(succEl, `✅ Bem-vindo à OZ, Promoter! Seu código: ${code}. Bora indicar 🔥`, 'success');
    setTimeout(() => loginSuccess(newUser), 1400);
  } catch (err) {
    if (err._block) {
      showAlertEl(errEl, '🔞 Cadastro não permitido. É necessário ter 18 anos ou mais para ser Promoter.');
    } else {
      showAlertEl(errEl, ozFriendlyError(err));
    }
  } finally {
    setLoading('p-btn-text', 'p-spinner', '<i class="fa fa-star"></i> Criar conta de Promoter', false);
  }
}

/* ══════════════════════════════════
   BARES — LISTA
══════════════════════════════════ */
let allBars = [];

// Mapa global: bar_id → array de promoções ativas
let allPromos = {};

// Mapa global: bar_id → array de agendamentos (scheduled_benefits)
let allScheduled = {};   // { bar_id: [sched, ...] }
let allBarsMap   = {};   // { bar_id: bar }
let _barsDataLoaded = false;  // flag: dados já foram carregados via loadBars()
let _barsDataLoading = false; // flag: loadBars() já está em andamento

/* ══════════════════════════════════════════════════════════════
   CALENDÁRIO DA HOME — HCal
   Mini-calendário para filtrar benefícios por data.
   Marca em verde os dias com benefício agendado em algum bar.
══════════════════════════════════════════════════════════════ */
OZ._hcal = {
  year:  new Date().getFullYear(),
  month: new Date().getMonth(),
  selectedDate: null,   // null = "hoje"
};

const HCAL_MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun',
                     'Jul','Ago','Set','Out','Nov','Dez'];
const HCAL_MONTHS_FULL = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                          'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

/* Renderiza o mini-calendário */
function hcalRender() {
  const hcal = OZ._hcal;
  const grid  = document.getElementById('hcal-grid');
  const label = document.getElementById('hcal-month-label');
  if (!grid || !label) return;

  const y = hcal.year, m = hcal.month;
  label.textContent = `${HCAL_MONTHS_FULL[m]} ${y}`;

  const todayD      = new Date(); todayD.setHours(0,0,0,0);
  const todayStr    = localDateStr(todayD);
  const firstDay    = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m+1, 0).getDate();
  const sel         = hcal.selectedDate;

  // Quais datas têm algum agendamento em algum bar?
  const datesWithSched = new Set();
  Object.values(allScheduled).forEach(arr =>
    arr.forEach(s => { if (s.date) datesWithSched.add(s.date); })
  );

  let html = '';
  for (let i = 0; i < firstDay; i++) html += '<div class="hcal-cell hcal-empty"></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr  = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const cellDate = new Date(y, m, d);
    const isPast   = cellDate < todayD;
    const isToday  = dateStr === todayStr;
    const hasSched = datesWithSched.has(dateStr);
    const isSel    = sel === dateStr;   // seleção explícita apenas

    let cls = 'hcal-cell';
    if (isPast && !isToday) cls += ' hcal-past';
    if (isSel)    cls += ' hcal-sel';
    else if (isToday && hasSched)  cls += ' hcal-today-sched';
    else if (isToday)              cls += ' hcal-today';
    else if (hasSched)             cls += ' hcal-sched';

    // Clicável: apenas datas FUTURAS com agendamento (hoje e passado não são selecionáveis aqui)
    const isFuture  = dateStr > todayStr;
    const clickable = isFuture && hasSched;
    const onclick   = clickable ? `onclick="hcalSelect('${dateStr}')"` : '';
    if (!isFuture && !isPast) {
      // Hoje: exibe como indicativo não clicável
      cls = cls.replace(' hcal-sel','');
    }

    let inner = `<span class="hcal-dn">${d}</span>`;
    if (hasSched && !isSel && isFuture) inner += '<span class="hcal-dot"></span>';

    html += `<div class="${cls}" ${onclick}>${inner}</div>`;
  }
  grid.innerHTML = html;
}

/* Seleciona uma data no calendário home (aba Benefícios Agendados)
   Só aceita datas FUTURAS */
function hcalSelect(dateStr) {
  const hcal     = OZ._hcal;
  const todayStr = _todayStr();

  // Ignora hoje e passado
  if (dateStr <= todayStr) return;

  // Toggle: clicar na data já selecionada deseleciona
  hcal.selectedDate = hcal.selectedDate === dateStr ? null : dateStr;
  hcalRender();
  _hcalApplyFilter();
}

/* Botão Hoje: navega até o mês atual e limpa seleção */
function hcalGoToday() {
  OZ._hcal.year         = new Date().getFullYear();
  OZ._hcal.month        = new Date().getMonth();
  OZ._hcal.selectedDate = null;
  hcalRender();
  _hcalApplyFilter();
}

/* Navegação de mês */
function hcalPrev() {
  const hcal = OZ._hcal;
  hcal.month--;
  if (hcal.month < 0) { hcal.month = 11; hcal.year--; }
  hcalRender();
}
function hcalNext() {
  const hcal = OZ._hcal;
  hcal.month++;
  if (hcal.month > 11) { hcal.month = 0; hcal.year++; }
  hcalRender();
}

/* Aplica o filtro de data e re-renderiza a lista de bares.
   Aba Benefícios Agendados: mostra APENAS datas futuras (> hoje).
   Hoje é exibido na aba Descobrir. */
function _hcalApplyFilter() {
  const hcal     = OZ._hcal;
  const todayStr = _todayStr();          // respeita regra das 06h
  const dateFilter = hcal.selectedDate;

  const labelEl = document.getElementById('hcal-filter-label');
  const countEl = document.getElementById('hcal-filter-count');

  // Se nenhuma data selecionada, mostra orientação
  if (!dateFilter || dateFilter <= todayStr) {
    if (labelEl) labelEl.innerHTML = '<i class="fa fa-calendar-alt"></i> Selecione um dia futuro';
    if (countEl) countEl.style.display = 'none';
    _renderFilteredBars([], dateFilter || todayStr, false);
    return;
  }

  // Data futura selecionada
  const [y, mo, d] = dateFilter.split('-');
  const dt   = new Date(parseInt(y), parseInt(mo)-1, parseInt(d));
  const wday = dt.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.','').toUpperCase();
  const dayN = parseInt(d);
  const mon  = HCAL_MONTHS[parseInt(mo)-1];
  if (labelEl) labelEl.innerHTML = `<i class="fa fa-calendar-day"></i> ${wday}, ${dayN} de ${mon}`;

  const barsForDate = Object.entries(allScheduled)
    .filter(([, arr]) => arr.some(s => s.date === dateFilter))
    .map(([id]) => allBarsMap[id])
    .filter(b => b && b.active !== false);

  _renderFilteredBars(barsForDate, dateFilter, false);
  if (countEl) {
    countEl.textContent = barsForDate.length;
    countEl.style.display = barsForDate.length ? 'inline-block' : 'none';
  }
}

/* Renderiza lista filtrada por data — usa o pane "Benefícios Agendados"
   Só é chamada com datas futuras (> hoje). dateFilter = null = sem seleção. */
function _renderFilteredBars(bars, dateFilter, isToday) {
  const list  = document.getElementById('bars-list-sched');
  const empty = document.getElementById('bars-empty-sched');
  if (!list) return;

  list.innerHTML = '';

  if (!bars.length) {
    const noSelection = !dateFilter || dateFilter <= _todayStr();
    empty.innerHTML = `
      <div style="text-align:center;padding:40px 24px;">
        <div style="font-size:48px;margin-bottom:16px;">${noSelection ? '📅' : '🗓️'}</div>
        <p style="font-size:16px;font-weight:700;color:var(--white);margin-bottom:8px;">
          ${noSelection ? 'Selecione um dia futuro' : 'Nenhum bar agendado para este dia'}
        </p>
        <p style="font-size:13px;color:var(--gray-4);line-height:1.5;">
          ${noSelection
            ? 'Toque em um dia com bolinha no calendário para ver os benefícios agendados.'
            : 'Tente outra data ou aguarde novos agendamentos dos bares.'}
        </p>
      </div>`;
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';

  // Monta lista (ID único para não colidir com o cine-all-list da aba Descobrir)
  list.innerHTML = `<div class="cine-cards-list" id="cine-sched-list"></div>`;
  const container = document.getElementById('cine-sched-list');

  // Garante que cada bar apareça apenas uma vez
  const _renderedSched = new Set();

  bars.forEach(bar => {
    if (!bar) return;
    if (_renderedSched.has(bar.id)) return;
    _renderedSched.add(bar.id);
    const barId = bar.id;

    // Promo ativa (hoje) ou agendamento para a data filtrada
    let benefitText = '';
    let eventText   = '';
    let isLive      = false;
    let isScheduled = false;
    let schedDate   = '';

    const activePromos = allPromos[barId] || [];
    const schedArr     = allScheduled[barId] || [];
    const schedForDate = schedArr.find(s => s.date === dateFilter);

    if (isToday && activePromos.length) {
      // Benefício via promotions (ativo agora)
      const p = activePromos[0];
      benefitText = p.title || bar.benefit || 'Benefício especial';
      eventText   = p.event_tonight || bar.event_tonight || '';
      isLive      = true;
    } else if (schedForDate) {
      // Benefício via scheduled_benefits
      benefitText = schedForDate.title || bar.benefit || 'Benefício especial';
      eventText   = schedForDate.event || bar.event_tonight || '';
      isScheduled = true;
      schedDate   = schedForDate.date;
    } else if (isToday) {
      // Hoje mas só tem agendamento (ainda não virou promoção ativa)
      const todayStr = localDateStr(new Date());
      const todaySched = schedArr.find(s => s.date === todayStr);
      if (todaySched) {
        benefitText = todaySched.title || bar.benefit || 'Benefício especial';
        eventText   = todaySched.event || bar.event_tonight || '';
        isScheduled = true;
        schedDate   = todaySched.date;
      } else {
        benefitText = bar.benefit || 'Benefício especial';
        eventText   = bar.event_tonight || '';
      }
    }

    const genreLabel  = genreMap[bar.genre || bar.bar_genre] || '';
    const imgSrc      = bar.cover_url || bar.photo_url || DEF_IMG;
    const actCount    = bar.total_activations || 0;

    // Rating
    const ratingData  = (OZ._ratingsCache || {})[barId];
    const hasRating   = ratingData && ratingData.total > 0;
    const ratingAvg   = hasRating ? ratingData.avg.toFixed(1) : null;
    const ratingTotal = hasRating ? ratingData.total : 0;
    const ratingHtml  = hasRating ? (() => {
      const f = Math.floor(ratingData.avg);
      const h = ratingData.avg - f >= 0.5;
      return Array.from({ length: 5 }, (_, i) =>
        `<i class="${i < f ? 'fa fa-star' : i === f && h ? 'fa fa-star-half-alt' : 'far fa-star'}"></i>`
      ).join('');
    })() : '';

    // Verifica se o benefício (live ou agendado para hoje) está esgotado
    const _schedBenefit = schedForDate || (schedArr.find(s => s.date === localDateStr(new Date())));
    const _promoLive    = isLive ? (allPromos[barId] || [])[0] : null;
    const _anyBenefit   = _promoLive || _schedBenefit;
    const _maxAdv       = _anyBenefit?.max_activations || 0;
    const _curAdv       = _anyBenefit?.activations_count || 0;
    const isFull        = _maxAdv > 0 && _curAdv >= _maxAdv;

    // Badge e cores por tipo
    let badgeHtml = '';
    if (isFull) {
      badgeHtml = `<span class="cine-live-badge cine-live-badge-full"><i class="fa fa-ban"></i> ESGOTADO</span>`;
    } else if (isLive) {
      badgeHtml = `<span class="cine-live-badge"><i class="fa fa-bolt"></i> ATIVO</span>`;
    } else if (isScheduled) {
      // Formata a data agendada
      const [sy, smo, sd] = (schedDate || dateFilter).split('-');
      const sdt = new Date(parseInt(sy), parseInt(smo)-1, parseInt(sd));
      const isDateToday = schedDate === localDateStr(new Date());
      const dateLabel = isDateToday
        ? 'HOJE'
        : sdt.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })
            .replace('.','').toUpperCase();
      badgeHtml = `<span class="cine-sched-badge"><i class="fa fa-calendar-check"></i> ${dateLabel}</span>`;
    }

    const card = document.createElement('div');
    card.className = `cine-card${isScheduled && !isLive ? ' cine-card-sched' : ''}${isFull ? ' cine-card-full' : ''}`;
    card.innerHTML = `
      <div class="cine-card-img-wrap">
        <img class="cine-card-img" src="${imgSrc}" alt="${bar.name}" loading="lazy" onerror="this.src='${DEF_IMG}'"/>
        <div class="cine-card-img-overlay"></div>
        ${badgeHtml}
        ${genreLabel ? `<span class="cine-genre-badge">${genreLabel}</span>` : ''}
      </div>
      <div class="cine-card-body">
        <p class="cine-card-studio">OZ · Benefício exclusivo</p>
        <h3 class="cine-card-title">${bar.name}</h3>
        ${hasRating ? `
        <div class="cine-card-rating">
          <div class="cine-rating-stars">${ratingHtml}</div>
          <span class="cine-rating-avg">${ratingAvg}</span>
          <span class="cine-rating-count">(${ratingTotal})</span>
        </div>` : ''}
        <div class="cine-card-meta">
          <span class="cine-meta-item"><i class="fa fa-map-marker-alt"></i> ${bar.neighborhood || '—'}</span>
          <span class="cine-meta-dot">·</span>
          <span class="cine-meta-item"><i class="fa fa-bolt"></i> ${actCount} ativações</span>
          ${eventText ? `<span class="cine-meta-dot">·</span><span class="cine-meta-item cine-meta-music"><i class="fa fa-music"></i> Ao vivo</span>` : ''}
        </div>
        ${isFull
          ? `<p class="cine-card-desc cine-card-desc-full"><i class="fa fa-ban" style="margin-right:5px;opacity:.6"></i>Todas as ${_maxAdv} vaga${_maxAdv !== 1 ? 's foram' : ' foi'} preenchida${_maxAdv !== 1 ? 's' : ''}. Benefício indisponível.</p>`
          : `<p class="cine-card-desc">${benefitText}${eventText ? ' · ' + eventText : ''}</p>`
        }
        <div class="adv-card-btns">
          <button class="cine-btn-view adv-btn-view">
            <i class="fa fa-eye"></i> Ver bar
          </button>
          ${isFull
            ? `<button class="cine-btn-activate cine-btn-full adv-btn-advance" disabled>
                 <i class="fa fa-ban"></i> Vagas esgotadas
               </button>`
            : `<button class="cine-btn-activate adv-btn-advance" data-istoday="${schedDate === localDateStr(new Date()) ? '1' : '0'}">
                 <i class="fa fa-bolt"></i> ${schedDate === localDateStr(new Date()) ? 'Ativar' : 'Ativar por antecipação'}
               </button>`
          }
        </div>
      </div>`;

    // Botão "Ver bar" → abre detalhe no contexto do benefício agendado (se houver) ou normal
    card.querySelector('.adv-btn-view').addEventListener('click', (e) => {
      e.stopPropagation();
      if (isScheduled && schedForDate) {
        openBarDetailForSched(bar, schedForDate);
      } else {
        openBarDetail(bar);
      }
    });
    // Botão de ativação → se for hoje abre modal padrão (unitário/noite toda), senão pré-ativação
    card.querySelector('.adv-btn-advance').addEventListener('click', (e) => {
      e.stopPropagation();
      if (!schedForDate) { openBarDetail(bar); return; }
      const isToday = schedForDate.date === localDateStr(new Date());
      if (isToday) {
        // Benefício desta noite: abre o modal padrão com opções unitário / noite toda
        OZ.currentBar = bar;
        openBarDetail(bar).then(() => openActivateModal());
      } else {
        openAdvanceActivateModal(schedForDate, bar);
      }
    });
    // Clique na imagem / card → mesmo comportamento do botão "Ver bar"
    card.addEventListener('click', () => {
      if (isScheduled && schedForDate) {
        openBarDetailForSched(bar, schedForDate);
      } else {
        openBarDetail(bar);
      }
    });
    container.appendChild(card);
  });
}

function loadBars() {
  const user = OZ.currentUser;
  if (user) {
    document.getElementById('home-greeting').textContent = 'Olá 👋';
    const firstName = (user.name || 'Usuário').split(' ')[0];
    document.getElementById('home-title').textContent = firstName;
    document.getElementById('home-avatar-initial').textContent = firstName[0].toUpperCase();
    const avatarEl = document.getElementById('home-avatar');
    if (avatarEl && user.photo_url) {
      avatarEl.style.backgroundImage    = `url('${user.photo_url}')`;
      avatarEl.style.backgroundSize     = 'cover';
      avatarEl.style.backgroundPosition = 'center';
      const initEl = document.getElementById('home-avatar-initial');
      if (initEl) initEl.style.display = 'none';
    }
  }

  const list  = document.getElementById('bars-list');
  const empty = document.getElementById('bars-empty');

  // Skeleton
  if (!list || !empty) return;
  _barsDataLoading = true;
  list.innerHTML = `
    <div class="cine-cards-list">
      ${[1,2,3].map(()=>`
        <div style="border-radius:18px;overflow:hidden;margin-bottom:16px;background:var(--black-2);border:1px solid rgba(255,255,255,.06)">
          <div style="height:200px;background:linear-gradient(90deg,#1a1a24 25%,#22222e 50%,#1a1a24 75%);background-size:200% 100%;animation:shimmer 1.5s infinite"></div>
          <div style="padding:14px 16px 16px">
            <div style="height:10px;width:60%;background:linear-gradient(90deg,#1a1a24 25%,#22222e 50%,#1a1a24 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;border-radius:6px;margin-bottom:10px"></div>
            <div style="height:20px;width:85%;background:linear-gradient(90deg,#1a1a24 25%,#22222e 50%,#1a1a24 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;border-radius:6px;margin-bottom:8px"></div>
            <div style="height:12px;width:70%;background:linear-gradient(90deg,#1a1a24 25%,#22222e 50%,#1a1a24 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;border-radius:6px"></div>
          </div>
        </div>`).join('')}
    </div>`;
  empty.style.display = 'none';

  const todayStr = localDateStr(new Date());

  // Inicializa calendário home
  OZ._hcal.year         = new Date().getFullYear();
  OZ._hcal.month        = new Date().getMonth();
  OZ._hcal.selectedDate = null;

  // Busca tudo em paralelo: promoções ativas, agendamentos, bares, reviews
  Promise.all([
    apiGet('tables/promotions?limit=200'),
    apiGet('tables/scheduled_benefits?limit=500'),
    apiGet('tables/bars?limit=200'),
    apiGet('tables/reviews?limit=500'),
  ])
  .then(([promosRes, schedsRes, barsRes, reviewsRes]) => {

    // 1. Processa bares
    allBarsMap = {};
    (barsRes.data || []).forEach(b => { allBarsMap[b.id] = b; });

    // 2. Processa promoções ativas
    allPromos = {};
    (promosRes.data || []).forEach(p => {
      if (isPromoActive(p)) {
        if (!allPromos[p.bar_id]) allPromos[p.bar_id] = [];
        allPromos[p.bar_id].push(p);
      }
    });

    // 3. Processa agendamentos (todos, não só hoje)
    allScheduled = {};
    (schedsRes.data || []).forEach(s => {
      if (!s.bar_id || s.active === false) return;
      if (!allScheduled[s.bar_id]) allScheduled[s.bar_id] = [];
      allScheduled[s.bar_id].push(s);
    });

    // 4. Pré-calcula ratings
    OZ._ratingsCache = OZ._ratingsCache || {};
    const reviewsByBar = {};
    (reviewsRes.data || []).forEach(r => {
      if (!reviewsByBar[r.bar_id]) reviewsByBar[r.bar_id] = [];
      reviewsByBar[r.bar_id].push(r);
    });
    Object.keys(reviewsByBar).forEach(barId => {
      const rs  = reviewsByBar[barId];
      const avg = rs.length
        ? parseFloat((rs.reduce((s, r) => s + (r.rating || 0), 0) / rs.length).toFixed(1))
        : 0;
      OZ._ratingsCache[barId] = { avg, total: rs.length };
    });

    // Monta mapa unificado: promo ativa OU agendado para hoje
    // (usado pelo Descobrir e pelo calendário)
    const todayKey = _todayStr();

    // Adiciona agendamentos de hoje ao allPromos (com _source: 'scheduled')
    // somente se o bar ainda não tem promo live
    (schedsRes.data || []).forEach(s => {
      if (!s.bar_id || s.active === false) return;
      if (s.date !== todayKey) return;            // só hoje
      if (!allPromos[s.bar_id]) {
        allPromos[s.bar_id] = [{
          id:              s.id,
          bar_id:          s.bar_id,
          title:           s.title,
          description:     s.description || '',
          event_tonight:   s.event || '',
          max_activations: s.max_activations || 0,
          activations_count: s.activations_count || 0,
          active:          true,
          category:        s.category || '',
          _source:         'scheduled',
          _schedDate:      s.date,
        }];
      }
    });

    // allBars = todos os bares com benefício ativo hoje (live ou agendado)
    const _seenBars = new Set();
    allBars = Object.keys(allPromos)
      .filter(id => allBarsMap[id] && allBarsMap[id].active !== false)
      .map(id => allBarsMap[id])
      .filter(b => {
        if (_seenBars.has(b.id)) return false;
        _seenBars.add(b.id);
        return true;
      });

    // Busca bar_genre via users.id === bars.id
    const barIds = Object.keys(allBarsMap);
    if (barIds.length) {
      const idsParam = barIds.join(',');   // UUIDs sem encode — PostgREST exige formato literal
      fetch(
        `${SB_URL}/users?id=in.(${idsParam})&select=id,bar_genre&limit=500`,
        { headers: { 'apikey': SB_ANON, 'Authorization': `Bearer ${SB_ANON}` } }
      )
      .then(r => r.ok ? r.json() : [])
      .catch(() => [])
      .then(rows => {
        (Array.isArray(rows) ? rows : []).forEach(u => {
          if (u.id && u.bar_genre && allBarsMap[u.id]) {
            allBarsMap[u.id].genre = u.bar_genre;
          }
        });
        renderBars(allBars);
        _barsDataLoaded  = true;
        _barsDataLoading = false;
        hcalRender();
        const schedTab = document.getElementById('htab-scheduled');
        if (schedTab && schedTab.classList.contains('active')) _hcalApplyFilter();
      });
    } else {
      renderBars(allBars);
      _barsDataLoaded  = true;
      _barsDataLoading = false;
      hcalRender();
    }
  })
  .catch(() => {
    allBars      = [];
    allPromos    = {};
    allScheduled = {};
    _barsDataLoaded  = false;
    _barsDataLoading = false;
    list.innerHTML = '';
    renderBarsEmpty();
    hcalRender();
  });
}

function renderBarsEmpty() {
  const empty = document.getElementById('bars-empty');
  if (!empty) return;
  empty.innerHTML = `
    <div style="text-align:center;padding:40px 24px;">
      <div style="font-size:48px;margin-bottom:16px;">🍺</div>
      <p style="font-size:16px;font-weight:700;color:var(--white);margin-bottom:8px;">Nenhum bar com promoção agora</p>
      <p style="font-size:13px;color:var(--gray-4);line-height:1.5;">Quando um bar publicar uma promoção ela aparecerá aqui em tempo real.</p>
    </div>`;
  empty.style.display = 'flex';
}

/* Patrocínio fica em bars.featured_promo como JSON:
   { sponsored_until, sponsored_at }. Campo já existia e não era usado na home. */
function parseBarSponsor(raw) {
  if (!raw || typeof raw !== 'string' || raw.charAt(0) !== '{') return null;
  try {
    const data = JSON.parse(raw);
    const until = new Date(data.sponsored_until);
    const at = new Date(data.sponsored_at || 0);
    if (Number.isNaN(until.getTime())) return null;
    return {
      until,
      at: Number.isNaN(at.getTime()) ? new Date(0) : at,
      active: until.getTime() > Date.now(),
    };
  } catch {
    return null;
  }
}

function _homeHasFilter() {
  const q = (document.getElementById('search-bars')?.value || '').trim();
  return !!(q || _homeFilters.benefit.size || _homeFilters.genre.size);
}

/* Sem filtro, patrocinados ativos sobem. Com filtro, a ordem da lista filtrada permanece. */
function _orderHomeBars(bars) {
  if (_homeHasFilter()) return bars;
  const sponsored = [];
  const rest = [];
  bars.forEach(bar => {
    const sponsor = parseBarSponsor(bar.featured_promo);
    if (sponsor?.active) sponsored.push(bar);
    else rest.push(bar);
  });
  sponsored.sort((a, b) => {
    const sa = parseBarSponsor(a.featured_promo);
    const sb = parseBarSponsor(b.featured_promo);
    return (sb?.at?.getTime() || 0) - (sa?.at?.getTime() || 0);
  });
  return sponsored.concat(rest);
}

let _homeViewMode = 'list';
try {
  const _savedHomeView = sessionStorage.getItem('oz_home_view');
  if (_savedHomeView === 'map' || _savedHomeView === 'list') _homeViewMode = _savedHomeView;
} catch { /* storage indisponível */ }
let _homeMap = null;
let _mapRenderToken = 0;
let _geoChain = Promise.resolve();
let _geoNextAt = 0;

function setHomeView(mode) {
  _homeViewMode = mode === 'map' ? 'map' : 'list';
  try { sessionStorage.setItem('oz_home_view', _homeViewMode); } catch { /* ignora */ }
  filterBars();
}

function _mapText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _barGeoQuery(bar) {
  const address = (bar.address || '').trim();
  if (!address) return '';
  const hood = (bar.neighborhood || '').trim();
  return [address, hood, 'São Paulo', 'Brasil'].filter(Boolean).join(', ');
}

function _readGeoCache() {
  try { return JSON.parse(localStorage.getItem('oz_bar_geo_v1') || '{}'); }
  catch { return {}; }
}

function _geocodeQuery(query) {
  const cached = _readGeoCache()[query];
  if (cached && Number.isFinite(cached.lat) && Number.isFinite(cached.lon)) {
    return Promise.resolve(cached);
  }
  const run = async () => {
    const again = _readGeoCache()[query];
    if (again && Number.isFinite(again.lat) && Number.isFinite(again.lon)) return again;
    const wait = Math.max(0, _geoNextAt - Date.now());
    _geoNextAt = Date.now() + wait + 1100;
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    const response = await fetch(
      'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&q=' + encodeURIComponent(query),
      { headers: { 'Accept-Language': 'pt-BR' } }
    );
    if (!response.ok) return null;
    const rows = await response.json();
    const hit = Array.isArray(rows) ? rows[0] : null;
    if (!hit) return null;
    const point = { lat: Number(hit.lat), lon: Number(hit.lon) };
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return null;
    const next = _readGeoCache();
    next[query] = point;
    try { localStorage.setItem('oz_bar_geo_v1', JSON.stringify(next)); } catch { /* ignora */ }
    return point;
  };
  const job = _geoChain.then(run, run);
  _geoChain = job.then(() => {}, () => {});
  return job;
}

function _destroyHomeMap() {
  if (_homeMap) {
    _homeMap.remove();
    _homeMap = null;
  }
}

function _mapPinIcon(sponsored) {
  return L.divIcon({
    className: 'oz-pin-wrap',
    html: `
      <div class="oz-pin${sponsored ? ' oz-pin-sponsored' : ''}">
        <span class="oz-pin-head"><i class="fa fa-martini-glass-citrus"></i></span>
        ${sponsored ? '<span class="oz-pin-star"><i class="fa fa-star"></i></span>' : ''}
        <span class="oz-pin-tail"></span>
      </div>`,
    iconSize: [34, 44],
    iconAnchor: [17, 42],
    popupAnchor: [0, -38],
  });
}

function _mapPopupHtml(bar) {
  const promo = (allPromos[bar.id] || [])[0];
  const benefit = promo ? (promo.title || bar.benefit || 'Benefício especial') : (bar.benefit || 'Benefício especial');
  const place = [bar.address, bar.neighborhood].filter(Boolean).join(' · ');
  const sponsor = parseBarSponsor(bar.featured_promo);
  return `
    <div class="oz-map-popup">
      ${sponsor?.active ? '<span class="oz-map-popup-sponsor">Patrocinado</span>' : ''}
      <strong>${_mapText(bar.name)}</strong>
      ${place ? `<span class="oz-map-popup-place">${_mapText(place)}</span>` : ''}
      <p>${_mapText(benefit)}</p>
      <button type="button" data-open-bar="1">Ver benefício</button>
    </div>`;
}

function _bindMapOpen(root, bar) {
  if (!root) return;
  root.querySelectorAll('[data-open-bar]').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openBarDetail(bar);
    });
  });
}

function _renderMapMissing(bars) {
  const box = document.getElementById('home-map-missing');
  if (!box) return;
  if (!bars.length) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = `
    <p class="home-map-missing-title">Sem endereço, fora do mapa</p>
    ${bars.map(bar => `
      <button type="button" class="home-map-missing-row" data-open-bar="1">
        <i class="fa fa-location-dot"></i>
        <span>${_mapText(bar.name)}</span>
      </button>`).join('')}`;
  box.querySelectorAll('.home-map-missing-row').forEach((btn, index) => {
    btn.addEventListener('click', () => openBarDetail(bars[index]));
  });
}

async function _renderHomeMap(bars) {
  const token = ++_mapRenderToken;
  const el = document.getElementById('home-bars-map');
  const status = document.getElementById('home-map-status');
  if (!el) return;
  if (typeof L === 'undefined') {
    if (status) status.textContent = 'O mapa não carregou. Use a lista por enquanto.';
    _renderMapMissing(bars);
    return;
  }

  _homeMap = L.map(el, { zoomControl: true, scrollWheelZoom: false })
    .setView([-23.5505, -46.6333], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19,
  }).addTo(_homeMap);
  if (status) status.textContent = 'Marcando os bares no mapa...';

  const located = [];
  const missing = [];
  await Promise.all(bars.map(async bar => {
    const query = _barGeoQuery(bar);
    if (!query) {
      missing.push(bar);
      return;
    }
    try {
      const point = await _geocodeQuery(query);
      if (point) located.push({ bar, point });
      else missing.push(bar);
    } catch {
      missing.push(bar);
    }
  }));
  if (token !== _mapRenderToken || !_homeMap) return;

  const bounds = [];
  located.forEach(({ bar, point }) => {
    const sponsor = parseBarSponsor(bar.featured_promo);
    const marker = L.marker([point.lat, point.lon], {
      icon: _mapPinIcon(!!sponsor?.active),
      title: bar.name,
      zIndexOffset: sponsor?.active ? 500 : 0,
    }).addTo(_homeMap);
    marker.bindPopup(_mapPopupHtml(bar), { closeButton: true, maxWidth: 240, minWidth: 180 });
    marker.on('popupopen', () => _bindMapOpen(marker.getPopup()?.getElement(), bar));
    bounds.push([point.lat, point.lon]);
  });

  if (bounds.length === 1) _homeMap.setView(bounds[0], 16);
  else if (bounds.length > 1) _homeMap.fitBounds(bounds, { padding: [48, 48], maxZoom: 18 });

  if (status) {
    status.textContent = located.length
      ? 'Toque no pino para ver o bar.'
      : 'Nenhum desses bares tem endereço para aparecer no mapa.';
  }
  _renderMapMissing(missing);
  requestAnimationFrame(() => { if (_homeMap && token === _mapRenderToken) _homeMap.invalidateSize(); });
}

function renderBars(bars) {
  const list  = document.getElementById('bars-list');
  const empty = document.getElementById('bars-empty');
  if (!list || !empty) return;
  _destroyHomeMap();
  list.innerHTML = '';
  if (!bars.length) { empty.style.display = 'flex'; return; }
  empty.style.display = 'none';
  bars = _orderHomeBars(bars);

  const isMap = _homeViewMode === 'map';
  list.innerHTML = `
    <div class="cine-section-header">
      <span class="cine-section-title"><i class="fa fa-bolt"></i> Ativo hoje</span>
      <div class="cine-section-actions">
        <div class="cine-view-toggle" role="group" aria-label="Como ver os bares">
          <button type="button" class="${isMap ? '' : 'active'}" onclick="setHomeView('list')">
            <i class="fa fa-list"></i> Lista
          </button>
          <button type="button" class="${isMap ? 'active' : ''}" onclick="setHomeView('map')">
            <i class="fa fa-map"></i> Mapa
          </button>
        </div>
        <span class="cine-section-count">${bars.length}</span>
      </div>
    </div>
    <div class="cine-cards-list" id="cine-all-list"${isMap ? ' style="display:none"' : ''}></div>
    <div class="home-map-panel" id="home-map-panel"${isMap ? '' : ' style="display:none"'}>
      <p class="home-map-status" id="home-map-status"></p>
      <div id="home-bars-map"></div>
      <div id="home-map-missing"></div>
    </div>`;

  if (isMap) _renderHomeMap(bars);
  else _renderCineList('cine-all-list', bars, allPromos);
}

/* Renderiza lista vertical de cards estilo cinema (full-width) */
function _renderCineList(containerId, bars, promoMap) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Garante que cada bar_id seja renderizado apenas uma vez
  const _rendered = new Set();

  bars.forEach(bar => {
    if (_rendered.has(bar.id)) return;
    _rendered.add(bar.id);
    const barPromos   = promoMap[bar.id] || [];
    const promoAtiva  = barPromos[0];
    const isScheduled = promoAtiva?._source === 'scheduled';
    const benefitText = promoAtiva ? (promoAtiva.title || bar.benefit || 'Benefício especial') : (bar.benefit || 'Benefício especial');
    const eventText   = promoAtiva?.event_tonight || promoAtiva?.event || bar.event_tonight;
    const genreLabel  = genreMap[bar.genre || bar.bar_genre] || '';
    const imgSrc      = bar.cover_url || bar.photo_url || DEF_IMG;
    const actCount    = bar.total_activations || 0;

    // Rating: usa cache pré-calculado no loadBars
    const ratingData  = (OZ._ratingsCache || {})[bar.id];
    const hasRating   = ratingData && ratingData.total > 0;
    const ratingAvg   = hasRating ? ratingData.avg.toFixed(1) : null;
    const ratingTotal = hasRating ? ratingData.total : 0;

    // Monta HTML das estrelas (apenas cheias + meia)
    const ratingHtml = hasRating ? (() => {
      const f = Math.floor(ratingData.avg);
      const h = ratingData.avg - f >= 0.5;
      return Array.from({ length: 5 }, (_, i) =>
        `<i class="${i < f ? 'fa fa-star' : i === f && h ? 'fa fa-star-half-alt' : 'far fa-star'}"></i>`
      ).join('');
    })() : '';

    // Verifica se o benefício atingiu o limite de ativações
    const _maxA = promoAtiva?.max_activations || 0;
    const _curA = promoAtiva?.activations_count || 0;
    const isFull = _maxA > 0 && _curA >= _maxA;

    // Badge: ATIVO (verde) para promo live, HOJE (âmbar) para agendado, ESGOTADO se cheio
    const sponsor = parseBarSponsor(bar.featured_promo);
    const isSponsored = !!sponsor?.active;
    const badgeHtml = isFull
      ? `<span class="cine-live-badge cine-live-badge-full"><i class="fa fa-ban"></i> ESGOTADO</span>`
      : isScheduled
        ? `<span class="cine-live-badge cine-live-badge-sched"><i class="fa fa-calendar-check"></i> HOJE</span>`
        : `<span class="cine-live-badge"><i class="fa fa-bolt"></i> ATIVO</span>`;
    const sponsorHtml = isSponsored
      ? `<span class="cine-sponsor-badge"><i class="fa fa-bullhorn"></i> Patrocinado</span>`
      : '';

    const slotsHtml = _maxA > 0
      ? `<span class="cine-meta-dot">·</span><span class="cine-meta-item cine-slots${isFull ? ' cine-slots-full' : ''}"><i class="fa fa-users"></i> ${isFull ? 'Esgotado' : `${Math.max(0, _maxA - _curA)} vagas`}</span>`
      : '';

    const card = document.createElement('div');
    card.className = `cine-card${isScheduled ? ' cine-card-sched' : ''}${isFull ? ' cine-card-full' : ''}${isSponsored ? ' cine-card-sponsored' : ''}`;
    card.innerHTML = `
      <div class="cine-card-img-wrap">
        <img class="cine-card-img" src="${imgSrc}" alt="${bar.name}" loading="lazy" onerror="this.src='${DEF_IMG}'"/>
        <div class="cine-card-img-overlay"></div>
        ${badgeHtml}
        ${sponsorHtml}
        ${genreLabel ? `<span class="cine-genre-badge">${genreLabel}</span>` : ''}
      </div>
      <div class="cine-card-body">
        <p class="cine-card-studio">OZ · Benefício exclusivo</p>
        <h3 class="cine-card-title">${bar.name}</h3>
        ${hasRating ? `
        <div class="cine-card-rating">
          <div class="cine-rating-stars">${ratingHtml}</div>
          <span class="cine-rating-avg">${ratingAvg}</span>
          <span class="cine-rating-count">(${ratingTotal})</span>
        </div>` : ''}
        <div class="cine-card-meta">
          <span class="cine-meta-item"><i class="fa fa-map-marker-alt"></i> ${bar.neighborhood || '—'}</span>
          <span class="cine-meta-dot">·</span>
          <span class="cine-meta-item"><i class="fa fa-bolt"></i> ${actCount} ativações</span>
          ${eventText ? `<span class="cine-meta-dot">·</span><span class="cine-meta-item cine-meta-music"><i class="fa fa-music"></i> Ao vivo</span>` : ''}
          ${slotsHtml}
        </div>
        ${isFull
          ? `<p class="cine-card-desc cine-card-desc-full"><i class="fa fa-ban" style="margin-right:5px;opacity:.6"></i>Todas as ${_maxA} vaga${_maxA !== 1 ? 's foram' : ' foi'} preenchida${_maxA !== 1 ? 's' : ''}. Benefício indisponível.</p>`
          : `<p class="cine-card-desc">${benefitText}${eventText ? ' · ' + eventText : ''}</p>`
        }
        <button class="cine-btn-activate${isFull ? ' cine-btn-full' : ''}" ${isFull ? 'disabled' : ''}>
          ${isFull ? '<i class="fa fa-ban"></i> Vagas esgotadas' : '<i class="fa fa-ticket-alt"></i> Ver benefício'}
        </button>
      </div>`;
    card.querySelector('.cine-btn-activate').addEventListener('click', (e) => { e.stopPropagation(); if (!isFull) openBarDetail(bar); });
    card.addEventListener('click', () => openBarDetail(bar));
    container.appendChild(card);
  });
}

// ── Estado dos filtros da home ────────────────────────────────────────────────
// Cada Set armazena os valores selecionados. Vazio = sem filtro ativo.
const _homeFilters = {
  benefit: new Set(), // ex: 'Comidinha', 'Bebida', 'Entrada VIP', 'Desconto', 'Outros'
  genre:   new Set(), // ex: 'balada', 'rooftop'
};

/**
 * Abre/fecha o painel de opções de um grupo de filtro.
 * @param {string} optsPanelId - id do elemento .hf-options
 */
function toggleFilterGroup(optsPanelId) {
  const panel  = document.getElementById(optsPanelId);
  const isOpen = panel && panel.style.display !== 'none';
  // Determina o botão toggle correspondente
  const toggleId = optsPanelId === 'hf-benefit-opts' ? 'hf-benefit-toggle' : 'hf-genre-toggle';
  const toggleBtn = document.getElementById(toggleId);
  if (panel) panel.style.display = isOpen ? 'none' : 'flex';
  if (toggleBtn) toggleBtn.classList.toggle('open', !isOpen);
}

/**
 * Marca/desmarca um chip de filtro e re-aplica o filtro.
 * @param {HTMLElement} chip
 */
function toggleFilterChip(chip) {
  const filterType = chip.dataset.filter; // 'benefit' ou 'genre'
  const value      = chip.dataset.value;
  if (!filterType || !value) return;

  const set = _homeFilters[filterType];
  if (set.has(value)) {
    set.delete(value);
    chip.classList.remove('active');
  } else {
    set.add(value);
    chip.classList.add('active');
  }

  _updateFilterCountBadge(filterType);
  _updateClearBtn();
  filterBars();
}

/** Atualiza o contador numérico no botão de toggle do grupo */
function _updateFilterCountBadge(filterType) {
  const countId = filterType === 'benefit' ? 'hf-benefit-count' : 'hf-genre-count';
  const el = document.getElementById(countId);
  if (!el) return;
  const n = _homeFilters[filterType].size;
  el.textContent = n;
  el.style.display = n > 0 ? 'inline-flex' : 'none';
}

/** Mostra/esconde o botão "Limpar filtros" */
function _updateClearBtn() {
  const btn = document.getElementById('hf-clear-btn');
  if (!btn) return;
  const hasAny = _homeFilters.benefit.size > 0 || _homeFilters.genre.size > 0;
  btn.style.display = hasAny ? 'inline-flex' : 'none';
}

/** Remove todos os filtros ativos e re-renderiza */
function clearAllFilters() {
  _homeFilters.benefit.clear();
  _homeFilters.genre.clear();
  // Remove classe active de todos os chips
  document.querySelectorAll('.hf-chip.active').forEach(c => c.classList.remove('active'));
  _updateFilterCountBadge('benefit');
  _updateFilterCountBadge('genre');
  _updateClearBtn();
  filterBars();
}

function filterBars() {
  const q       = (document.getElementById('search-bars')?.value || '').toLowerCase();
  const genres  = _homeFilters.genre;
  const benefits = _homeFilters.benefit;

  // Sem nenhum filtro ativo — renderiza tudo
  if (!q && genres.size === 0 && benefits.size === 0) {
    renderBars(allBars);
    return;
  }

  const filtered = allBars.filter(b => {
    // Filtro de texto (nome ou bairro)
    if (q) {
      const matchText = b.name.toLowerCase().includes(q) ||
                        (b.neighborhood || '').toLowerCase().includes(q);
      if (!matchText) return false;
    }

    // Filtro por tipo de bar (gênero) — múltipla seleção = OR
    if (genres.size > 0) {
      const barGenre = b.genre || '';
      if (!genres.has(barGenre)) return false;
    }

    // Filtro por tipo de benefício — múltipla seleção = OR
    if (benefits.size > 0) {
      const promo = (allPromos[b.id] || [])[0];
      const category = promo?.category || '';
      if (!benefits.has(category)) return false;
    }

    return true;
  });

  renderBars(filtered);
}

/* ══════════════════════════════════
   DETALHE DO BAR
══════════════════════════════════ */
async function openBarDetail(bar) {
  OZ.exploreReadOnly = false;          // modo normal
  OZ._schedContext   = null;           // limpa contexto de agendamento se houver
  OZ.currentBar = bar;
  OZ.previousScreen = 'screen-home';
  // Limpa pick ativo se o bar aberto é diferente do bar do pick
  // (garante que pick só vale para o bar específico cujo card foi clicado)
  if (OZ._activePickPromoter && OZ._pickBarId && OZ._pickBarId !== bar.id) {
    OZ._activePickPromoter = null;
    OZ._pickBarId = null;
  }
  // Se abriu diretamente (sem pick), garante limpeza
  if (!OZ._activePickPromoter) OZ._pickBarId = null;

  // ── Exibe a tela imediatamente com dados já disponíveis ──
  showScreen('screen-bar-detail');

  // ── Preenche com os dados que já temos (podem não ter foto ainda) ──
  _fillBarDetailUI(bar);

  // ── Busca dados atualizados da tabela (garante foto mais recente) ──
  if (bar.id && !bar.id.startsWith('fb')) {
    try {
      const freshBar = await apiGet(`tables/bars/${bar.id}`);
      // Mescla: mantém campos do objeto original + sobrescreve com API
      const merged = { ...bar, ...freshBar };
      OZ.currentBar = merged;
      _fillBarDetailUI(merged, false); // não reseta abas na atualização silenciosa
    } catch { /* mantém dados existentes */ }
  }

  // ── Carrega promoções, agendamentos e estado de like ──
  await Promise.all([
    loadBarDetailPromos(OZ.currentBar),
    loadBarScheduledBenefits(OZ.currentBar),
    loadBarLikeState(),
  ]);
}

/* ── Abre o detalhe do bar no contexto de um benefício agendado ── */
async function openBarDetailForSched(bar, sched) {
  // Sobrescreve o allPromos do bar temporariamente com o benefício agendado,
  // para que loadBarDetailPromos exiba o benefício correto e não o ativo de hoje.
  OZ._schedContext = sched; // guarda referência para restaurar depois
  allPromos[bar.id] = [{
    ...sched,
    _source: 'scheduled',
    title:       sched.title       || bar.benefit || 'Benefício especial',
    description: sched.description || '',
    event_tonight: sched.event     || '',
  }];

  OZ.exploreReadOnly = false;
  OZ.currentBar      = bar;
  OZ.previousScreen  = 'screen-home';
  // Preserva o pick promoter antes de zerar (usado em confirmActivation)
  if (OZ._activePickPromoter) OZ._pendingPickPromoter = OZ._activePickPromoter;
  OZ._activePickPromoter = null;
  OZ._pickBarId          = null;

  showScreen('screen-bar-detail');
  _fillBarDetailUI(bar);

  if (bar.id && !bar.id.startsWith('fb')) {
    try {
      const freshBar = await apiGet(`tables/bars/${bar.id}`);
      const merged   = { ...bar, ...freshBar };
      OZ.currentBar  = merged;
      _fillBarDetailUI(merged, false);
    } catch { /* mantém dados existentes */ }
  }

  await Promise.all([
    loadBarDetailPromos(OZ.currentBar),
    loadBarScheduledBenefits(OZ.currentBar),
    loadBarLikeState(),
  ]);
}

/* ── Abre o detalhe do bar em modo READ-ONLY (aba Explorar do bar) ── */
async function openBarDetailReadOnly(bar) {
  OZ.exploreReadOnly = true;           // sinaliza modo visualização
  OZ.currentBar      = bar;
  OZ.previousScreen  = 'screen-bar-panel'; // volta para o painel do bar
  // Modo leitura do bar owner — sem pick commission
  OZ._activePickPromoter = null;
  OZ._pickBarId          = null;

  showScreen('screen-bar-detail');
  _fillBarDetailUI(bar);

  if (bar.id && !bar.id.startsWith('fb')) {
    try {
      const freshBar = await apiGet(`tables/bars/${bar.id}`);
      const merged   = { ...bar, ...freshBar };
      OZ.currentBar  = merged;
      _fillBarDetailUI(merged, false); // não reseta abas na atualização silenciosa
    } catch { /* mantém dados existentes */ }
  }

  await Promise.all([
    loadBarDetailPromos(OZ.currentBar),
    loadBarScheduledBenefits(OZ.currentBar),
    _loadBarRatingTop(OZ.currentBar.id),
  ]);
}

/* ── Preenche todos os elementos visuais do detalhe do bar ── */
function _fillBarDetailUI(bar, resetTabs = true) {
  // Hero: usa cover_url (capa) ou fallback para photo_url
  const hero = document.getElementById('bar-hero-img');
  if (hero) {
    const heroUrl = bar.cover_url || bar.photo_url || bar.bar_photo || '';
    if (heroUrl) {
      hero.style.backgroundImage    = `url('${heroUrl}')`;
      hero.style.backgroundSize     = 'cover';
      hero.style.backgroundPosition = 'center';
      hero.style.backgroundColor    = 'var(--black-3)';
    } else {
      hero.style.backgroundImage = 'linear-gradient(135deg, #1a0520 0%, #2d1b00 50%, #0f0a00 100%)';
    }
  }

  // Avatar flutuante (logo/photo_url do bar)
  const dpAvatar = document.getElementById('dp-bar-avatar-img');
  if (dpAvatar) {
    const avatarUrl = bar.photo_url || bar.bar_photo || bar.cover_url || '';
    if (avatarUrl) {
      dpAvatar.style.backgroundImage = `url('${avatarUrl}')`;
      dpAvatar.style.backgroundSize  = 'cover';
      dpAvatar.style.backgroundPosition = 'center';
      dpAvatar.innerHTML = '';
    } else {
      dpAvatar.style.backgroundImage = '';
      dpAvatar.innerHTML = '<i class="fa fa-store"></i>';
    }
  }

  // Nome, bairro, gênero
  const nameEl = document.getElementById('bar-detail-name');
  if (nameEl) nameEl.textContent = bar.name || bar.bar_name || 'Bar';

  const hoodEl = document.getElementById('bar-detail-hood-span');
  if (hoodEl) hoodEl.textContent = bar.neighborhood || bar.bar_neighborhood || '';

  const genreEl    = document.getElementById('bar-hero-genre');
  const genreLabel = genreMap[bar.genre || bar.bar_genre] || bar.genre || '';
  if (genreEl) {
    genreEl.textContent   = genreLabel;
    genreEl.style.display = genreLabel ? '' : 'none';
  }

  // Grid de informações rápidas (Horário de pico removido)
  const infoGenre = document.getElementById('bd-info-genre');
  const infoHood  = document.getElementById('bd-info-hood');
  const infoActs  = document.getElementById('bd-info-acts');
  if (infoGenre) infoGenre.textContent = genreLabel || '—';
  if (infoHood)  infoHood.textContent  = bar.neighborhood || bar.bar_neighborhood || '—';
  if (infoActs)  infoActs.textContent  = bar.total_activations || bar.activations || '0';

  // Instagram
  const igLink   = document.getElementById('bar-instagram-link');
  const igHandle = document.getElementById('bar-instagram-handle');
  const ig = bar.instagram || bar.bar_instagram || '';
  if (ig && igLink) {
    igHandle.textContent = `@${ig}`;
    igLink.href          = `https://instagram.com/${ig}`;
    igLink.style.display = 'inline-flex';
  } else if (igLink) { igLink.style.display = 'none'; }

  // Sobre o bar
  const releaseBlock = document.getElementById('bar-release-block');
  const releaseText  = document.getElementById('bar-release-text');
  const rel = bar.release || bar.description || bar.about || '';
  if (releaseBlock) {
    if (rel) {
      releaseText.textContent    = rel;
      releaseBlock.style.display = 'block';
    } else {
      releaseBlock.style.display = 'none';
    }
  }

  // ── Galeria de fotos ──
  const gallerySection = document.getElementById('bar-gallery-section');
  const galleryScroll  = document.getElementById('bar-gallery-scroll');
  const gallery = Array.isArray(bar.gallery) ? bar.gallery.filter(Boolean) : [];
  if (gallerySection && galleryScroll) {
    if (gallery.length) {
      galleryScroll.innerHTML = '';
      gallery.forEach((url, i) => {
        const img = document.createElement('img');
        img.src     = url;
        img.alt     = `Foto ${i + 1}`;
        img.loading = 'lazy';
        img.className = 'bdv2-gallery-img';
        img.onclick = () => openGalleryModal(gallery, i);
        galleryScroll.appendChild(img);
      });
      gallerySection.style.display = 'block';
    } else {
      gallerySection.style.display = 'none';
    }
  }

  // ── Infos extras: horário, endereço, whatsapp ──
  const rowHours    = document.getElementById('bd-row-hours');
  const rowAddress  = document.getElementById('bd-row-address');
  const rowWhatsapp = document.getElementById('bd-row-whatsapp');

  const hours    = bar.hours    || '';
  const address  = bar.address  || '';
  const whatsapp = bar.whatsapp || '';

  if (rowHours) {
    if (hours) {
      document.getElementById('bd-info-hours').textContent = hours;
      rowHours.style.display = 'flex';
    } else { rowHours.style.display = 'none'; }
  }

  if (rowAddress) {
    if (address) {
      document.getElementById('bd-info-address').textContent = address;
      const mapsLink = document.getElementById('bd-maps-link');
      if (mapsLink) mapsLink.href = `https://maps.google.com/?q=${encodeURIComponent(address)}`;
      rowAddress.style.display = 'flex';
    } else { rowAddress.style.display = 'none'; }
  }

  if (rowWhatsapp) {
    if (whatsapp) {
      document.getElementById('bd-info-whatsapp').textContent = whatsapp;
      const waLink = document.getElementById('bd-whatsapp-link');
      if (waLink) waLink.href = `https://wa.me/${whatsapp.replace(/\D/g,'')}`;
      rowWhatsapp.style.display = 'flex';
    } else { rowWhatsapp.style.display = 'none'; }
  }

  // Reset de abas para 'sobre' (só na primeira abertura)
  if (resetTabs) switchBarDetailTab('sobre');

  // Avaliações — carrega nota real imediatamente (aparece no topo da ficha)
  _loadBarRatingTop(bar.id);

  // Botão favorito
  const isFav  = OZ.favoriteBars.includes(bar.id);
  const favBtn  = document.getElementById('btn-favorite-bar');
  const favIcon = document.getElementById('fav-icon');
  if (favBtn)  favBtn.className  = isFav ? 'dp-btn-fav favorited' : 'dp-btn-fav';
  if (favIcon) favIcon.className = isFav ? 'fa fa-heart' : 'fa fa-heart';
  // Ícone favorito secundário
  const favIcon2 = document.getElementById('dp-fav-icon2');
  if (favIcon2) favIcon2.style.color = isFav ? '#ef4444' : '';

  // ── Modo read-only (aba Explorar do bar) ──────────────────
  const btnActivateMain = document.getElementById('dp-btn-activate-main');
  const existingBanner  = document.getElementById('dp-readonly-banner-el');

  // Subtítulo do card de benefício (sempre não-clicável, só muda o texto)
  const execBenefitSub = document.getElementById('exec-benefit-sub-text');

  if (OZ.exploreReadOnly) {
    if (btnActivateMain) btnActivateMain.style.display = 'none';
    if (execBenefitSub) execBenefitSub.textContent = 'Benefício exclusivo OZ · Ativo agora';
    if (!existingBanner) {
      const banner = document.createElement('div');
      banner.id        = 'dp-readonly-banner-el';
      banner.className = 'dp-readonly-banner';
      banner.innerHTML = `<i class="fa fa-eye"></i> Modo visualização — ativação disponível apenas para clientes`;
      const ctaWrap = document.querySelector('.dp-benefit-premium-wrap') || document.querySelector('.dp-cta-wrap');
      if (ctaWrap) ctaWrap.insertBefore(banner, ctaWrap.firstChild);
    } else {
      existingBanner.style.display = 'flex';
    }
  } else {
    const _promoDetail   = (allPromos[bar.id] || [])[0];
    const _isSchedCtx    = _promoDetail?._source === 'scheduled';
    const _maxDetail     = _promoDetail?.max_activations || 0;
    const _curDetail     = _promoDetail?.activations_count || 0;
    // Esgotado se atingiu o limite — vale tanto para live quanto para agendado de hoje
    const _fullDetail    = _maxDetail > 0 && _curDetail >= _maxDetail;

    if (_isSchedCtx && !_fullDetail) {
      // Benefício agendado para hoje (ainda com vagas) — botão "Ativar" abre o modal padrão
      if (btnActivateMain) {
        btnActivateMain.disabled         = false;
        btnActivateMain.innerHTML        = '<i class="fa fa-bolt"></i><span>Ativar</span>';
        btnActivateMain.style.background = '';
        btnActivateMain.style.color      = '';
        btnActivateMain.style.boxShadow  = '';
        btnActivateMain.style.cursor     = '';
        btnActivateMain.onclick          = openActivateModal;
      }
      // Formata a data agendada para exibir no subtítulo
      const [sy, smo, sd] = (_promoDetail?._schedDate || '').split('-');
      const schedDt = sy ? new Date(parseInt(sy), parseInt(smo)-1, parseInt(sd)) : null;
      const schedLabel = schedDt
        ? schedDt.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
        : 'Data agendada';
      if (execBenefitSub) execBenefitSub.textContent = `Benefício agendado · ${schedLabel.charAt(0).toUpperCase() + schedLabel.slice(1)}`;
    } else if (_fullDetail) {
      // ── Benefício esgotado: atualiza todo o card de anúncio ──

      // Eyebrow: troca label e cor
      const _eyebrow    = document.querySelector('.dp-benefit-eyebrow');
      const _eyebrowDot = document.querySelector('.dp-benefit-eyebrow-dot');
      const _eyebrowTxt = _eyebrow?.querySelector('span:last-child');
      if (_eyebrowTxt)  _eyebrowTxt.textContent         = 'VAGAS ESGOTADAS';
      if (_eyebrowDot)  _eyebrowDot.style.cssText       = 'background:#6b7280;box-shadow:none;animation:none';
      if (_eyebrow)     _eyebrow.style.color            = 'rgba(156,163,175,.7)';

      // Card principal: visual cinza/apagado
      const _card     = document.getElementById('exec-benefit-card-main');
      const _cardIcon = _card?.querySelector('.dp-benefit-premium-icon');
      const _liveDot  = _card?.querySelector('.dp-benefit-live-dot');
      if (_card) {
        _card.style.borderColor = 'rgba(107,114,128,.2)';
        _card.style.opacity     = '0.65';
      }
      if (_cardIcon) {
        _cardIcon.style.background = 'rgba(107,114,128,.15)';
        _cardIcon.style.borderColor = 'rgba(107,114,128,.2)';
        _cardIcon.style.color = 'rgba(156,163,175,.6)';
        _cardIcon.innerHTML = '<i class="fa fa-ban"></i>';
      }
      if (_liveDot) {
        _liveDot.style.background  = '#6b7280';
        _liveDot.style.boxShadow   = 'none';
        _liveDot.style.animation   = 'none';
      }

      // Título e subtítulo
      const _benefitTitle = document.getElementById('bar-benefit-text');
      if (_benefitTitle) _benefitTitle.style.color = 'rgba(156,163,175,.7)';
      if (execBenefitSub) {
        execBenefitSub.textContent = `Todas as ${_maxDetail} vaga${_maxDetail !== 1 ? 's foram' : ' foi'} preenchida${_maxDetail !== 1 ? 's' : ''}. Benefício indisponível.`;
        execBenefitSub.style.color = 'rgba(248,113,113,.7)';
      }

      // Botão desabilitado
      if (btnActivateMain) {
        btnActivateMain.disabled         = true;
        btnActivateMain.innerHTML        = '<i class="fa fa-ban"></i><span>Vagas esgotadas</span>';
        btnActivateMain.style.background = 'rgba(107,114,128,.25)';
        btnActivateMain.style.color      = 'rgba(255,255,255,.35)';
        btnActivateMain.style.boxShadow  = 'none';
        btnActivateMain.style.cursor     = 'not-allowed';
        btnActivateMain.onclick          = null;
      }
    } else {
      // ── Benefício ativo normal: restaura visual padrão ──
      const _eyebrow    = document.querySelector('.dp-benefit-eyebrow');
      const _eyebrowDot = document.querySelector('.dp-benefit-eyebrow-dot');
      const _eyebrowTxt = _eyebrow?.querySelector('span:last-child');
      if (_eyebrowTxt)  _eyebrowTxt.textContent   = 'BENEFÍCIO DESTA NOITE';
      if (_eyebrowDot)  _eyebrowDot.style.cssText  = '';
      if (_eyebrow)     _eyebrow.style.color       = '';

      const _card     = document.getElementById('exec-benefit-card-main');
      const _cardIcon = _card?.querySelector('.dp-benefit-premium-icon');
      const _liveDot  = _card?.querySelector('.dp-benefit-live-dot');
      if (_card)     { _card.style.borderColor = ''; _card.style.opacity = ''; }
      if (_cardIcon) { _cardIcon.style.cssText = ''; _cardIcon.innerHTML = '<i class="fa fa-gift"></i>'; }
      if (_liveDot)  { _liveDot.style.cssText  = ''; }

      const _benefitTitle = document.getElementById('bar-benefit-text');
      if (_benefitTitle) _benefitTitle.style.color = '';
      if (execBenefitSub) { execBenefitSub.textContent = 'Benefício exclusivo OZ · Ativo agora'; execBenefitSub.style.color = ''; }

      if (btnActivateMain) {
        btnActivateMain.disabled         = false;
        btnActivateMain.innerHTML        = '<i class="fa fa-bolt"></i><span>Ativar benefício</span>';
        btnActivateMain.style.background = '';
        btnActivateMain.style.color      = '';
        btnActivateMain.style.boxShadow  = '';
        btnActivateMain.style.cursor     = '';
        btnActivateMain.onclick          = openActivateModal;
      }
    }
    if (existingBanner) existingBanner.style.display = 'none';
  }
}

/* ── Modal de galeria (visualização em tela cheia) ── */
function openGalleryModal(photos, startIdx = 0) {
  // Remove modal anterior se existir
  const old = document.getElementById('oz-gallery-modal');
  if (old) old.remove();

  let current = startIdx;

  const overlay = document.createElement('div');
  overlay.id = 'oz-gallery-modal';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:99999;
    background:rgba(0,0,0,0.95);
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    touch-action:none;
  `;

  const img = document.createElement('img');
  img.style.cssText = `
    max-width:96vw;max-height:82vh;object-fit:contain;
    border-radius:10px;transition:opacity 0.18s;
  `;

  const counter = document.createElement('div');
  counter.style.cssText = `
    color:rgba(255,255,255,0.55);font-size:13px;margin-top:14px;font-weight:600;
  `;

  function show(idx) {
    img.style.opacity = '0';
    setTimeout(() => {
      img.src = photos[idx];
      img.style.opacity = '1';
      counter.textContent = `${idx + 1} / ${photos.length}`;
    }, 120);
  }

  // Botão fechar
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '<i class="fa fa-times"></i>';
  closeBtn.style.cssText = `
    position:absolute;top:16px;right:16px;
    background:rgba(255,255,255,0.12);border:none;
    color:#fff;width:38px;height:38px;border-radius:50%;
    font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;
  `;
  closeBtn.onclick = () => overlay.remove();

  // Setas (só se mais de 1 foto)
  if (photos.length > 1) {
    const prev = document.createElement('button');
    prev.innerHTML = '<i class="fa fa-chevron-left"></i>';
    prev.style.cssText = `position:absolute;left:10px;top:50%;transform:translateY(-50%);
      background:rgba(255,255,255,0.12);border:none;color:#fff;
      width:42px;height:42px;border-radius:50%;font-size:18px;cursor:pointer;
      display:flex;align-items:center;justify-content:center;`;
    prev.onclick = () => { current = (current - 1 + photos.length) % photos.length; show(current); };

    const next = document.createElement('button');
    next.innerHTML = '<i class="fa fa-chevron-right"></i>';
    next.style.cssText = prev.style.cssText.replace('left:10px', 'right:10px').replace('left', 'right');
    next.onclick = () => { current = (current + 1) % photos.length; show(current); };

    overlay.appendChild(prev);
    overlay.appendChild(next);
  }

  overlay.appendChild(closeBtn);
  overlay.appendChild(img);
  overlay.appendChild(counter);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
  show(current);
}

/* ── Troca de abas na página de detalhe do bar ── */
function switchBarDetailTab(tab) {
  // abas
  ['sobre', 'promocoes', 'avaliacoes'].forEach(t => {
    const btn  = document.getElementById(`bdtab-${t}`);
    const pane = document.getElementById(`bdcontent-${t}`);
    if (btn)  btn.classList.toggle('active', t === tab);
    if (pane) pane.classList.toggle('active', t === tab);
  });
  // Quando abre benefícios, re-renderiza se já carregado; senão inicializa
  if (tab === 'promocoes' && OZ.currentBar) {
    const barId = String(OZ.currentBar.id);
    if (OZ._cbc && OZ._cbc._barId === barId && OZ._cbc._loaded) {
      // Dados já carregados para este bar — só re-renderiza
      cbcRender();
    } else if (!OZ._cbc || !OZ._cbc._loading) {
      // Só inicia se não estiver em loading (evita dupla chamada)
      cbcInit(OZ.currentBar);
    }
  }
  // Quando abre avaliações, garante que os reviews estejam carregados
  if (tab === 'avaliacoes' && OZ.currentBar) {
    renderBarRatings(OZ.currentBar);
  }
}

/* ── Compartilhar bar ── */
function shareBar() {
  const bar = OZ.currentBar;
  if (!bar) return;
  if (navigator.share) {
    navigator.share({
      title: bar.name,
      text: `Conheça o ${bar.name} no OZ! 🍻`,
      url: window.location.href
    }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(`${bar.name} — no app OZ: ${window.location.href}`);
    showToast('Link copiado! 📋', 'success');
  }
}

/* ── Carrega promoções ativas do bar no detalhe do cliente ── */
async function loadBarDetailPromos(bar) {
  const benefitEl   = document.getElementById('bar-benefit-text');
  const attractCard = document.getElementById('bar-attraction-card');
  const attractText = document.getElementById('bar-event-text');
  // bar-promotions-section foi removido no novo layout; usa diretamente a lista
  const promoList   = document.getElementById('bar-promotions-list');
  const featBlock   = document.getElementById('bar-featured-promo');
  const featText    = document.getElementById('bar-featured-promo-text');

  // Se estiver no contexto de um benefício agendado, usa ele diretamente
  // e limpa o contexto para não afetar aberturas futuras
  let promos = allPromos[bar.id] || [];
  const _inSchedCtx = OZ._schedContext && promos[0]?._source === 'scheduled' &&
                      promos[0]?.id === OZ._schedContext.id;
  if (_inSchedCtx) {
    OZ._schedContext = null; // contexto consumido
    // Não busca promoções ativas da API — exibe apenas o benefício agendado
  } else if (!promos.length && bar.id && !bar.id.startsWith('fb')) {
    // Se o mapa estiver vazio (acesso direto ao detalhe), busca da API.
    // 1) Tenta promoções ao vivo
    try {
      const res = await apiGet(`tables/promotions?limit=50`);
      promos = (res.data || []).filter(p => p.bar_id === bar.id && isPromoActive(p));
      allPromos[bar.id] = promos;
    } catch { promos = []; }

    // 2) Se ainda vazio, verifica benefícios agendados para hoje
    //    (promoter não roda loadBars, então allPromos pode estar vazio para
    //    bares que só têm scheduled benefit — fallback para a API)
    if (!promos.length) {
      try {
        const todayKey = _todayStr();
        // Primeiro tenta o cache do promoter explore (zero custo de rede)
        const cached = OZ._prxExplorePromos?.[bar.id];
        if (cached && cached.length) {
          promos = cached;
          allPromos[bar.id] = promos;
        } else {
          // Fallback: busca na API
          const sr = await apiGet(`tables/scheduled_benefits?limit=50`);
          const sched = (sr.data || []).find(s =>
            String(s.bar_id) === String(bar.id) &&
            s.date === todayKey &&
            s.active !== false
          );
          if (sched) {
            promos = [{
              id:               sched.id,
              bar_id:           sched.bar_id,
              title:            sched.title,
              description:      sched.description || '',
              event_tonight:    sched.event || '',
              max_activations:  sched.max_activations || 0,
              activations_count: sched.activations_count || 0,
              active:           true,
              _source:          'scheduled',
              _schedDate:       sched.date,
            }];
            allPromos[bar.id] = promos;
          }
        }
      } catch { /* mantém promos vazio — exibe estado sem benefício */ }
    }
  }

  // Promo principal (a mais recente)
  const promoAtiva = promos[0];

  // Benefício: título da promoção ativa ou fallback do cadastro
  if (benefitEl) {
    benefitEl.textContent = promoAtiva
      ? promoAtiva.title
      : (bar.benefit || 'Nenhum benefício ativo no momento');
  }

  // Atração do dia: da promoção ativa ou do cadastro
  const eventText = promoAtiva?.event_tonight || bar.event_tonight;
  if (attractCard) {
    if (eventText) {
      attractText.textContent = eventText;
      attractCard.style.display = 'flex';
    } else {
      attractCard.style.display = 'none';
    }
  }

  // Promoção em destaque (primeira promoção ativa)
  if (featBlock) {
    if (promoAtiva) {
      featText.textContent = promoAtiva.description || promoAtiva.title;
      featBlock.style.display = 'flex';
    } else {
      featBlock.style.display = 'none';
    }
  }

  // Renderiza lista de benefícios na aba "Benefícios"
  if (promoList) {
    if (promos.length > 0) {
      const typeIcons = {
        drink_free:   { icon: 'fa-wine-glass-alt', color: '#a78bfa', label: 'Drink grátis'   },
        shot_free:    { icon: 'fa-prescription-bottle', color: '#fb923c', label: 'Shot grátis'   },
        beer_free:    { icon: 'fa-beer',            color: '#fbbf24', label: 'Cerveja grátis' },
        discount:     { icon: 'fa-percent',         color: '#34d399', label: 'Desconto'       },
        vip_entry:    { icon: 'fa-star',            color: '#f472b6', label: 'Entrada VIP'    },
        food_free:    { icon: 'fa-utensils',        color: '#60a5fa', label: 'Petisco grátis' },
        livre:        { icon: 'fa-gift',            color: '#00F5FF', label: 'Benefício'      },
      };
      promoList.innerHTML = promos.map(p => {
        const t = typeIcons[p.benefit_type] || typeIcons.livre;
        return `
        <div class="dpc-card">
          <div class="dpc-icon-wrap" style="background:${t.color}22;color:${t.color}">
            <i class="fa ${t.icon}"></i>
          </div>
          <div class="dpc-body">
            <div class="dpc-top-row">
              <span class="dpc-title">${p.title}</span>
              <span class="dpc-badge" style="background:${t.color}22;color:${t.color}">${t.label}</span>
            </div>
            ${p.description ? `<p class="dpc-desc">${p.description}</p>` : ''}
            <div class="dpc-meta-row">
              ${p.valid_from ? `<span class="dpc-meta"><i class="fa fa-play-circle"></i> A partir das ${p.valid_from}</span>` : ''}
              ${p.event_tonight ? `<span class="dpc-meta"><i class="fa fa-music"></i> ${p.event_tonight}</span>` : ''}
            </div>
          </div>
        </div>`;
      }).join('');
    } else {
      promoList.innerHTML = `
        <div class="bdv2-empty-state">
          <i class="fa fa-tags"></i>
          <p>Nenhum benefício ativo agora.</p>
        </div>`;
    }
  }
}

/* ══════════════════════════════════
   BENEFÍCIOS AGENDADOS — CLIENTE
   Wrapper: delega tudo ao cbcInit
══════════════════════════════════ */
async function loadBarScheduledBenefits(bar) {
  // Toda a lógica está em cbcInit — basta chamá-lo e aguardar
  await cbcInit(bar);
}

/* ══════════════════════════════════════════════════════════════
   CALENDÁRIO DO CLIENTE — CBC (Client Benefit Calendar)
   Mostra todos os benefícios agendados do bar no detalhe do cliente.
   Verde = ativo hoje · Dourado = agendado futuro
══════════════════════════════════════════════════════════════ */

// Estado do calendário do cliente
OZ._cbc = {
  year:         new Date().getFullYear(),
  month:        new Date().getMonth(),
  selectedDate: null,
  schedules:    [],           // [{id, date, title, description, event, max_activations, reservations_count}]
  userReserved: {},           // {scheduleId: true}
  todayStr:     '',
  activeToday:  false,        // se há benefício real ativo hoje (via promotions)
  _loaded:      false,        // true após cbcInit completar para este bar
};

const CBC_MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                    'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const CBC_WDAYS  = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira',
                    'Quinta-feira','Sexta-feira','Sábado'];

/* ── Inicializa o calendário ao abrir a aba Benefícios ─────── */
async function cbcInit(bar) {
  if (!bar || !bar.id) return;
  const barId = String(bar.id);           // normaliza para string

  const cbc = OZ._cbc;
  cbc._barId       = barId;               // marca qual bar está carregado
  cbc._loading     = true;                // flag de carregamento em curso
  cbc._loaded      = false;              // ainda não finalizado
  cbc.year         = new Date().getFullYear();
  cbc.month        = new Date().getMonth();
  cbc.selectedDate = null;
  cbc.todayStr     = localDateStr(new Date());
  cbc.schedules    = [];
  cbc.userReserved = {};
  cbc.activeToday  = false;

  // Elementos DOM
  const panel    = document.getElementById('cbc-day-panel');
  const emptyAll = document.getElementById('cbc-empty-all');
  const loading  = document.getElementById('cbc-loading');
  if (panel)    panel.style.display    = 'none';
  if (emptyAll) emptyAll.style.display = 'none';
  if (loading)  loading.style.display  = 'flex';

  // Barra sem agendamentos via API (demo ou fb)
  const isDemo = barId.startsWith('demo') || barId.startsWith('fb');

  try {
    if (!isDemo) {
      // 1. Busca agendamentos deste bar com duas estratégias:
      //    a) busca paginada filtrada na query (mais eficiente)
      //    b) busca geral com filtro client-side como fallback
      let schedResults = [];
      try {
        // Estratégia A: buscar com search por bar_id
        const resA = await apiGet(`tables/scheduled_benefits?limit=200&search=${encodeURIComponent(barId)}`);
        const dataA = (resA.data || []).filter(s => String(s.bar_id) === barId && s.active !== false);
        schedResults = dataA;
      } catch {}

      // Estratégia B: se A retornou vazio, busca todos e filtra
      if (!schedResults.length) {
        try {
          const resB = await apiGet(`tables/scheduled_benefits?limit=500`);
          schedResults = (resB.data || []).filter(s => String(s.bar_id) === barId && s.active !== false);
        } catch {}
      }

      cbc.schedules = schedResults.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

      // 2. Detecta se hoje tem benefício "ativo" (tabela promotions)
      try {
        const pRes = await apiGet(`tables/promotions?limit=50`);
        cbc.activeToday = (pRes.data || []).some(p =>
          String(p.bar_id) === barId && isPromoActive(p)
        );
      } catch { cbc.activeToday = false; }

      // 3. Reservas do usuário atual neste bar
      const user = OZ.currentUser;
      if (user && user.id) {
        try {
          const rRes = await apiGet(`tables/reservations?limit=200`);
          (rRes.data || [])
            .filter(r =>
              String(r.user_id) === String(user.id) &&
              String(r.bar_id)  === barId &&
              r.status !== 'cancelled'
            )
            .forEach(r => { cbc.userReserved[r.scheduled_benefit_id] = r; });
        } catch {}
      }
    } else {
      // Modo demo / fb: usa cache local do bar se existir
      const localScheds = JSON.parse(localStorage.getItem(`oz_sched_cache_${barId}`) || '[]');
      cbc.schedules = localScheds.map(s => ({
        id:                 String(s.api_id || s.id),
        bar_id:             barId,
        date:               s.date,
        title:              s.title,
        description:        s.desc || s.description || '',
        event:              s.event || '',
        category:           s.category || '',
        max_activations:    s.max_activations || 0,
        reservations_count: 0,
        active:             true,
      }));
    }

    // Se ainda vazio, tenta cache local como último recurso
    if (!cbc.schedules.length) {
      const localScheds = JSON.parse(localStorage.getItem(`oz_sched_cache_${barId}`) || '[]');
      if (localScheds.length) {
        cbc.schedules = localScheds.map(s => ({
          id:                 String(s.api_id || s.id),
          bar_id:             barId,
          date:               s.date,
          title:              s.title,
          description:        s.desc || s.description || '',
          event:              s.event || '',
          category:           s.category || '',
          max_activations:    s.max_activations || 0,
          reservations_count: 0,
          active:             true,
        }));
      }
    }

    // Armazena globalmente para o modal de reserva
    OZ._scheduledBenefits = cbc.schedules;
    OZ._userResByBenefit  = cbc.userReserved;

  } catch (e) {
    console.error('[OZ] cbcInit erro:', e);
  } finally {
    if (loading) loading.style.display = 'none';
    cbc._loading = false;
    cbc._loaded  = true;
  }

  // Estado vazio
  const hasAny = cbc.schedules.length > 0;
  if (emptyAll) emptyAll.style.display = hasAny ? 'none' : 'block';

  cbcRender();
}

/* ── Renderiza a grade do calendário ───────────────────────── */
function cbcRender() {
  const cbc   = OZ._cbc;
  if (!cbc) return;
  const grid  = document.getElementById('cbc-cal-grid');
  const label = document.getElementById('cbc-month-label');
  if (!grid || !label) return;

  const { year: y, month: m, selectedDate, schedules, todayStr, activeToday } = cbc;
  label.textContent = `${CBC_MONTHS[m]} de ${y}`;

  // Mapa de datas com agendamento
  const schedMap = {};
  schedules.forEach(s => { if (s.date) schedMap[s.date] = s; });

  const todayD      = new Date(); todayD.setHours(0,0,0,0);
  const firstDay    = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  let html = '';
  for (let i = 0; i < firstDay; i++) html += '<div class="cbc-cell cbc-empty"></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr  = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const cellDate = new Date(y, m, d);
    const isPast   = cellDate < todayD;
    const isToday  = dateStr === todayStr;
    const hasSched = !!schedMap[dateStr];
    const isSel    = selectedDate === dateStr;
    const isActive = isToday && hasSched && activeToday;  // ativo agora (verde)
    const isLive   = isToday && hasSched;                 // hoje com agendamento

    let cls = 'cbc-cell';
    if (isPast && !isToday) cls += ' cbc-past';
    else if (isSel)         cls += ' cbc-sel';
    else if (isActive)      cls += ' cbc-active';   // verde: ativo hoje
    else if (isLive)        cls += ' cbc-live';     // hoje com benefício
    else if (hasSched)      cls += ' cbc-sched';    // dourado: futuro agendado
    else if (isToday)       cls += ' cbc-today';    // hoje sem benefício

    const clickable = hasSched || isToday;
    const onclick   = clickable ? `onclick="cbcSelectDate('${dateStr}')"` : '';

    let inner = `<span class="cbc-dn">${d}</span>`;
    if (isActive || isLive) inner += '<span class="cbc-dot cbc-dot-g"></span>';
    else if (hasSched)      inner += '<span class="cbc-dot cbc-dot-a"></span>';
    else if (isToday)       inner += '<span class="cbc-dot cbc-dot-t"></span>';

    html += `<div class="${cls}" ${onclick}>${inner}</div>`;
  }

  grid.innerHTML = html;
}

/* ── Seleciona um dia no calendário do cliente ─────────────── */
function cbcSelectDate(dateStr) {
  const cbc = OZ._cbc;
  cbc.selectedDate = dateStr;

  const [y, mo, d] = dateStr.split('-');
  const dt      = new Date(parseInt(y), parseInt(mo)-1, parseInt(d));
  const wday    = CBC_WDAYS[dt.getDay()];
  const mon     = CBC_MONTHS[parseInt(mo)-1];
  const isToday = dateStr === cbc.todayStr;

  const readable = isToday
    ? `Hoje — ${wday}, ${parseInt(d)} de ${mon}`
    : `${wday}, ${parseInt(d)} de ${mon} de ${y}`;

  // Atualiza label de data
  const lbl = document.getElementById('cbc-date-label');
  if (lbl) lbl.textContent = readable;

  // Encontra o benefício deste dia
  const sched = cbc.schedules.find(s => s.date === dateStr);

  // Exibe o painel
  const panel = document.getElementById('cbc-day-panel');
  if (panel) {
    panel.style.display = 'block';
    setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }

  if (sched) {
    _cbcFillBenefit(sched, isToday);
  } else {
    // Dia sem benefício
    const sub = document.getElementById('cbc-date-sub');
    if (sub) sub.textContent = isToday ? 'Sem benefício hoje' : 'Sem benefício neste dia';
    document.getElementById('cbc-no-benefit').style.display  = 'block';
    document.getElementById('cbc-has-benefit').style.display = 'none';
    // Ícone neutro
    const icon = document.getElementById('cbc-date-icon');
    if (icon) icon.className = 'cbc-date-icon';
  }

  cbcRender();
}

/* ── Preenche o painel com dados do benefício ──────────────── */
function _cbcFillBenefit(sched, isToday) {
  const cbc = OZ._cbc;
  document.getElementById('cbc-no-benefit').style.display  = 'none';
  document.getElementById('cbc-has-benefit').style.display = 'block';

  // Sub-título da data
  const sub = document.getElementById('cbc-date-sub');
  const isActive = isToday && cbc.activeToday;
  if (sub) sub.textContent = isActive ? '🟢 Benefício ativo agora' : (isToday ? '📅 Agendado para hoje' : '📅 Benefício agendado');

  // Ícone da barra de data (verde = ativo, dourado = agendado)
  const icon = document.getElementById('cbc-date-icon');
  if (icon) icon.className = isActive ? 'cbc-date-icon cbc-date-icon-active' : 'cbc-date-icon cbc-date-icon-sched';

  // Banner AO VIVO
  const liveBanner = document.getElementById('cbc-live-banner');
  if (liveBanner) liveBanner.style.display = isActive ? 'flex' : 'none';

  // Conteúdo
  const titleEl = document.getElementById('cbc-benefit-title');
  const descEl  = document.getElementById('cbc-benefit-desc');
  const eventEl = document.getElementById('cbc-benefit-event');
  const eventTx = document.getElementById('cbc-benefit-event-text');
  if (titleEl) titleEl.textContent = sched.title || '';
  if (descEl)  descEl.textContent  = sched.description || '';

  // Categoria
  const catEl   = document.getElementById('cbc-benefit-category');
  const catTxEl = document.getElementById('cbc-benefit-category-text');
  const catMap  = { 'Comidinha': '🍔', 'Bebida': '🍺', 'Entrada VIP': '⭐', 'Desconto': '🏷️', 'Outros': '✨' };
  if (sched.category && sched.category.trim()) {
    const emoji = catMap[sched.category] || '🏷️';
    if (catTxEl) catTxEl.textContent = `${emoji} ${sched.category}`;
    if (catEl)   catEl.style.display = 'flex';
  } else {
    if (catEl) catEl.style.display = 'none';
  }

  if (sched.event && sched.event.trim()) {
    if (eventEl) eventEl.style.display = 'flex';
    if (eventTx) eventTx.textContent   = sched.event;
  } else {
    if (eventEl) eventEl.style.display = 'none';
  }

  // Vagas
  const slotsText = document.getElementById('cbc-slots-text');
  const slotsInfo = document.getElementById('cbc-slots-info');
  if (sched.max_activations > 0) {
    const left = sched.max_activations - (sched.reservations_count || 0);
    const isFull = left <= 0;
    if (slotsText) {
      slotsText.textContent = isFull
        ? 'Vagas esgotadas'
        : `${left} de ${sched.max_activations} vagas disponíveis`;
    }
    if (slotsInfo) slotsInfo.style.display = 'flex';
  } else {
    if (slotsText) slotsText.textContent = 'Vagas ilimitadas';
    if (slotsInfo) slotsInfo.style.display = 'flex';
  }

  // Botões de ação
  const btnActivate      = document.getElementById('cbc-btn-activate');
  const btnReserve       = document.getElementById('cbc-btn-reserve');
  const alreadyReserved  = document.getElementById('cbc-already-reserved');
  const fullBadge        = document.getElementById('cbc-full-badge');

  // Esconde tudo antes de decidir
  if (btnActivate)     btnActivate.style.display     = 'none';
  if (btnReserve)      btnReserve.style.display      = 'none';
  if (alreadyReserved) alreadyReserved.style.display = 'none';
  if (fullBadge)       fullBadge.style.display       = 'none';

  const isFull     = sched.max_activations > 0 &&
                     (sched.max_activations - (sched.reservations_count || 0)) <= 0;
  const hasReserved = !!cbc.userReserved[sched.id];

  // Guarda referência para cbcReserve()
  OZ._cbcActiveSched = sched;

  if (isToday) {
    // Hoje: exibe botão de ATIVAR
    if (isActive) {
      if (btnActivate) btnActivate.style.display = 'flex';
    } else {
      // Hoje mas ainda não está "ativo" via promotions — pode reservar/avisar
      if (hasReserved) {
        if (alreadyReserved) alreadyReserved.style.display = 'flex';
      } else if (isFull) {
        if (fullBadge) fullBadge.style.display = 'flex';
      } else {
        if (btnReserve) btnReserve.style.display = 'flex';
      }
    }
  } else {
    // Futuro: reservar
    if (hasReserved) {
      if (alreadyReserved) alreadyReserved.style.display = 'flex';
    } else if (isFull) {
      if (fullBadge) fullBadge.style.display = 'flex';
    } else {
      if (btnReserve) btnReserve.style.display = 'flex';
    }
  }
}

/* ── Reservar vaga no painel do cliente ────────────────────── */
async function cbcReserve() {
  const sched = OZ._cbcActiveSched;
  if (!sched) return;
  // Reutiliza o modal de reserva existente
  await openReserveModal(sched.id);
}

/* ── Limpa a seleção do calendário do cliente ──────────────── */
function cbcClearDate() {
  OZ._cbc.selectedDate = null;
  const panel = document.getElementById('cbc-day-panel');
  if (panel) panel.style.display = 'none';
  cbcRender();
}

/* ── Navegação de mês ──────────────────────────────────────── */
function cbcPrev() {
  const cbc = OZ._cbc;
  cbc.month--;
  if (cbc.month < 0) { cbc.month = 11; cbc.year--; }
  cbcClearDate();
}
function cbcNext() {
  const cbc = OZ._cbc;
  cbc.month++;
  if (cbc.month > 11) { cbc.month = 0; cbc.year++; }
  cbcClearDate();
}

/* ══════════════════════════════════════════════════════════════
   FIM CALENDÁRIO DO CLIENTE
══════════════════════════════════════════════════════════════ */

/* Abre o modal de reserva para um benefício específico */
async function openReserveModal(benefitId) {
  const user = OZ.currentUser;
  if (!user) { showToast('Faça login para reservar.', 'error'); return; }

  const items = OZ._scheduledBenefits || [];
  const s = items.find(x => x.id === benefitId);
  if (!s) return;

  const userResByBenefit = OZ._userResByBenefit || {};
  const hasReserved = !!userResByBenefit[benefitId];

  // Preenche o modal
  const d = s.date ? new Date(s.date + 'T12:00:00') : null;
  const dateStr = d ? d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }) : s.date;

  document.getElementById('reserve-modal-title').textContent = 'Reservar benefício';
  document.getElementById('reserve-modal-bar').textContent   = OZ.currentBar?.name || s.bar_name || '';
  document.getElementById('reserve-modal-date').textContent  = dateStr;
  document.getElementById('reserve-modal-benefit-title').textContent = s.title;
  document.getElementById('reserve-modal-benefit-desc').textContent  = s.description || '';

  const eventEl = document.getElementById('reserve-modal-event');
  if (s.event) {
    document.getElementById('reserve-modal-event-text').textContent = s.event;
    eventEl.style.display = 'flex';
  } else {
    eventEl.style.display = 'none';
  }

  const slotsEl   = document.getElementById('reserve-modal-slots');
  const slotsText = document.getElementById('reserve-modal-slots-text');
  if (s.max_activations > 0) {
    const left = s.max_activations - (s.reservations_count || 0);
    slotsText.textContent = `${left} vagas restantes de ${s.max_activations}`;
    slotsEl.style.display = 'flex';
  } else {
    slotsEl.style.display = 'none';
  }

  // Guarda referência do benefício ativo no modal
  OZ._activeReserveBenefit = s;

  const confirmBtn  = document.getElementById('btn-reserve-confirm');
  const doneBadge   = document.getElementById('reserve-already-done');

  if (hasReserved) {
    confirmBtn.style.display  = 'none';
    doneBadge.style.display   = 'block';
  } else {
    confirmBtn.style.display  = 'block';
    doneBadge.style.display   = 'none';
    confirmBtn.disabled       = false;
    confirmBtn.innerHTML      = '<i class="fa fa-calendar-check"></i> Confirmar reserva';
  }

  openModal('modal-reserve-benefit');
}

/* Confirma a reserva do benefício agendado */
async function confirmReservation() {
  const user = OZ.currentUser;
  const s    = OZ._activeReserveBenefit;
  if (!user || !s) return;

  const btn = document.getElementById('btn-reserve-confirm');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Reservando...';

  try {
    // ── EDGE FUNCTION: confirmar-reserva (valida vagas e cria reserva no servidor) ──
    const resData = await edgeFn('confirmar-reserva', {
      action:               'criar',
      scheduled_benefit_id: s.id,
      bar_id:               s.bar_id,
      bar_name:             s.bar_name,
      benefit_date:         s.date,
      benefit_title:        s.title,
      promoter_id:          user.referred_by || '',
    });

    const reservation = resData?.reservation;
    // Atualiza cache local (Edge Function já gravou reservations_count no banco)
    const newCount = (s.reservations_count || 0) + 1;

    // Atualiza memória local
    s.reservations_count = newCount;
    if (!OZ._userResByBenefit) OZ._userResByBenefit = {};
    OZ._userResByBenefit[s.id] = reservation;

    // Sincroniza com o calendário do cliente
    if (OZ._cbc) {
      OZ._cbc.userReserved[s.id] = reservation;
      const idx = OZ._cbc.schedules.findIndex(x => x.id === s.id);
      if (idx >= 0) OZ._cbc.schedules[idx].reservations_count = newCount;
    }

    // Mostra badge de confirmado
    document.getElementById('btn-reserve-confirm').style.display = 'none';
    document.getElementById('reserve-already-done').style.display = 'block';

    showToast('✅ Reserva confirmada! Te vemos lá 🎉', 'success');

    // Atualiza o painel do calendário se o dia ainda estiver selecionado
    if (OZ._cbc && OZ._cbc.selectedDate === s.date) {
      const alreadyReserved = document.getElementById('cbc-already-reserved');
      const btnReserve      = document.getElementById('cbc-btn-reserve');
      if (btnReserve)      btnReserve.style.display      = 'none';
      if (alreadyReserved) alreadyReserved.style.display = 'flex';
      // Atualiza contagem de vagas no painel
      const slotsText = document.getElementById('cbc-slots-text');
      if (slotsText && s.max_activations > 0) {
        const left = s.max_activations - newCount;
        slotsText.textContent = left <= 0
          ? 'Vagas esgotadas'
          : `${left} de ${s.max_activations} vagas disponíveis`;
      }
    }

    // ── Se o benefício é para HOJE, registra em activations para aparecer na lista do bar ──
    const _todayForRes = _todayStr();
    if (s.date === _todayForRes && !user.id?.startsWith('demo-')) {
      const _userName = user.name || user.email?.split('@')[0] || 'Cliente';
      if (user.id) OZ.userNameCache[user.id] = _userName;
      await apiPost('tables/activations', {
        user_id:       user.id,
        user_name:     _userName,
        bar_id:        s.bar_id,
        bar_name:      s.bar_name,
        type:          'advance_individual',
        amount:        0,
        qr_code:       reservation.id,
        expires_at:    '',
        promoter_id:   user.referred_by || '',
        promoter_code: user.referred_by || '',
        origin:        'advance_activation',
        origin_act_id: reservation.id,
        benefit_date:  s.date || '',   // ★ data do benefício agendado
      });
    }

    // Atualiza card na lista legada (compatibilidade)
    const cardEl = document.getElementById(`sbc-${s.id}`);
    if (cardEl) {
      const reserveBtn = cardEl.querySelector('.btn-sbc-reserve');
      if (reserveBtn) {
        reserveBtn.outerHTML = `<button class="btn-sbc-reserved" onclick="openReserveModal('${s.id}')">
          <i class="fa fa-check-circle"></i> Reservado ✓
        </button>`;
      }
    }

  } catch (e) {
    showToast('Erro ao confirmar reserva. Tente novamente.', 'error');
    btn.disabled = false;
    btn.innerHTML = '<i class="fa fa-calendar-check"></i> Confirmar reserva';
  }
}

/* Cancela a reserva ativa */
async function cancelReservation() {
  const user = OZ.currentUser;
  const s    = OZ._activeReserveBenefit;
  if (!user || !s) return;

  const existing = OZ._userResByBenefit?.[s.id];
  if (!existing) return;

  try {
    // ── EDGE FUNCTION: confirmar-reserva action=cancelar ──
    await edgeFn('confirmar-reserva', {
      action:         'cancelar',
      reservation_id: existing.id,
    });

    // Atualiza cache local (Edge Function já decrementou reservations_count no banco)
    const newCount = Math.max(0, (s.reservations_count || 1) - 1);

    s.reservations_count = newCount;
    delete OZ._userResByBenefit[s.id];

    // Sincroniza com o calendário do cliente
    if (OZ._cbc) {
      delete OZ._cbc.userReserved[s.id];
      const idx = OZ._cbc.schedules.findIndex(x => x.id === s.id);
      if (idx >= 0) OZ._cbc.schedules[idx].reservations_count = newCount;
      // Atualiza painel se dia ainda selecionado
      if (OZ._cbc.selectedDate === s.date) {
        const alreadyReserved = document.getElementById('cbc-already-reserved');
        const btnReserve      = document.getElementById('cbc-btn-reserve');
        const isFull = s.max_activations > 0 && newCount >= s.max_activations;
        if (alreadyReserved) alreadyReserved.style.display = 'none';
        if (btnReserve && !isFull) btnReserve.style.display = 'flex';
      }
    }

    // Atualiza botão no modal
    document.getElementById('reserve-already-done').style.display = 'none';
    document.getElementById('btn-reserve-confirm').style.display  = 'block';
    document.getElementById('btn-reserve-confirm').disabled       = false;
    document.getElementById('btn-reserve-confirm').innerHTML      = '<i class="fa fa-calendar-check"></i> Confirmar reserva';

    showToast('Reserva cancelada.', 'success');

    // Atualiza card na lista legada
    const cardEl = document.getElementById(`sbc-${s.id}`);
    if (cardEl) {
      const reservedBtn = cardEl.querySelector('.btn-sbc-reserved');
      if (reservedBtn) {
        reservedBtn.outerHTML = `<button class="btn-sbc-reserve" onclick="openReserveModal('${s.id}')">
          <i class="fa fa-calendar-check"></i> Reservar vaga
        </button>`;
      }
    }

  } catch (e) {
    showToast('Erro ao cancelar reserva.', 'error');
  }
}

/* ══════════════════════════════════════════════════════════════
   ATIVAÇÃO ANTECIPADA — Benefícios Agendados
   Permite que cliente / promoter ative um benefício futuro,
   entrando na lista do bar na data agendada.
══════════════════════════════════════════════════════════════ */

// Estado global do modal de ativação antecipada
OZ._advanceCtx = null;  // { sched, bar, existingReservation }

/**
 * Abre o modal de ativação antecipada para um benefício agendado futuro.
 * @param {object} sched  – objeto do scheduled_benefit (com id, bar_id, date, title, …)
 * @param {object} bar    – objeto do bar
 */
async function openAdvanceActivateModal(sched, bar) {
  if (!OZ.currentUser) { showToast('Faça login para ativar.', 'error'); return; }

  // Monta contexto
  OZ._advanceCtx  = { sched, bar, existingReservation: null };
  OZ._advanceType = null;

  // ── Preenche o modal ──
  const barNameEl   = document.getElementById('adv-modal-bar-name');
  const dateLabelEl = document.getElementById('adv-modal-date-label');
  const infoDateEl  = document.getElementById('adv-info-date');
  const titleEl     = document.getElementById('adv-modal-benefit-title');
  const descEl      = document.getElementById('adv-modal-benefit-desc');
  const eventEl     = document.getElementById('adv-modal-benefit-event');
  const eventTxtEl  = document.getElementById('adv-modal-event-text');

  if (barNameEl)   barNameEl.textContent  = bar.name || '—';

  // Formata data
  const [y, mo, d] = sched.date.split('-');
  const dt   = new Date(parseInt(y), parseInt(mo)-1, parseInt(d));
  const wday = dt.toLocaleDateString('pt-BR', { weekday: 'long' });
  const dFmt = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  const dateStr = `${wday.charAt(0).toUpperCase()+wday.slice(1)}, ${dFmt}`;
  if (dateLabelEl) dateLabelEl.textContent = dateStr;
  if (infoDateEl)  infoDateEl.textContent  = `${parseInt(d)}/${parseInt(mo)}`;

  if (titleEl) titleEl.textContent = sched.title || bar.benefit || 'Benefício especial';
  if (descEl) {
    if (sched.description) {
      descEl.textContent = sched.description;
      descEl.style.display = 'block';
    } else { descEl.style.display = 'none'; }
  }
  if (eventEl && eventTxtEl) {
    if (sched.event) {
      eventTxtEl.textContent = sched.event;
      eventEl.style.display = 'flex';
    } else { eventEl.style.display = 'none'; }
  }

  // ── Reseta estados visuais ──
  document.getElementById('adv-opt-individual')?.classList.remove('selected');
  document.getElementById('adv-opt-night')?.classList.remove('selected');
  document.getElementById('adv-modal-summary').style.display   = 'none';
  document.getElementById('adv-btn-confirm').style.display     = 'none';
  document.getElementById('adv-already-done').style.display    = 'none';
  document.getElementById('adv-modal-options').style.display   = 'block';
  document.getElementById('adv-free-banner').style.display     = 'none';

  // ── Verifica ativações existentes ──
  try {
    const actsRes = await apiGet(`tables/activations?limit=500`);
    const allActs = actsRes.data || [];

    // ── Verifica se já tem ativação ativa para este bar+benefit_date ──────────
    const jaAtivadoAqui = allActs.find(a =>
      a.user_id      === OZ.currentUser.id &&
      a.bar_id       === bar.id &&
      a.benefit_date === sched.date &&
      a.status       === 'active'
    );

    if (jaAtivadoAqui) {
      // Já está na lista deste bar — oculta opções e mostra mensagem
      document.getElementById('adv-modal-options').style.display  = 'none';
      document.getElementById('adv-free-banner').style.display     = 'none';
      document.getElementById('adv-modal-summary').style.display   = 'none';
      document.getElementById('adv-btn-confirm').style.display     = 'none';
      document.getElementById('adv-already-done').style.display    = 'block';
      const detailEl = document.getElementById('adv-done-detail');
      if (detailEl) detailEl.textContent = 'Seu nome já está na lista deste bar para este dia! ✅';
      openModal('modal-advance-activate');
      return;
    }

    // ── Verifica se já tem advance_night OU night_link ativo para esta data ──
    const _isNightType = a => a.type === 'advance_night' || a.type === 'night_link' || a.type === 'night';
    const advNightAtivo = allActs.find(a =>
      a.user_id  === OZ.currentUser.id &&
      _isNightType(a) &&
      a.status   === 'active' &&
      (a.benefit_date === sched.date || nightDateKeyFromTs(a.created_at) === sched.date) &&
      a.bar_id   !== bar.id  // bar diferente — mesmo bar seria duplicata
    );

    if (advNightAtivo) {
      // Já fez checkin neste bar nesta data?
      const jaCheckin = allActs.find(a =>
        a.user_id     === OZ.currentUser.id &&
        a.bar_id      === bar.id &&
        a.type        === 'night_checkin' &&
        a.benefit_date === sched.date &&
        a.status      !== 'cancelled'
      );

      if (jaCheckin) {
        // Já fez checkin aqui → mostra estado concluído
        _showAdvanceDoneState({ activation_type: 'advance_night', paid: true, status: 'confirmed' });
      } else {
        // Tem Noite Toda em outro bar → mostra botão "Confirmar entrada" direto, sem escolha de tipo
        OZ._advanceType = 'individual';
        OZ._advNightFreeCheckin = true;
        OZ._advNightRef = advNightAtivo; // salva referência para usar no confirmAdvanceActivation
        document.getElementById('adv-modal-options').style.display  = 'none';
        document.getElementById('adv-free-banner').style.display     = 'none';
        document.getElementById('adv-modal-summary').style.display   = 'none';

        const btnConf = document.getElementById('adv-btn-confirm');
        if (btnConf) {
          btnConf.style.display = 'flex';
          btnConf.disabled      = false;
          btnConf.innerHTML     = '<i class="fa fa-check-circle"></i> Confirmar entrada';
        }
      }
    } else {
      OZ._advNightFreeCheckin = false;

      // ── Verifica se já tem reserva para este benefício ──
      const res  = await apiGet(`tables/reservations?limit=200`);
      const allRes = res.data || [];
      const existing = allRes.find(r =>
        String(r.user_id) === String(OZ.currentUser.id) &&
        String(r.scheduled_benefit_id) === String(sched.id) &&
        r.benefit_date === sched.date &&
        r.status !== 'cancelled'
      );
      if (existing) {
        OZ._advanceCtx.existingReservation = existing;
        if (existing.paid || existing.status === 'confirmed' || existing.status === 'pre_activated') {
          _showAdvanceDoneState(existing);
        }
      } else {
        // Verifica créditos grátis disponíveis
        const freeActs = allActs.filter(
          a => a.user_id === OZ.currentUser.id &&
               a.type   === 'free_credit' &&
               a.status !== 'cancelled'
        );
        OZ.freeCreditsAvailable = freeActs.length;
        OZ.freeCreditIds = freeActs.sort((a,b)=>(a.created_at||0)-(b.created_at||0)).map(a=>a.id);

        if (OZ.freeCreditsAvailable > 0) {
          const freeBanner  = document.getElementById('adv-free-banner');
          const freeCountEl = document.getElementById('adv-free-count');
          if (freeBanner)  freeBanner.style.display  = 'flex';
          if (freeCountEl) freeCountEl.textContent   = OZ.freeCreditsAvailable;
        }
      }
    }
  } catch(e) {
    console.warn('[openAdvanceActivateModal]', e);
  }

  openModal('modal-advance-activate');
}

function _showAdvanceDoneState(reservation) {
  document.getElementById('adv-modal-options').style.display   = 'none';
  document.getElementById('adv-free-banner').style.display     = 'none';
  document.getElementById('adv-modal-summary').style.display   = 'none';
  document.getElementById('adv-btn-confirm').style.display     = 'none';
  document.getElementById('adv-already-done').style.display    = 'block';

  const detailEl  = document.getElementById('adv-done-detail');
  const typeLabel = reservation.activation_type === 'advance_night' ? 'Noite Toda' : 'Unitário';
  const paidLabel = reservation.paid ? `· R$${reservation.amount || 5} pago` : '';
  if (detailEl) detailEl.textContent = `${typeLabel} confirmado${paidLabel} — você está na lista!`;
}

function selectAdvanceType(type) {
  OZ._advanceType = type;
  document.getElementById('adv-opt-individual')?.classList.toggle('selected', type === 'individual');
  document.getElementById('adv-opt-night')?.classList.toggle('selected',      type === 'night');

  const hasFree   = OZ.freeCreditsAvailable > 0 && type === 'individual';
  const amount    = hasFree ? 0 : (type === 'individual' ? 5 : 10);
  const typeLabel = type === 'individual' ? (hasFree ? 'Unitário (Grátis)' : 'Unitário') : 'Noite Toda';
  const amtLabel  = hasFree ? 'Grátis 🎁' : `R$${amount}`;

  const summaryEl     = document.getElementById('adv-modal-summary');
  const summaryType   = document.getElementById('adv-summary-type');
  const summaryAmount = document.getElementById('adv-summary-amount');
  const btnConf       = document.getElementById('adv-btn-confirm');

  if (summaryEl)     summaryEl.style.display     = 'flex';
  if (summaryType)   summaryType.textContent     = typeLabel;
  if (summaryAmount) summaryAmount.textContent   = amtLabel;
  if (btnConf) {
    btnConf.style.display = 'flex';
    btnConf.disabled      = false;
    btnConf.innerHTML     = '<i class="fa fa-bolt"></i> Confirmar';
  }
}

async function confirmAdvanceActivation() {
  const ctx  = OZ._advanceCtx;
  const type = OZ._advanceType;
  if (!ctx || !type) return;

  const { sched, bar } = ctx;
  const user  = OZ.currentUser;
  const isDemo = user.id.startsWith('demo-');

  const btn = document.getElementById('adv-btn-confirm');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Processando...'; }

  try {
    // ── Checkin gratuito via Noite Toda antecipada ────────────────────────────
    // OZ._advNightFreeCheckin é setado em openAdvanceActivateModal quando o cliente
    // tem advance_night ativo para esta benefit_date em outro bar.
    if (OZ._advNightFreeCheckin) {
      const advNight = OZ._advNightRef; // referência salva no openAdvanceActivateModal
      const payload = {
        user_id:              user.id,
        user_name:            user.name || user.email,
        bar_id:               bar.id,
        bar_name:             bar.name,
        type:                 'night_checkin',
        amount:               0,
        benefit_date:         sched.date,
        night_session:        advNight?.night_session || advNight?.id || '',
        scheduled_benefit_id: sched.id,
        status:               'active',
        created_at:           Date.now(),
        updated_at:           Date.now(),
      };
      console.log('[night_checkin] criando activation:', JSON.stringify(payload));
      const checkinJson = await apiPost('tables/activations', payload);
      console.log('[night_checkin] gravado:', JSON.stringify(checkinJson));

      const d = parseInt(sched.date.split('-')[2]);
      const m = parseInt(sched.date.split('-')[1]);
      OZ._advNightFreeCheckin = false;
      OZ._advNightRef = null;
      closeModal('modal-advance-activate');
      showToast(`✅ Entrada liberada! Você já tem Noite Toda no dia ${d}/${m} 🎉`, 'success');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa fa-bolt"></i> Confirmar'; }
      return;
    }

    const hasFree   = OZ.freeCreditsAvailable > 0 && type === 'individual';
    const amount    = hasFree ? 0 : (type === 'individual' ? 5 : 10);
    const actType   = type === 'individual' ? (hasFree ? 'advance_free' : 'advance_individual') : 'advance_night';
    const resType   = type === 'individual' ? 'advance_individual' : 'advance_night';

    // ══ Verifica limite de vagas do benefício agendado ══
    if (!isDemo) {
      const maxAdv = sched.max_activations || 0;
      if (maxAdv > 0) {
        // Busca contagem fresca de reservas
        const freshSched = await apiGet(`tables/scheduled_benefits/${sched.id}`).catch(() => null);
        const curAdv = freshSched?.reservations_count ?? sched.reservations_count ?? 0;
        if (curAdv >= maxAdv) {
          showToast(`⚠️ Vagas esgotadas! Este benefício atingiu o limite de ${maxAdv} ativação${maxAdv !== 1 ? 'ões' : ''}.`, 'error');
          if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa fa-bolt"></i> Confirmar'; }
          return;
        }
      }
    }

    // ── EDGE FUNCTION: confirmar-reserva action=criar (valida vagas no servidor) ──
    let advResData;
    try {
      advResData = await edgeFn('confirmar-reserva', {
        action:               'criar',
        scheduled_benefit_id: sched.id,
        bar_id:               bar.id,
        bar_name:             bar.name,
        benefit_date:         sched.date,
        benefit_title:        sched.title || bar.benefit || 'Benefício especial',
        promoter_id:          user.referred_by || '',
        activation_type:      resType,
      });
    } catch (resErr) {
      // 409 = reserva já existe (pending não paga) → reutiliza e segue para PIX
      // Mantém o tipo escolhido pelo usuário (type/resType), ignora activation_type da reserva antiga
      if (resErr?.status === 409 && resErr?.body?.reservation_existing) {
        advResData = { reservation: resErr.body.reservation_existing };
      } else {
        throw resErr; // outros erros sobem normalmente
      }
    }

    const reservation = advResData?.reservation;

    OZ._advanceCtx.existingReservation = reservation;

    // ── Registra ativação financeira ──
    if (!isDemo) {
      if (hasFree) {
        // ── EDGE FUNCTION: usar-credito-gratis (valida ownership no servidor) ──
        const creditId = OZ.freeCreditIds[0];
        if (creditId) {
          await edgeFn('usar-credito-gratis', { credit_id: creditId });
        }
        OZ.freeCreditsAvailable = Math.max(0, OZ.freeCreditsAvailable - 1);
        OZ.freeCreditIds = OZ.freeCreditIds.slice(1);
      }

      // Atualiza cache local (Edge Function confirmar-reserva já gravou reservations_count)
      const newResCount = (sched.reservations_count || 0) + 1;
      sched.reservations_count = newResCount;

      // Atualiza cache local de ativações do usuário
      const prevActCount = user.activations_count || 0;
      user.activations_count = prevActCount + 1;

      // ── Recompensa quem convidou com 1 free_credit na 1ª ativação ──
      grantInviterFreeCredit(user, prevActCount);

      // ── Ativação paga: usa criar-transacao (PIX) para qualquer data (hoje ou futura) ──
      // O webhook-pagamento é o único que muda status → active e garante o nome na lista do bar.
      // benefit_date = sched.date garante que o nome aparece na lista SOMENTE na data do benefício.
      if (!hasFree && amount > 0 && reservation?.id) {
        const edgeType   = type === 'night' ? 'night' : 'activation';
        const qrCodeAdv  = reservation.id; // usa o ID da reserva como qr_code
        const expiryAdv  = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        const txBodyAdv  = {
          type:                   edgeType,
          bar_id:                 bar.id,
          bar_name:               bar.name,
          qr_code:                qrCodeAdv,
          expires_at:             expiryAdv,
          promoter_id:            user.referred_by || '',
          promoter_code:          user.referred_by || '',
          benefit_date:           sched.date,          // ★ data do benefício agendado (pode ser futura)
          scheduled_benefit_id:   sched.id,            // ★ liga a ativação ao benefício agendado
        };
        // _activePickPromoter é zerado pelo openBarDetail — usa _pendingPickPromoter como fallback
        const _pickProm = OZ._activePickPromoter || OZ._pendingPickPromoter || '';
        if (edgeType === 'activation') {
          txBodyAdv.pick_promoter = _pickProm;
        }
        if (edgeType === 'night') {
          txBodyAdv.night_session        = qrCodeAdv;
          txBodyAdv.night_pick_promoter  = _pickProm;
        }

        let txResult;
        try {
          txResult = await edgeFn('criar-transacao', txBodyAdv);
        } catch (txErr) {
          console.error('[confirmAdvanceActivation] criar-transacao falhou:', txErr);
          showToast(`Erro ao gerar PIX: ${txErr.message || 'Tente novamente.'}`, 'error');
          if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa fa-bolt"></i> Confirmar ativação antecipada'; }
          return;
        }

        OZ._activePickPromoter  = null;
        OZ._pendingPickPromoter = null; // limpa após uso no fluxo avançado
        const d = parseInt(sched.date.split('-')[2]);
        const m = parseInt(sched.date.split('-')[1]);

        // free_checkin = já tem Noite Toda para essa data → benefício liberado sem cobrança
        if (txResult.free_checkin) {
          closeModal('modal-advance-activate');
          _showAdvanceDoneState(reservation);
          showToast(`✅ Benefício liberado! Você já tem Noite Toda no dia ${d}/${m} — sem cobrança 🎉`, 'success');
          if (!OZ._userResByBenefit) OZ._userResByBenefit = {};
          OZ._userResByBenefit[sched.id] = reservation;
          return;
        }

        // Fecha modal de antecipação e abre modal de PIX (não mostra "já está na lista" antes do pagamento)
        setTimeout(() => _showPixModal({
          bar,
          type,
          qrData:        qrCodeAdv,
          activationId:  txResult.activation_id,
          pixCopyPaste:  txResult.transaction?.pix_copy_paste  || '',
          pixQrCode:     txResult.transaction?.pix_qr_code     || '',
          pixExpiresAt:  txResult.transaction?.pix_expires_at  || '',
          amount,
        }), 200);

        showToast(`💳 PIX gerado! Pague para garantir seu nome na lista do dia ${d}/${m} 🎉`, 'success');

        // Sincroniza cache local de reservas e sai (sem atualizar UI de "concluído" ainda)
        if (!OZ._userResByBenefit) OZ._userResByBenefit = {};
        OZ._userResByBenefit[sched.id] = reservation;
        return; // encerra aqui — UI será atualizada após confirmação do webhook
      }
    }

    // ── Atualiza UI (fluxo grátis ou demo) ──
    _showAdvanceDoneState(reservation);
    showToast(`✅ Ativação confirmada para ${parseInt(sched.date.split('-')[2])}/${parseInt(sched.date.split('-')[1])}! Seu nome está na lista 🎉`, 'success');

    // Sincroniza cache local de reservas
    if (!OZ._userResByBenefit) OZ._userResByBenefit = {};
    OZ._userResByBenefit[sched.id] = reservation;

  } catch(e) {
    console.error('[confirmAdvanceActivation]', e);
    showToast('Erro ao confirmar ativação. Tente novamente.', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa fa-bolt"></i> Confirmar ativação antecipada'; }
  }
}



/* ══════════════════════════════════════════════════════════════
   AVALIAÇÕES & COMENTÁRIOS — estilo TripAdvisor
   • Cliente: posta comentário + nota → sempre visível, sem curtir
   • Bar: lê todos os comentários do seu bar, responde inline
══════════════════════════════════════════════════════════════ */

/* Helper: renderiza estrelas */
function _starsHtml(n, max = 5) {
  let h = '';
  for (let i = 1; i <= max; i++) {
    h += i <= n ? '<i class="fa fa-star"></i>' : '<i class="far fa-star"></i>';
  }
  return h;
}

/* Helper: data legível */
function _fmtDate(ts) {
  if (!ts) return '';
  return new Date(Number(ts)).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric' });
}

/* ─── LADO CLIENTE: carrega reviews + formulário ─── */
/* ─── Cache de ratings por bar_id → { avg, total } ─── */
OZ._ratingsCache = {};

/**
 * Carrega as reviews de um bar, calcula a média e atualiza:
 *  - dp-stars-row (estrelas no topo da ficha)
 *  - Armazena no cache OZ._ratingsCache[barId]
 * Chamado sempre que o detalhe do bar é aberto.
 */
async function _loadBarRatingTop(barId) {
  if (!barId) return;

  // Zera o display enquanto carrega
  const dpStarsRow = document.getElementById('dp-stars-row');
  const dpRatingTxt = document.getElementById('dp-rating-text');

  try {
    const res  = await fetch(`tables/reviews?limit=200`);
    if (!res.ok) return;
    const data = await res.json();
    const reviews = (data.data || []).filter(r => r.bar_id === barId);
    const total   = reviews.length;

    if (!total) {
      // Sem avaliações: exibe "Novo"
      if (dpStarsRow) {
        dpStarsRow.innerHTML =
          '<i class="far fa-star"></i>'.repeat(5) +
          '<span class="dp-rating-count" id="dp-rating-text">Novo</span>';
      }
      OZ._ratingsCache[barId] = { avg: 0, total: 0 };
      return;
    }

    const avg = parseFloat(
      (reviews.reduce((s, r) => s + (r.rating || 0), 0) / total).toFixed(1)
    );
    OZ._ratingsCache[barId] = { avg, total };

    // Atualiza dp-stars-row (topo da ficha)
    if (dpStarsRow) {
      const f = Math.floor(avg);
      const h = avg - f >= 0.5;
      dpStarsRow.innerHTML =
        Array.from({ length: 5 }, (_, i) =>
          `<i class="${
            i < f ? 'fa fa-star' :
            i === f && h ? 'fa fa-star-half-alt' :
            'far fa-star'
          }"></i>`
        ).join('') +
        `<span class="dp-rating-count" id="dp-rating-text">${avg.toFixed(1)} · ${total} avaliação${total !== 1 ? 'ões' : ''}</span>`;
    }
  } catch { /* silencioso */ }
}

/**
 * Carrega reviews completas (média + barras + lista de comentários).
 * Chamado apenas ao abrir a aba Avaliações.
 */
async function loadRealReviews(bar) {
  const scoreEl  = document.getElementById('bar-rating-score');
  const starsEl  = document.getElementById('bar-rating-stars');
  const countEl  = document.getElementById('bar-rating-count');
  const barsEl   = document.getElementById('bar-rating-bars');
  const reviewEl = document.getElementById('bar-reviews-list');
  if (!scoreEl) return;

  let reviews = [];
  try {
    const res = await fetch(`tables/reviews?limit=200`);
    if (res.ok) {
      const data = await res.json();
      reviews = (data.data || []).filter(r => r.bar_id === bar.id);
    }
  } catch(e) {}

  const total = reviews.length;
  if (!total) {
    scoreEl.textContent = '—';
    countEl.textContent = '0 avaliações';
    starsEl.innerHTML   = '<i class="far fa-star"></i>'.repeat(5);
    barsEl.innerHTML    = '';
    reviewEl.innerHTML  = '<p style="font-size:13px;color:var(--gray-4);text-align:center;padding:16px 0;">Ainda sem avaliações. Seja o primeiro!</p>';
    // Garante que o topo também mostre "Novo"
    const dpRow = document.getElementById('dp-stars-row');
    if (dpRow) dpRow.innerHTML =
      '<i class="far fa-star"></i>'.repeat(5) +
      '<span class="dp-rating-count" id="dp-rating-text">Novo</span>';
    return;
  }

  const avg = parseFloat(
    (reviews.reduce((s, r) => s + (r.rating || 0), 0) / total).toFixed(1)
  );
  OZ._ratingsCache[bar.id] = { avg, total };

  scoreEl.textContent = avg.toFixed(1);
  countEl.textContent = `${total} avaliação${total !== 1 ? 'ões' : ''}`;

  // ── Atualiza estrelas no TOPO da ficha (dp-stars-row) ──
  const dpStarsRow = document.getElementById('dp-stars-row');
  if (dpStarsRow) {
    const f = Math.floor(avg);
    const h = avg - f >= 0.5;
    dpStarsRow.innerHTML =
      Array.from({ length: 5 }, (_, i) =>
        `<i class="${
          i < f ? 'fa fa-star' :
          i === f && h ? 'fa fa-star-half-alt' :
          'far fa-star'
        }"></i>`
      ).join('') +
      `<span class="dp-rating-count" id="dp-rating-text">${avg.toFixed(1)} · ${total} avaliação${total !== 1 ? 'ões' : ''}</span>`;
  }

  // ── Estrelas no resumo da aba Avaliações ──
  const full = Math.floor(avg);
  const half = avg - full >= 0.5;
  starsEl.innerHTML = Array.from({ length: 5 }, (_, i) =>
    i < full ? '<i class="fa fa-star"></i>' :
    i === full && half ? '<i class="fa fa-star-half-alt"></i>' :
    '<i class="far fa-star"></i>'
  ).join('');

  // ── Barras de distribuição ──
  const dist = [5, 4, 3, 2, 1].map(v => reviews.filter(r => r.rating === v).length);
  barsEl.innerHTML = dist.map((v, i) => `
    <div class="rating-bar-row">
      <span class="rbr-star">${5 - i}★</span>
      <div class="rbr-track"><div class="rbr-fill" style="width:${total ? Math.round(v / total * 100) : 0}%"></div></div>
      <span class="rbr-count">${v}</span>
    </div>`).join('');

  // ── Avatar do formulário ──
  const rvAvatar = document.getElementById('rv-form-avatar');
  const user = OZ.currentUser;
  if (rvAvatar && user) {
    if (user.photo_url) {
      rvAvatar.style.backgroundImage    = `url('${user.photo_url}')`;
      rvAvatar.style.backgroundSize     = 'cover';
      rvAvatar.style.backgroundPosition = 'center';
      rvAvatar.textContent = '';
    } else {
      rvAvatar.textContent = (user.name || user.email || '?')[0].toUpperCase();
    }
  }

  // ── Esconde formulário se já avaliou ──
  const myReview = reviews.find(r => r.user_id === user?.id);
  const formWrap = document.getElementById('rv-form-wrap');
  if (formWrap) formWrap.style.display = myReview ? 'none' : '';

  reviewEl.innerHTML = '';

  if (!reviews.length) {
    reviewEl.innerHTML = `
      <div class="rv-empty">
        <i class="fa fa-comment-slash"></i>
        <p>Ainda sem comentários.<br>Seja o primeiro a avaliar!</p>
      </div>`;
    return;
  }

  // Ordena: sem resposta do bar primeiro, depois por data desc
  reviews.sort((a, b) => {
    if (!a.bar_reply && b.bar_reply) return -1;
    if (a.bar_reply && !b.bar_reply) return 1;
    return (b.created_at || 0) - (a.created_at || 0);
  });

  reviews.forEach(r => {
    const initials = (r.user_name || '?')[0].toUpperCase();
    const date     = _fmtDate(r.created_at);
    const isOwn    = user && r.user_id === user.id;

    const replyHtml = r.bar_reply ? `
      <div class="rv-bar-reply">
        <div class="rv-bar-reply-header">
          <i class="fa fa-store"></i>
          <span class="rv-bar-reply-name">${r.bar_name || 'Bar'}</span>
          <span class="rv-bar-reply-date">${_fmtDate(r.bar_reply_at)}</span>
        </div>
        <p class="rv-bar-reply-text">${r.bar_reply}</p>
      </div>` : '';

    const div = document.createElement('div');
    div.className = 'rv-item';
    div.dataset.reviewId = r.id;
    div.innerHTML = `
      <div class="rv-item-header">
        <div class="rv-avatar">${initials}</div>
        <div class="rv-meta">
          <span class="rv-name">${r.user_name || 'Anônimo'}${isOwn ? ' <span class="rv-own-tag">Você</span>' : ''}</span>
          <div class="rv-stars">${_starsHtml(r.rating || 0)}</div>
          <span class="rv-date">${date}</span>
        </div>
      </div>
      ${r.comment ? `<p class="rv-comment">${r.comment}</p>` : ''}
      ${replyHtml}`;
    reviewEl.appendChild(div);
  });
}

/* ─── Contador de caracteres do textarea ─── */
OZ.reviewStars = 0;
document.addEventListener('DOMContentLoaded', () => {
  const ta  = document.getElementById('brf-text');
  const cnt = document.getElementById('rv-char-hint');
  if (ta && cnt) {
    ta.addEventListener('input', () => {
      cnt.textContent = `${ta.value.length} / 500`;
    });
  }
});

/* ─── Seletor de estrelas ─── */
function setReviewStar(v) {
  OZ.reviewStars = v;
  document.querySelectorAll('#brf-stars-row .rv-star-btn').forEach((btn, i) => {
    const filled = i < v;
    btn.innerHTML = `<i class="${filled ? 'fa' : 'far'} fa-star"></i>`;
    btn.classList.toggle('active', filled);
  });
}

/* ─── Enviar comentário (cliente) ─── */
async function submitReview() {
  const user = OZ.currentUser;
  if (!user) { showToast('Faça login para comentar.', 'error'); return; }
  const bar   = OZ.currentBar;
  if (!bar)   return;
  const stars = OZ.reviewStars;
  const text  = (document.getElementById('brf-text')?.value || '').trim();

  if (!stars) { showToast('Selecione a quantidade de estrelas.', 'error'); return; }
  if (!text)  { showToast('Escreva um comentário antes de publicar.', 'error'); return; }
  if (text.length > 500) { showToast('Comentário muito longo (máx 500 caracteres).', 'error'); return; }

  const btn = document.getElementById('rv-submit-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Enviando...'; }

  try {
    await apiPost('tables/reviews', {
      bar_id:     bar.id,
      bar_name:   bar.name,
      user_id:    user.id,
      user_name:  user.name || user.email,
      user_photo: user.photo_url || '',
      rating:     stars,
      comment:    text,
      bar_reply:  '',
      bar_reply_at: null,
    });
    OZ.reviewStars = 0;
    setReviewStar(0);
    const ta = document.getElementById('brf-text');
    if (ta) ta.value = '';
    const cnt = document.getElementById('rv-char-hint');
    if (cnt) cnt.textContent = '0 / 500';
    showToast('Comentário publicado! Obrigado ⭐', 'success');
    // Invalida cache para que a home reflita a nova nota
    if (OZ._ratingsCache && bar.id) delete OZ._ratingsCache[bar.id];
    await loadRealReviews(bar);
  } catch {
    showToast('Erro ao publicar comentário.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa fa-paper-plane"></i> Publicar'; }
  }
}

/* Compatibilidade com chamadas antigas */
function renderBarRatings(bar) { loadRealReviews(bar); }

/* ═══════════════════════════════════════════════════════════
   MODAL DE AVALIAÇÃO — Histórico de Ativações
═══════════════════════════════════════════════════════════ */

OZ._histReviewStars  = 0;
OZ._histReviewBarId  = null;
OZ._histReviewBarName = null;
OZ._myReviewedBars   = new Set(); // cache: bar_ids já avaliados pelo usuário

/* Pré-carrega os bar_ids já avaliados pelo usuário (chamado no loadHistory) */
async function _loadMyReviewedBars() {
  const user = OZ.currentUser;
  if (!user) return;
  try {
    const res = await fetch('tables/reviews?limit=500');
    if (!res.ok) return;
    const data = await res.json();
    OZ._myReviewedBars = new Set(
      (data.data || [])
        .filter(r => r.user_id === user.id)
        .map(r => r.bar_id)
    );
    // Guarda também os objetos completos para exibir no modal "já avaliado"
    OZ._myReviewsMap = {};
    (data.data || []).filter(r => r.user_id === user.id)
      .forEach(r => { OZ._myReviewsMap[r.bar_id] = r; });
  } catch { /* silencioso */ }
}

/* Abre o modal */
async function openHistReviewModal(barId, barName) {
  const modal   = document.getElementById('hist-review-modal');
  const formEl  = document.getElementById('hrm-form');
  const alrEl   = document.getElementById('hrm-already');
  const errEl   = document.getElementById('hrm-error');
  if (!modal) return;

  OZ._histReviewBarId   = barId;
  OZ._histReviewBarName = barName;

  // Reseta estado
  OZ._histReviewStars = 0;
  setHistReviewStar(0);
  const ta = document.getElementById('hrm-textarea');
  if (ta) ta.value = '';
  document.getElementById('hrm-char').textContent = '0 / 500';
  if (errEl) errEl.style.display = 'none';

  document.getElementById('hrm-bar-name').textContent = barName;

  // Verifica se já avaliou (primeiro usa cache, depois confirma na API)
  let existing = OZ._myReviewsMap && OZ._myReviewsMap[barId];
  if (!existing) {
    // Tenta buscar da API caso o cache ainda não tenha sido carregado
    await _loadMyReviewedBars();
    existing = OZ._myReviewsMap && OZ._myReviewsMap[barId];
  }

  if (existing) {
    // Mostra estado "já avaliado"
    formEl.style.display = 'none';
    alrEl.style.display  = 'flex';
    const alrStars = document.getElementById('hrm-already-stars');
    if (alrStars) alrStars.innerHTML = _starsHtml(existing.rating || 0);
    const alrCmt = document.getElementById('hrm-already-comment');
    if (alrCmt) alrCmt.textContent = existing.comment
      ? `"${existing.comment}"`
      : 'Você não deixou comentário.';
  } else {
    formEl.style.display = 'flex';
    alrEl.style.display  = 'none';
  }

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

/* Fecha o modal */
function closeHistReviewModal(e) {
  if (e && e.target !== document.getElementById('hist-review-modal')) return;
  document.getElementById('hist-review-modal').style.display = 'none';
  document.body.style.overflow = '';
}

/* Seletor de estrelas */
function setHistReviewStar(v) {
  OZ._histReviewStars = v;
  const labels = ['', 'Horrível 😣', 'Ruim 😕', 'Ok 😐', 'Bom 😊', 'Excelente! 🤩'];
  const hint   = document.getElementById('hrm-star-hint');
  if (hint) hint.textContent = v ? labels[v] : 'Toque nas estrelas para avaliar';
  document.querySelectorAll('#hrm-stars-row .hrm-star-btn').forEach((btn, i) => {
    const filled = i < v;
    btn.innerHTML = `<i class="${filled ? 'fa' : 'far'} fa-star"></i>`;
    btn.classList.toggle('active', filled);
  });
}

/* Submete a avaliação */
async function submitHistReview() {
  const user    = OZ.currentUser;
  const barId   = OZ._histReviewBarId;
  const barName = OZ._histReviewBarName;
  const stars   = OZ._histReviewStars;
  const text    = (document.getElementById('hrm-textarea')?.value || '').trim();
  const errEl   = document.getElementById('hrm-error');
  const btn     = document.getElementById('hrm-submit-btn');

  if (errEl) errEl.style.display = 'none';

  if (!stars) {
    errEl.textContent = 'Selecione uma nota antes de publicar.';
    errEl.style.display = 'block';
    return;
  }
  if (text.length > 500) {
    errEl.textContent = 'Comentário muito longo (máx 500 caracteres).';
    errEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Enviando…';

  try {
    await apiPost('tables/reviews', {
      bar_id:       barId,
      bar_name:     barName,
      user_id:      user.id,
      user_name:    user.name || user.email,
      user_photo:   user.photo_url || '',
      rating:       stars,
      comment:      text,
      bar_reply:    '',
      bar_reply_at: null,
    });

    // Atualiza cache local
    if (!OZ._myReviewedBars) OZ._myReviewedBars = new Set();
    OZ._myReviewedBars.add(barId);
    if (!OZ._myReviewsMap) OZ._myReviewsMap = {};
    OZ._myReviewsMap[barId] = { bar_id: barId, bar_name: barName,
      user_id: user.id, rating: stars, comment: text };

    // Invalida cache de notas da home
    if (OZ._ratingsCache && barId) delete OZ._ratingsCache[barId];

    showToast('Avaliação publicada! Obrigado ⭐', 'success');
    closeHistReviewModal();

    // Re-renderiza a lista para atualizar o botão "Avaliar" → "Avaliado"
    _renderHistActs(OZ._histAllActs || [], OZ._histFilter || 'all');

  } catch {
    errEl.textContent = 'Erro ao publicar. Tente novamente.';
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa fa-paper-plane"></i> Publicar avaliação';
  }
}

/* ─────────────────────────────────────────────────────────
   LADO BAR — painel de comentários + respostas
───────────────────────────────────────────────────────── */
OZ._barCommentsCache = [];
OZ._barCommentsFilter = 'all';

async function loadBarComments() {
  const user = OZ.currentUser;
  if (!user?.bar_id) return;
  const listEl = document.getElementById('bar-comments-list');
  if (!listEl) return;

  listEl.innerHTML = '<div class="bex-comments-loading"><i class="fa fa-spinner fa-spin"></i><p>Carregando...</p></div>';

  try {
    const res  = await apiGet('tables/reviews?limit=200');
    const all  = (res.data || []).filter(r => r.bar_id === user.bar_id);
    all.sort((a, b) => (!a.bar_reply ? -1 : 1) || (b.created_at - a.created_at));
    OZ._barCommentsCache = all;
    _renderBarComments(all);

    // Badge: sem resposta
    const pending = all.filter(r => !r.bar_reply).length;
    const badgeEl = document.getElementById('btab-comentarios-badge');
    if (badgeEl) {
      badgeEl.style.display = pending ? '' : 'none';
      badgeEl.textContent   = pending > 9 ? '9+' : String(pending);
    }
  } catch {
    listEl.innerHTML = '<div class="bex-comments-loading"><i class="fa fa-exclamation-circle"></i><p>Erro ao carregar.</p></div>';
  }
}

function filterBarComments(filter) {
  OZ._barCommentsFilter = filter;
  document.querySelectorAll('.bex-cf-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.filter === filter));
  let list = OZ._barCommentsCache;
  if (filter === 'pending') list = list.filter(r => !r.bar_reply);
  if (filter === 'replied') list = list.filter(r =>  r.bar_reply);
  _renderBarComments(list);
}

function _renderBarComments(reviews) {
  const listEl = document.getElementById('bar-comments-list');
  if (!listEl) return;

  if (!reviews.length) {
    listEl.innerHTML = `
      <div class="bex-comments-empty">
        <i class="fa fa-comment-slash"></i>
        <p>${OZ._barCommentsFilter === 'pending'
          ? 'Todos os comentários foram respondidos! 🎉'
          : 'Nenhum comentário ainda.'}</p>
      </div>`;
    return;
  }

  listEl.innerHTML = '';
  reviews.forEach(r => {
    const initials = (r.user_name || '?')[0].toUpperCase();
    const date     = _fmtDate(r.created_at);
    const hasReply = !!r.bar_reply;

    const card = document.createElement('div');
    card.className = `bex-comment-card${hasReply ? ' replied' : ''}`;
    card.dataset.reviewId = r.id;
    card.innerHTML = `
      <!-- Cabeçalho do cliente -->
      <div class="bex-cc-client-row">
        <div class="bex-cc-avatar">${initials}</div>
        <div class="bex-cc-meta">
          <span class="bex-cc-name">${r.user_name || 'Anônimo'}</span>
          <div class="bex-cc-stars">${_starsHtml(r.rating || 0)}</div>
          <span class="bex-cc-date">${date}</span>
        </div>
        ${hasReply ? '<span class="bex-cc-replied-tag"><i class="fa fa-check"></i> Respondido</span>' : '<span class="bex-cc-pending-tag"><i class="fa fa-clock"></i> Aguardando</span>'}
      </div>
      ${r.comment ? `<p class="bex-cc-comment">"${r.comment}"</p>` : ''}

      <!-- Resposta existente -->
      ${hasReply ? `
      <div class="bex-cc-reply-box">
        <div class="bex-cc-reply-header">
          <i class="fa fa-store"></i><span>Sua resposta</span>
          <span class="bex-cc-reply-date">${_fmtDate(r.bar_reply_at)}</span>
          <button class="bex-cc-edit-btn" onclick="editBarReply('${r.id}')">
            <i class="fa fa-pen"></i> Editar
          </button>
        </div>
        <p class="bex-cc-reply-text" id="bcc-reply-text-${r.id}">${r.bar_reply}</p>
      </div>` : ''}

      <!-- Formulário de resposta -->
      <div class="bex-cc-reply-form" id="bcc-form-${r.id}" style="${hasReply ? 'display:none' : ''}">
        <textarea class="bex-cc-textarea" id="bcc-ta-${r.id}"
          placeholder="Responda este comentário..."
          maxlength="600" rows="2">${hasReply ? r.bar_reply : ''}</textarea>
        <div class="bex-cc-form-actions">
          <span class="bex-cc-char" id="bcc-char-${r.id}">0/600</span>
          <button class="bex-cc-cancel-btn" onclick="cancelBarReply('${r.id}')" style="${hasReply ? '' : 'display:none'}">Cancelar</button>
          <button class="bex-cc-send-btn" onclick="submitBarReply('${r.id}')">
            <i class="fa fa-paper-plane"></i> ${hasReply ? 'Salvar' : 'Responder'}
          </button>
        </div>
      </div>`;

    // Contador de chars no textarea
    const ta = card.querySelector(`#bcc-ta-${r.id}`);
    const ch = card.querySelector(`#bcc-char-${r.id}`);
    if (ta && ch) {
      ta.addEventListener('input', () => { ch.textContent = `${ta.value.length}/600`; });
    }

    listEl.appendChild(card);
  });
}

/* Abre edição de resposta existente */
function editBarReply(reviewId) {
  const formEl = document.getElementById(`bcc-form-${reviewId}`);
  const taEl   = document.getElementById(`bcc-ta-${reviewId}`);
  const charEl = document.getElementById(`bcc-char-${reviewId}`);
  const card   = document.querySelector(`.bex-comment-card[data-review-id="${reviewId}"]`);
  const rev    = OZ._barCommentsCache.find(r => r.id === reviewId);

  if (!formEl) return;
  formEl.style.display = '';
  if (taEl && rev) {
    taEl.value = rev.bar_reply || '';
    if (charEl) charEl.textContent = `${taEl.value.length}/600`;
    taEl.focus();
  }
  // Mostra botão cancelar
  const cancelBtn = formEl.querySelector('.bex-cc-cancel-btn');
  if (cancelBtn) cancelBtn.style.display = '';
}

function cancelBarReply(reviewId) {
  const formEl = document.getElementById(`bcc-form-${reviewId}`);
  if (formEl) formEl.style.display = 'none';
}

async function submitBarReply(reviewId) {
  const taEl  = document.getElementById(`bcc-ta-${reviewId}`);
  const reply = (taEl?.value || '').trim();
  if (!reply) { showToast('Escreva uma resposta antes de enviar.', 'error'); return; }

  const btn = document.querySelector(`.bex-comment-card[data-review-id="${reviewId}"] .bex-cc-send-btn`);
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i>'; }

  try {
    await apiPatch(`tables/reviews/${reviewId}`, {
      bar_reply:    reply,
      bar_reply_at: Date.now(),
    });
    showToast('Resposta publicada! ✅', 'success');
    await loadBarComments();
  } catch {
    showToast('Erro ao salvar resposta.', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa fa-paper-plane"></i> Salvar'; }
  }
}

/* ══════════════════════════════════
   ATIVAÇÃO — MODAL
══════════════════════════════════ */

/*
 * Retorna a "chave do dia" considerando que a noite começa antes de 6h.
 * Ex: 03:00 de quarta ainda é "terça-feira noturna" → usa a data de ontem.
 */
/* ─────────────────────────────────────────────────────────────
   HELPERS DE DATA LOCAL
   IMPORTANTE: todas as comparações de data usam hora LOCAL do
   dispositivo (getFullYear/Month/Date/Hours), nunca toISOString()
   que retorna UTC e causaria virada errada em BRT (UTC-3).
───────────────────────────────────────────────────────────── */

/** Retorna 'YYYY-MM-DD' no fuso local do dispositivo */
function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * nightDateKey()
 * A "noite" vai das 06h00 até 05h59 do dia seguinte.
 * Se agora for antes das 06h (madrugada), pertence à noite ANTERIOR.
 * Retorna 'YYYY-MM-DD' no horário LOCAL.
 */
function nightDateKey() {
  const now = new Date();
  if (now.getHours() < 6) {
    const prev = new Date(now);
    prev.setDate(prev.getDate() - 1);
    return localDateStr(prev);
  }
  return localDateStr(now);
}

/* ─────────────────────────────────────────────────────────────
   WATCHER DE EXPIRAÇÃO ÀS 06H00
   Agenda um timeout preciso até as próximas 06h00 e, ao disparar:
   - Recarrega promoções na home e no painel do bar
   - Reseta o cache de ativações diárias do cliente
   - Exibe toast avisando que os benefícios expiraram
   Reagenda automaticamente para as próximas 06h00.
───────────────────────────────────────────────────────────── */
function scheduleExpiryWatcher() {
  const now  = new Date();
  const next = new Date(now);

  // Calcula quanto tempo falta para as próximas 06h00
  if (now.getHours() >= 6) {
    next.setDate(next.getDate() + 1); // amanhã às 06h
  }
  next.setHours(6, 0, 0, 0);

  const msUntil6am = next.getTime() - now.getTime();

  setTimeout(() => {
    // Dispara ao bater 06h00
    _onDailyExpiry();
    // Reagenda para as próximas 06h00 (24h depois)
    scheduleExpiryWatcher();
  }, msUntil6am);
}

function _onDailyExpiry() {
  // 1) Reseta cache de ativações do cliente para forçar nova verificação
  OZ._todayActs = { usedIndividual: new Set(), usedNight: false, usedNightBars: new Set() };
  OZ.freeCreditsAvailable   = 0;
  OZ.freeCreditIds          = [];
  OZ.activeNightSession     = null;
  OZ._activePickPromoter    = null;  // pick da indicação ativa (limpa ao dia virar)
  OZ._pickBarId             = null;  // bar vinculado ao pick ativo

  // 2) Recarrega bares/promoções se a home estiver visível
  const homeActive = document.getElementById('screen-home')?.classList.contains('active');
  if (homeActive) {
    if (typeof loadBars === 'function')         loadBars();
    if (typeof checkNightBanner === 'function') checkNightBanner();
  }

  // 3) Para o bar: fecha a lista ao vivo às 06h00 e recarrega o painel
  const barPanelActive = document.getElementById('screen-bar-panel')?.classList.contains('active');
  if (barPanelActive) {
    if (typeof closeResultsList === 'function') closeResultsList('expiry');
    if (typeof loadBarPanel     === 'function') loadBarPanel();
  }

  // 4) Recarrega detalhe do bar se aberto (oculta promoções expiradas)
  const barDetailActive = document.getElementById('screen-bar-detail')?.classList.contains('active');
  if (barDetailActive && OZ.currentBar && typeof loadBarPromotions === 'function') {
    loadBarPromotions(OZ.currentBar);
  }

  // 5) ★ Ao virar o dia (6h), limpa só a pick_date do dia anterior (não o pick em si)
  //    O promoter pode escolher um novo bar no novo dia.
  const role = OZ.currentUser?.role;
  if (role === 'promoter') {
    const todayStr = localDateStr(new Date());
    const pickDate = OZ.currentUser?.promoter_pick_date || '';
    // Se a indicação é de um dia anterior, reseta pick + pick_date no banco e localmente
    if (pickDate && pickDate !== todayStr) {
      OZ.currentUser.promoter_pick_date = '';
      OZ.currentUser.promoter_pick      = '';
      localStorage.setItem('oz_user', JSON.stringify(OZ.currentUser));
      // Persiste reset no banco (fire-and-forget)
      apiPatch(`tables/users/${OZ.currentUser.id}`, {
        promoter_pick:      '',
        promoter_pick_date: '',
      }).catch(() => {});
    }
    // Recarrega perfil do promoter se visível
    const prxProfileActive = document.getElementById('screen-promoter-profile')?.classList.contains('active');
    if (prxProfileActive && typeof loadPromoterPick === 'function') loadPromoterPick();
  }

  // 6) ★ Recarrega tela de indicações (picks) para todos os roles
  const picksActive = document.getElementById('screen-picks')?.classList.contains('active');
  if (picksActive && typeof loadPicksScreen === 'function') loadPicksScreen();

  // 7) ★ Recarrega card de indicação do promoter no perfil do cliente
  if (role === 'cliente') {
    OZ._clientPickBarData = null;
    if (typeof loadClientPromoterPick === 'function') loadClientPromoterPick();
  }

  // 8) Toast discreto para o usuário
  if (role === 'cliente' || role === 'promoter') {
    showToast('☀️ Nova rodada! Benefícios de ontem expiraram às 06h.', 'info');
  } else if (role === 'bar') {
    showToast('☀️ 06h00 — benefícios de ontem foram encerrados automaticamente.', 'info');
  }
}

// Inicia o watcher assim que o script carrega
scheduleExpiryWatcher();

/* ══════════════════════════════════════════════════════════
   HELPERS — CONTROLE DE LIMITE DE ATIVAÇÕES
══════════════════════════════════════════════════════════ */

/**
 * Verifica (sempre buscando dado fresco da API) se a promoção ativa
 * de um bar atingiu o limite de ativações definido pelo bar.
 * Suporta tanto promos ao vivo (tables/promotions) quanto
 * benefícios agendados para hoje (tables/scheduled_benefits).
 * Retorna { full: bool, max: number, current: number, promo: object|null, isScheduled: bool }
 */
async function _checkPromoLimit(barId) {
  // Determina se o benefício em cache é agendado
  const cachedPromo = (allPromos[barId] || [])[0] || null;
  const isScheduled = cachedPromo?._source === 'scheduled';

  try {
    if (isScheduled && cachedPromo?.id) {
      // ── Agendado: conta ativações reais do dia em tables/activations ──
      // (mais confiável que o campo activations_count, que pode estar desatualizado)
      // Usa _todayStr() para regra das 06h; cutoff às 06h00 do dia do evento
      const todayStr = _todayStr();
      const [sy, sm, sd] = todayStr.split('-').map(Number);
      const dayStart = new Date(sy, sm - 1, sd, 6, 0, 0, 0).getTime();
      const [freshSched, actsRes] = await Promise.all([
        apiGet(`tables/scheduled_benefits/${cachedPromo.id}`),
        apiGet(`tables/activations?limit=500`),
      ]);
      const max = (freshSched?.max_activations) || 0;
      if (max === 0) return { full: false, max: 0, current: 0, promo: freshSched, isScheduled: true };

      // Conta ativações ativas (não canceladas, não crédito) deste bar hoje
      const current = (actsRes.data || []).filter(a =>
        a.bar_id === barId &&
        a.status !== 'cancelled' &&
        a.type !== 'free_credit' &&
        a.type !== 'free_credit_used' &&
        (a.created_at ? new Date(a.created_at).getTime() >= dayStart : true)
      ).length;

      // Atualiza cache local com dado fresco
      if (allPromos[barId] && allPromos[barId][0]) {
        allPromos[barId][0].activations_count = current;
        allPromos[barId][0].max_activations   = max;
      }
      // Atualiza também o campo no banco para consistência visual (não bloqueia)
      if (freshSched?.id) {
        apiPatch(`tables/scheduled_benefits/${freshSched.id}`, { activations_count: current }).catch(() => {});
      }
      return { full: current >= max, max, current, promo: freshSched, isScheduled: true };
    } else {
      // ── Promo ao vivo: busca em tables/promotions ──
      const res   = await apiGet(`tables/promotions?limit=50`);
      const promos = (res.data || []).filter(p => p.bar_id === barId && isPromoActive(p));
      if (promos.length) allPromos[barId] = promos; // atualiza cache
    }
  } catch { /* usa cache se falhar */ }

  const promo   = (allPromos[barId] || [])[0] || null;
  const max     = promo?.max_activations || 0;
  const current = promo?.activations_count || 0;
  return { full: max > 0 && current >= max, max, current, promo, isScheduled: !!promo?._source };
}

/**
 * Exibe o estado "Vagas esgotadas" no modal de ativação.
 */
function _showVagasEsgotadas(max) {
  const elAlready    = document.getElementById('act-already-used');
  const elOptionsWrap= document.getElementById('act-options-wrap');
  const elNightDirect= document.getElementById('act-night-direct');
  const elFreeBanner = document.getElementById('activate-free-banner');
  const ctxCard      = document.getElementById('act-context-card');
  const titleEl      = document.getElementById('act-already-title');
  const subEl        = document.getElementById('act-already-sub');
  const hintEl       = document.querySelector('.act-already-other-hint');

  if (titleEl) titleEl.textContent = '⚠️ Vagas esgotadas';
  if (subEl)   subEl.textContent   = `Este benefício já atingiu o limite de ${max} ativação${max !== 1 ? 'ões' : ''} e não está mais disponível.`;
  if (hintEl)  hintEl.style.display = 'none';
  if (elAlready)     elAlready.style.display     = 'block';
  if (elOptionsWrap) elOptionsWrap.style.display = 'none';
  if (elNightDirect) elNightDirect.style.display = 'none';
  if (ctxCard)       ctxCard.style.display       = 'none';
  if (elFreeBanner)  elFreeBanner.style.display  = 'none';
}

/**
 * Restaura o hint "Quer ir a outro bar?" quando o estado "já ativado" for exibido normalmente.
 */
function _restoreAlreadyHint() {
  const hintEl = document.querySelector('.act-already-other-hint');
  if (hintEl) hintEl.style.display = '';
}

/*
 * checkDailyLimit(allActs)
 * Analisa as ativações do usuário e retorna:
 *   usedIndividual: Set de bar_ids já ativados de forma unitária hoje
 *   usedNight: true/false — se já usou o night_link hoje
 */
function checkDailyLimit(allActs, userId, role) {
  /* Usa nightDateKey() para ambas as comparações:
     madrugadas antes das 6h pertencem ao "dia anterior"
     garantindo que a sessão da noite seja tratada como 1 só dia. */
  const today = nightDateKey();
  const usedIndividual = new Set(); // bar_ids onde usou benefício individual
  const usedNightBars  = new Set(); // bar_ids onde fez night_checkin hoje
  let usedNight = false;

  // Para promoters: só bloqueia se o status for 'active' (confirmado pelo bar/webhook).
  // Ativações 'pending_payment' não bloqueiam — o pagamento pode falhar e o
  // promoter precisa poder tentar novamente sem ficar preso num estado provisório.
  const isPromoter = role === 'promoter';

  allActs.forEach(a => {
    if (a.user_id !== userId) return;
    // Ignora tipos de crédito — só conta ativações reais
    if (a.type === 'free_credit' || a.type === 'free_credit_used') return;
    // Ativações CANCELADAS pelo bar não bloqueiam o cliente — ele pode reativar
    if (a.status === 'cancelled') return;
    // Para promoters: só ativações confirmadas (active) bloqueiam
    if (isPromoter && a.status !== 'active') return;

    // Ativações antecipadas (advance_*): a data relevante é benefit_date,
    // não o created_at (que pode ser de outro dia quando a reserva foi feita).
    // Só bloqueia o bar se benefit_date === hoje.
    const isAdvance = a.type === 'advance_individual' || a.type === 'advance_night' || a.type === 'advance_free';
    if (isAdvance) {
      if (a.benefit_date === today) {
        if (a.bar_id) usedIndividual.add(a.bar_id);
      }
      // benefit_date diferente de hoje → ignora completamente (não bloqueia)
      return;
    }

    // Ativações normais: usa created_at com regra noturna
    // Para night_link/night: aceita também benefit_date === today (comprado ontem, válido hoje)
    const aDay = nightDateKeyFromTs(a.created_at);
    const aBenefitDay = a.benefit_date || '';
    const isToday = aDay === today || aBenefitDay === today;
    if (!isToday) return;

    if (a.type === 'night_link' || a.type === 'night') {
      usedNight = true;
      // O bar onde comprou a Noite Toda também é marcado como visitado
      if (a.bar_id) usedNightBars.add(a.bar_id);
    } else if (a.type === 'night_checkin') {
      // Check-in em bar via Noite Toda → registra o bar visitado
      if (a.bar_id) usedNightBars.add(a.bar_id);
    } else {
      // individual / free_used → registra o bar_id
      if (a.bar_id) usedIndividual.add(a.bar_id);
    }
  });

  return { usedIndividual, usedNight, usedNightBars };
}

/**
 * nightDateKeyFromTs(ts)
 * Mesma regra de nightDateKey(), mas recebe um timestamp em ms.
 * Usa hora LOCAL (getHours) — nunca UTC.
 */
function nightDateKeyFromTs(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (d.getHours() < 6) {
    d.setDate(d.getDate() - 1);
  }
  return localDateStr(d);
}

/**
 * _actIsAfterPromoStart
 * Verifica se o cliente fez alguma ativação ATIVA neste bar DEPOIS do início
 * da promoção atual. Usado para permitir reativação quando o bar cancela um
 * benefício e abre outro no mesmo dia.
 *
 * @param {Array}  rawActs      - todas as ativações buscadas da API
 * @param {string} userId
 * @param {string} barId
 * @param {number} promoStartTs - timestamp (ms) do início da promo atual (0 = sem promo)
 * @param {string} kind         - 'individual' | 'night_checkin'
 */
function _actIsAfterPromoStart(rawActs, userId, barId, promoStartTs, kind, role) {
  if (!rawActs) return true; // sem dados: assume bloqueado (comportamento conservador)
  const today = nightDateKey();
  const isPromoter = role === 'promoter';

  return rawActs.some(a => {
    if (a.user_id  !== userId)  return false;
    if (a.bar_id   !== barId)   return false;
    if (a.status   === 'cancelled') return false;
    // Para promoters: só ativações confirmadas (active) contam como bloqueantes
    if (isPromoter && a.status !== 'active') return false;
    if (a.type === 'free_credit' || a.type === 'free_credit_used') return false;

    // Ativações antecipadas (advance_*): só bloqueiam se benefit_date === hoje.
    // Se benefit_date for null (registro antigo) ou outra data → não bloqueia.
    const isAdvance = a.type === 'advance_individual' || a.type === 'advance_night' || a.type === 'advance_free';
    if (isAdvance) return false; // nunca bloqueia via _actIsAfterPromoStart — checkDailyLimit já trata

    if (nightDateKeyFromTs(a.created_at) !== today) return false;

    // Verifica o tipo
    const matchKind = kind === 'individual'
      ? (a.type === 'individual' || a.type === 'free_used')
      : (a.type === 'night_checkin');
    if (!matchKind) return false;

    // Se há uma promoção ativa com created_at definido, a ativação deve ser
    // POSTERIOR ao início dessa promoção para bloquear o cliente.
    // Se promoStartTs === 0 (promo sem created_at ou sem promo), bloqueia normalmente.
    if (promoStartTs > 0) {
      const actTs = a.created_at ? new Date(a.created_at).getTime() : 0;
      return actTs >= promoStartTs;
    }
    return true;
  });
}

// _checkPromoLimit está definida acima (única definição — suporta live e scheduled)

/**
 * _showVagasEsgotadas(max)
 * Exibe o bloco de "vagas esgotadas" dentro do modal de ativação,
 * ocultando todos os outros blocos (opções, contexto, banners).
 */
function _showVagasEsgotadas(max) {
  const elLimit      = document.getElementById('act-limit-reached');
  const elAlready    = document.getElementById('act-already-used');
  const elNight      = document.getElementById('act-night-direct');
  const elOptions    = document.getElementById('act-options-wrap');
  const elFreeBanner = document.getElementById('activate-free-banner');
  const ctxCard      = document.getElementById('act-context-card');
  const subEl        = document.getElementById('act-limit-sub');

  if (elLimit)      elLimit.style.display      = 'block';
  if (elAlready)    elAlready.style.display    = 'none';
  if (elNight)      elNight.style.display      = 'none';
  if (elOptions)    elOptions.style.display    = 'none';
  if (elFreeBanner) elFreeBanner.style.display = 'none';
  if (ctxCard)      ctxCard.style.display      = 'none';

  if (subEl) {
    subEl.textContent = max > 0
      ? `Todas as ${max} vaga${max !== 1 ? 's foram' : ' foi'} preenchida${max !== 1 ? 's' : ''}. Benefício indisponível.`
      : 'Todas as vagas deste benefício foram preenchidas.';
  }
}

async function openActivateModal() {
  if (!OZ.currentUser) {
    showToast('Faça login para ativar benefícios.', 'error');
    showScreen('screen-login');
    return;
  }

  // ── Loading no botão CTA enquanto busca dados ──
  const _ctaBtn      = document.getElementById('dp-btn-activate-main');
  const _ctaOriginal = _ctaBtn ? _ctaBtn.innerHTML : null;
  if (_ctaBtn) {
    _ctaBtn.disabled = true;
    _ctaBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Verificando...';
  }

  // Função auxiliar: sempre restaura o botão CTA
  const _restoreCtaBtn = () => {
    if (_ctaBtn && _ctaOriginal) {
      _ctaBtn.disabled  = false;
      _ctaBtn.innerHTML = _ctaOriginal;
    }
  };

  try {
    // ── Verifica se o bar tem benefício agendado para data futura ──
    // Só redireciona se NÃO houver promoção ativa para hoje
    // e NÃO vier de uma ativação forçada para hoje (ex: indicação de pick)
    const _barId = OZ.currentBar?.id;
    const _forceToday = !!OZ._forceActivateToday;
    if (_barId && !_forceToday) {
      const todayStr = _todayStr();
      const temPromoHoje = (allPromos[_barId] || []).some(p => isPromoActive(p));
      if (!temPromoHoje) {
        const schedsRes = await apiGet(`tables/scheduled_benefits?limit=200`).catch(() => null);
        const schedsFuturo = (schedsRes?.data || []).filter(s =>
          s.bar_id === _barId &&
          s.date > todayStr &&      // estritamente futuro (não hoje)
          s.active !== false
        );
        // Também verifica se há agendado para HOJE (não redireciona — ativa normalmente)
        const schedHoje = (schedsRes?.data || []).find(s =>
          s.bar_id === _barId &&
          s.date === todayStr &&
          s.active !== false
        );
        // Só redireciona se não tiver nada hoje E houver agendado futuro
        if (!schedHoje && schedsFuturo.length > 0) {
          _restoreCtaBtn();
          openAdvanceActivateModal(schedsFuturo[0], OZ.currentBar);
          return;
        }
      }
    }

    OZ.selectedBenefit      = null;
    OZ.freeCreditsAvailable = 0;
    OZ.freeCreditIds        = [];
    OZ._todayActs           = { usedIndividual: new Set(), usedNight: false, usedNightBars: new Set() };

    // ── Reset visual de todos os blocos ──
    const elAlready     = document.getElementById('act-already-used');
    const elNightDirect = document.getElementById('act-night-direct');
    const elOptionsWrap = document.getElementById('act-options-wrap');
    const elFreeBanner  = document.getElementById('activate-free-banner');
    const elLimitReach  = document.getElementById('act-limit-reached');

    if (elAlready)     elAlready.style.display     = 'none';
    if (elNightDirect) elNightDirect.style.display  = 'none';
    if (elOptionsWrap) elOptionsWrap.style.display  = 'block';
    if (elFreeBanner)  elFreeBanner.style.display   = 'none';
    if (elLimitReach)  elLimitReach.style.display   = 'none';

    // Restaura header padrão (pode ter sido ocultado em abertura VIP anterior)
    const _modalTitle   = document.querySelector('#modal-activate .modal-title');
    const _modalBarName = document.getElementById('modal-bar-name');
    if (_modalTitle)   _modalTitle.style.display   = '';
    if (_modalBarName) _modalBarName.style.display = '';

    document.querySelectorAll('.benefit-option').forEach(el =>
      el.classList.remove('selected', 'benefit-option-disabled')
    );
    document.querySelectorAll('.benefit-opt-used-tag').forEach(e => e.remove());

    const _selInfo   = document.getElementById('selected-benefit-info');
    const _btnConf   = document.getElementById('btn-confirm-activate');
    const _barNameEl = document.getElementById('modal-bar-name');
    if (_selInfo)   _selInfo.style.display   = 'none';
    if (_btnConf)   _btnConf.style.display   = 'none';
    if (_barNameEl) _barNameEl.textContent   = `📍 ${OZ.currentBar?.name}`;

    // ── Bloco de contexto: benefício + validade + horário ──
    const ctxCard    = document.getElementById('act-context-card');
    const ctxBenefit = document.getElementById('act-context-benefit-text');
    const ctxHoursEl = document.getElementById('act-context-hours');
    const ctxHoursTx = document.getElementById('act-context-hours-text');
    if (ctxCard) {
      const bar         = OZ.currentBar;
      const promoAtiva  = (allPromos[bar?.id] || [])[0];
      const benefitText = promoAtiva?.title || bar?.benefit || 'Benefício exclusivo OZ';
      if (ctxBenefit) ctxBenefit.textContent = benefitText;
      const hours  = bar?.hours || '';
      const ctxSep = document.getElementById('act-context-sep');
      if (hours && ctxHoursEl && ctxHoursTx) {
        ctxHoursTx.textContent = hours;
        ctxHoursEl.style.display = 'inline-flex';
        if (ctxSep) ctxSep.style.display = 'inline';
      } else {
        if (ctxHoursEl) ctxHoursEl.style.display = 'none';
        if (ctxSep)     ctxSep.style.display     = 'none';
      }
      ctxCard.style.display = 'block';
    }

    // ── Busca ativações do dia na API ──
    if (!OZ.currentUser.id.startsWith('demo-')) {
      try {
        const res = await apiGet(`tables/activations?limit=500`);
        const all = res.data || [];

        const free = all.filter(
          a => a.user_id === OZ.currentUser.id &&
               a.type   === 'free_credit' &&
               a.status !== 'cancelled'
        );
        OZ.freeCreditsAvailable = free.length;
        OZ.freeCreditIds = free
          .sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
          .map(a => a.id);

        OZ._todayActs = checkDailyLimit(all, OZ.currentUser.id, OZ.currentUser.role);
        OZ._todayActs._rawActs = all;
      } catch (e) {
        console.warn('[OZ] openActivateModal: erro ao buscar ativações:', e);
        /* mantém defaults — continua o fluxo normalmente */
      }
    }

    const { usedIndividual, usedNight, usedNightBars } = OZ._todayActs;
    const barId = OZ.currentBar?.id;

    const promoAtual   = (allPromos[barId] || [])[0];
    const promoStartTs = promoAtual?.created_at ? new Date(promoAtual.created_at).getTime() : 0;

    // Só bloqueia se a ativação for para hoje — benefícios agendados (data futura) nunca bloqueiam aqui
    const targetDate = OZ._advanceCtx?.sched?.date || null;
    const isTargetToday = !targetDate || targetDate === _todayStr();

    // checkDailyLimit já aplicou a regra correta para promoters (só 'active' bloqueia).
    // Para clientes comuns, qualquer status != 'cancelled' bloqueia (comportamento padrão).
    const alreadyUsedInd = isTargetToday && usedIndividual.has(barId) &&
      _actIsAfterPromoStart(OZ._todayActs._rawActs, OZ.currentUser.id, barId, promoStartTs, 'individual', OZ.currentUser.role);

    const alreadyCheckin = isTargetToday && usedNightBars?.has(barId) &&
      _actIsAfterPromoStart(OZ._todayActs._rawActs, OZ.currentUser.id, barId, promoStartTs, 'night_checkin', OZ.currentUser.role);

    const hasFree  = OZ.freeCreditsAvailable > 0;
    const userName = OZ.currentUser.name || OZ.currentUser.email?.split('@')[0] || 'Cliente';

    /* ══════════════════════════════════════════════════════
       CENÁRIO A — já ativado neste bar → mostra "Você já está na lista"
    ══════════════════════════════════════════════════════ */
    if (alreadyUsedInd || alreadyCheckin) {
      if (elAlready) {
        const promoAtiva  = (allPromos[barId] || [])[0];
        const benefitName = promoAtiva?.title || OZ.currentBar?.benefit || 'este benefício';
        const titleEl = document.getElementById('act-already-title');
        const subEl   = document.getElementById('act-already-sub');
        if (titleEl) titleEl.textContent = 'Você já está na lista deste bar';
        if (subEl) {
          subEl.textContent = (alreadyCheckin && !alreadyUsedInd)
            ? 'Você já está na lista deste bar com o Link da Noite Toda.'
            : `"${benefitName}" já foi ativado hoje neste bar.`;
        }
        _restoreAlreadyHint();
        elAlready.style.display = 'block';
      }
      if (elOptionsWrap) elOptionsWrap.style.display = 'none';
      if (elNightDirect) elNightDirect.style.display = 'none';
      if (ctxCard)       ctxCard.style.display       = 'none';
      if (elFreeBanner)  elFreeBanner.style.display  = 'none';
      _restoreCtaBtn();
      openModal('modal-activate');
      return;
    }

    /* ══════════════════════════════════════════════════════
       CENÁRIO A2 — limite de ativações atingido (dado fresco da API)
    ══════════════════════════════════════════════════════ */
    const limitStatus = await _checkPromoLimit(barId);
    if (limitStatus.full) {
      _showVagasEsgotadas(limitStatus.max);
      _restoreCtaBtn();
      openModal('modal-activate');
      return;
    }

    /* ══════════════════════════════════════════════════════
       CENÁRIO B — Noite Toda ativa, check-in direto
    ══════════════════════════════════════════════════════ */
    if (usedNight) {
      const modalTitle   = document.querySelector('#modal-activate .modal-title');
      const modalBarName = document.getElementById('modal-bar-name');
      if (modalTitle)   modalTitle.style.display   = 'none';
      if (modalBarName) modalBarName.style.display = 'none';

      if (elNightDirect) {
        const nameEl      = document.getElementById('act-night-direct-name');
        const benefitEl   = document.getElementById('act-night-direct-benefit');
        const barNameEl   = document.getElementById('act-night-bar-name');
        const promoAtiva  = (allPromos[barId] || [])[0];
        const benefitName = promoAtiva?.title || OZ.currentBar?.benefit || 'Benefício exclusivo OZ';
        if (nameEl)    nameEl.textContent    = userName;
        if (benefitEl) benefitEl.textContent = benefitName;
        if (barNameEl) barNameEl.textContent = OZ.currentBar?.name || '—';
        elNightDirect.style.display = 'block';
      }
      if (elOptionsWrap) elOptionsWrap.style.display = 'none';
      if (ctxCard)       ctxCard.style.display       = 'none';
      if (elFreeBanner)  elFreeBanner.style.display  = 'none';
      _restoreCtaBtn();
      openModal('modal-activate');
      return;
    }

    /* ══════════════════════════════════════════════════════
       CENÁRIO C — Fluxo normal: exibe as duas opções
    ══════════════════════════════════════════════════════ */
    const priceIndEl   = document.getElementById('opt-individual-price');
    const priceNightEl = document.getElementById('opt-night-price');
    const optInd       = document.getElementById('opt-individual');
    const freeCountEl  = document.getElementById('activate-free-count');

    if (priceIndEl)   priceIndEl.textContent  = hasFree ? '🎁 Grátis' : 'R$5';
    if (priceNightEl) priceNightEl.textContent = 'R$10';
    optInd?.classList.toggle('has-free-credit', hasFree);

    if (elFreeBanner) elFreeBanner.style.display = hasFree ? 'flex' : 'none';
    if (freeCountEl)  freeCountEl.textContent    = OZ.freeCreditsAvailable;

    // Badge informativo "já ativou em X outros bares hoje" (não bloqueia)
    try {
      const otherBarsCount = usedIndividual.size - (usedIndividual.has(barId) ? 1 : 0);
      let multiBadge = document.getElementById('act-multi-bar-badge');
      if (otherBarsCount > 0) {
        if (!multiBadge) {
          multiBadge = document.createElement('div');
          multiBadge.id        = 'act-multi-bar-badge';
          multiBadge.className = 'act-multi-bar-badge';
          const ruleHint = document.querySelector('.act-rule-hint');
          if (ruleHint) ruleHint.insertAdjacentElement('afterend', multiBadge);
          else if (elOptionsWrap) elOptionsWrap.prepend(multiBadge);
        }
        multiBadge.innerHTML    = `<i class="fa fa-map-marker-alt"></i> Você já ativou em ${otherBarsCount} outro${otherBarsCount > 1 ? 's bares' : ' bar'} hoje — pode ativar aqui também! 🎯`;
        multiBadge.style.display = 'flex';
      } else if (multiBadge) {
        multiBadge.style.display = 'none';
      }
    } catch { /* badge é cosmético — ignora falha */ }

    _restoreCtaBtn();
    openModal('modal-activate');

  } catch (err) {
    console.error('[OZ] openActivateModal: erro inesperado:', err);
    showToast('Erro ao abrir ativação. Tente novamente.', 'error');
    _restoreCtaBtn();
  }
}

/* ══════════════════════════════════════════════════════════
   CONFIRMAÇÃO DIRETA — Noite Toda já ativa nesta data
   Apenas registra check-in neste bar, sem cobrar novamente.
══════════════════════════════════════════════════════════ */
async function confirmNightDirectCheckin() {
  const bar  = OZ.currentBar;
  const user = OZ.currentUser;
  if (!bar || !user) return;

  // Check-in subsequente (Noite Toda já ativa) — NUNCA gera comissão de pick.
  // O promoter que recebeu 10% foi o do momento da compra original.
  // Limpa qualquer pick que possa ter ficado ao navegar pela tela de indicações.
  OZ._activePickPromoter = null;
  OZ._pickBarId          = null;

  const btn = document.getElementById('btn-night-direct-confirm');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i><span>Entrando na lista...</span>';
  }

  try {
    const isDemo = user.id.startsWith('demo-');
    let qrData   = OZ.activeNightSession?.qrData || '';
    let expiry   = OZ.activeNightSession?.expiry  || getExpiryTime();
    let nightSession = OZ.activeNightSession?.sessionId || '';

    if (!isDemo) {
      // ══ Verifica limite de ativações antes do check-in ══
      const _limitCheck = await _checkPromoLimit(bar.id);
      if (_limitCheck.full) {
        _showVagasEsgotadas(_limitCheck.max);
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa fa-check-circle"></i><span>Confirmar entrada</span>'; }
        return;
      }

      // ── EDGE FUNCTION: night-checkin (valida night_link ativo no servidor) ──
      // Segurança: o servidor verifica que o cliente tem um night_link active
      // antes de criar o night_checkin. O frontend não pode forjar check-ins.
      let checkinResult;
      try {
        checkinResult = await edgeFn('night-checkin', {
          bar_id:   bar.id,
          bar_name: bar.name,
        });
      } catch (checkinErr) {
        if (checkinErr.status === 409) {
          // Já fez check-in neste bar nesta sessão — exibe QR normalmente
          showToast(`🌙 Você já está na lista de ${bar.name}!`, 'success');
          closeModal('modal-activate');
          if (qrData) setTimeout(() => openQRModal(bar, 'night_link', qrData, false), 350);
          return;
        }
        if (checkinErr.status === 403) {
          showToast('Nenhuma Noite Toda ativa. Adquira o Link da Noite Toda primeiro.', 'error');
          return;
        }
        throw checkinErr; // propaga outros erros para o catch externo
      }

      // Atualiza cache da sessão com dados retornados pelo servidor
      qrData       = checkinResult.qr_code      || qrData;
      expiry       = checkinResult.expires_at    || expiry;
      nightSession = checkinResult.night_session || nightSession;

      if (!OZ.activeNightSession) OZ.activeNightSession = {};
      OZ.activeNightSession.qrData    = qrData;
      OZ.activeNightSession.expiry    = expiry;
      OZ.activeNightSession.sessionId = nightSession;
      user.activations_count = (user.activations_count || 0) + 1;

    } else {
      qrData = qrData || generateQRData('demo', bar.id, 'night_checkin');
    }

    // Fecha modal e exibe feedback VIP
    closeModal('modal-activate');
    showToast(`🌙 Você está na lista de ${bar.name}!`, 'success');

    // Mostra QR da sessão existente (Noite Toda — sem novo cobro)
    setTimeout(() => openQRModal(bar, 'night_link', qrData, false), 350);

  } catch (e) {
    console.error('[OZ] confirmNightDirectCheckin: erro:', e);
    showToast('Erro ao confirmar entrada. Tente novamente.', 'error');
  } finally {
    if (btn) {
      btn.disabled  = false;
      btn.innerHTML = '<i class="fa fa-check-circle"></i><span>Confirmar entrada</span>';
    }
  }
}

function selectBenefit(type) {
  const { usedIndividual, usedNight } = OZ._todayActs || { usedIndividual: new Set(), usedNight: false };

  // Bloqueia seleção se já usou hoje
  if (type === 'individual' && usedIndividual.has(OZ.currentBar?.id)) {
    showToast('Você já ativou este benefício hoje! 🔒', 'error');
    return;
  }
  if ((type === 'night_link' || type === 'night') && usedNight) {
    showToast('Você já usou o Link da Noite hoje! 🔒', 'error');
    return;
  }

  OZ.selectedBenefit = type;
  document.querySelectorAll('.benefit-option').forEach(el => el.classList.remove('selected'));
  const optEl = document.getElementById(type === 'individual' ? 'opt-individual' : 'opt-night');
  if (optEl && !optEl.classList.contains('benefit-option-disabled')) {
    optEl.classList.add('selected');
  }

  const hasFree = OZ.freeCreditsAvailable > 0 && type === 'individual';
  const s = document.getElementById('selected-summary');

  if (hasFree) {
    s.innerHTML = `🎁 <strong>Unitário</strong> — <span class="summary-free-tag">Grátis</span> · Entrada em <strong>${OZ.currentBar?.name}</strong><br><small style="color:rgba(255,255,255,0.45);font-size:11px">1 ativação grátis será descontada do seu saldo (restam ${OZ.freeCreditsAvailable - 1})</small>`;
    const btn = document.getElementById('btn-confirm-activate');
    btn.innerHTML = '<i class="fa fa-gift"></i> Usar ativação grátis';
    btn.className = 'btn btn-free-activate mt-16';
  } else if (type === 'individual') {
    s.innerHTML = `<strong>Unitário</strong> — R$5,00 · Entrada em <strong>${OZ.currentBar?.name}</strong><br><small style="color:rgba(255,255,255,0.45);font-size:11px">Pode ativar em outros bares também 🎯</small>`;
    const btn = document.getElementById('btn-confirm-activate');
    btn.innerHTML = '<i class="fa fa-bolt"></i> Confirmar ativação';
    btn.className = 'btn btn-primary mt-16';
  } else {
    s.innerHTML = `<strong>Link da Noite Toda</strong> — R$10,00 · Válido para <strong>todos os bares parceiros</strong> até as 6h`;
    const btn = document.getElementById('btn-confirm-activate');
    btn.innerHTML = '<i class="fa fa-moon"></i> Ativar Link da Noite Toda';
    btn.className = 'btn btn-primary mt-16';
  }

  document.getElementById('selected-benefit-info').style.display = 'block';
  document.getElementById('btn-confirm-activate').style.display  = 'flex';
}

async function confirmActivation() {
  if (!OZ.selectedBenefit || !OZ.currentBar) return;
  const btn  = document.getElementById('btn-confirm-activate');
  const bar  = OZ.currentBar;
  const type = OZ.selectedBenefit;

  btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Processando...';
  btn.disabled  = true;

  const hasFree = OZ.freeCreditsAvailable > 0 && type === 'individual';
  const isDemo  = OZ.currentUser.id.startsWith('demo-');

  try {
    const qrData = generateQRData(OZ.currentUser.id, bar.id, type);
    const expiry = getExpiryTime();

    // ══ Proteção dupla: verifica vagas antes de processar ══
    if (!isDemo) {
      const _limitCheck = await _checkPromoLimit(bar.id);
      if (_limitCheck.full) { _showVagasEsgotadas(_limitCheck.max); return; }
    }

    const _userName = OZ.currentUser.name || OZ.currentUser.email?.split('@')[0] || 'Cliente';
    if (OZ.currentUser.id) OZ.userNameCache[OZ.currentUser.id] = _userName;

    /* ════════════════════════════════════════════════════════════
       FLUXO GRÁTIS — usa crédito, sem pagamento
    ════════════════════════════════════════════════════════════ */
    if (hasFree && !isDemo) {
      await apiPost('tables/activations', {
        user_id:       OZ.currentUser.id,
        user_name:     _userName,
        bar_id:        bar.id,
        bar_name:      bar.name,
        type:          'free_used',
        amount:        0,
        qr_code:       qrData,
        expires_at:    expiry,
        promoter_id:   '',
        promoter_code: '',
      });

      const creditIdToConsume = OZ.freeCreditIds[0];
      if (creditIdToConsume) await edgeFn('usar-credito-gratis', { credit_id: creditIdToConsume });

      const newCount = (OZ.currentUser.activations_count || 0) + 1;
      await apiPatch(`tables/users/${OZ.currentUser.id}`, { activations_count: newCount });
      OZ.currentUser.activations_count = newCount;
      OZ.freeCreditsAvailable = Math.max(0, OZ.freeCreditsAvailable - 1);
      OZ.freeCreditIds = OZ.freeCreditIds.slice(1);

      _updateTodayActsCache(bar.id, type, qrData, 0);
      closeModal('modal-activate');
      setTimeout(() => openQRModal(bar, type, qrData, true), 200);
      return;
    }

    /* ════════════════════════════════════════════════════════════
       FLUXO DEMO — sem pagamento real
    ════════════════════════════════════════════════════════════ */
    if (isDemo) {
      _updateTodayActsCache(bar.id, type, qrData, type === 'individual' ? 5 : 10);
      closeModal('modal-activate');
      setTimeout(() => openQRModal(bar, type, qrData, false), 200);
      return;
    }

    /* ════════════════════════════════════════════════════════════
       FLUXO PAGO — cria ativação pending + PIX no Mercado Pago
       O frontend NÃO ativa o benefício diretamente.
       Apenas o webhook-pagamento muda status → active.
    ════════════════════════════════════════════════════════════ */

    // referred_by: busca campo atualizado do banco
    let referredById = OZ.currentUser.referred_by || null;
    if (!referredById) {
      try {
        const freshUser = await apiGet(`tables/users/${OZ.currentUser.id}`);
        if (freshUser?.referred_by) {
          referredById = freshUser.referred_by;
          OZ.currentUser.referred_by = freshUser.referred_by;
          localStorage.setItem('oz_user', JSON.stringify(OZ.currentUser));
        }
      } catch { /* usa null se falhar */ }
    }

    const edgeType = (type === 'night_link' || type === 'night') ? 'night' : 'activation';
    // _activePickPromoter é zerado pelo openBarDetail — usa _pendingPickPromoter como fallback
    const pickPromoter = OZ._activePickPromoter || OZ._pendingPickPromoter || null;
    OZ._pendingPickPromoter = null; // limpa após uso

    // Monta body para criar-transacao
    const txBody = {
      type:          edgeType,
      bar_id:        bar.id,
      bar_name:      bar.name,
      qr_code:       qrData,
      expires_at:    expiry,
      promoter_id:   referredById || '',
      promoter_code: referredById || '',
    };
    if (edgeType === 'activation') {
      txBody.pick_promoter = pickPromoter || '';
    }
    if (edgeType === 'night') {
      txBody.night_session       = qrData;
      txBody.night_pick_promoter = pickPromoter || '';
    }

    // Chama criar-transacao: cria ativação pending_payment + PIX
    console.log('[OZ] criar-transacao body:', JSON.stringify(txBody, null, 2));
    let txResult;
    try {
      txResult = await edgeFn('criar-transacao', txBody);
    } catch (edgeErr) {
      console.error('[OZ] criar-transacao falhou:', edgeErr.message, edgeErr.body);
      // Se o MP não estiver configurado (503) ou a edge não foi deployada (404/500),
      // mostra mensagem específica sem cair no catch genérico
      const status = edgeErr.status || 0;
      if (status === 503) throw new Error('Gateway de pagamento nao configurado. Configure MP_ACCESS_TOKEN no Supabase.');
      if (status === 404) throw new Error('Edge Function criar-transacao não encontrada. Execute o deploy.');
      if (status === 401) throw new Error('Token invalido ou expirado. Faça login novamente.');
      if (status === 409) throw new Error(edgeErr.message);
      throw edgeErr;
    }
    console.log('[OZ] criar-transacao resultado:', txResult);

    OZ._activePickPromoter = null;
    OZ._pickBarId          = null;

    // Fecha modal de ativação e abre modal de PIX
    closeModal('modal-activate');
    setTimeout(() => _showPixModal({
      bar,
      type,
      qrData,
      activationId:  txResult.activation_id,
      pixCopyPaste:  txResult.transaction?.pix_copy_paste  || '',
      pixQrCode:     txResult.transaction?.pix_qr_code     || '',
      pixExpiresAt:  txResult.transaction?.pix_expires_at  || '',
      amount:        edgeType === 'night' ? 10 : 5,
    }), 200);

  } catch (err) {
    console.error('[OZ] confirmActivation: erro:', err);
    // Exibe a mensagem real do servidor para facilitar diagnóstico
    const errMsg = err?.message || '';
    if (errMsg.includes('Gateway de pagamento nao configurado') || errMsg.includes('503')) {
      showToast('⚙️ Gateway de pagamento não configurado. Verifique MP_ACCESS_TOKEN.', 'error');
    } else if (errMsg.includes('Token invalido') || errMsg.includes('401')) {
      showToast('Sessão expirada. Faça login novamente.', 'error');
    } else if (errMsg.includes('ja ativou') || errMsg.includes('409')) {
      showToast('Você já ativou este benefício hoje.', 'error');
    } else if (errMsg.includes('inativo') || errMsg.includes('404')) {
      showToast('Bar não encontrado ou inativo.', 'error');
    } else {
      showToast(`Erro: ${errMsg || 'Tente novamente.'}`, 'error');
    }
  } finally {
    btn.innerHTML = (type === 'night_link' || type === 'night')
      ? '<i class="fa fa-moon"></i> Ativar Link da Noite Toda'
      : '<i class="fa fa-bolt"></i> Confirmar ativação';
    btn.className = 'btn btn-primary mt-16';
    btn.disabled  = false;
  }
}

/* ── Helper: atualiza cache local de ativações do dia ─────────────────────── */
function _updateTodayActsCache(barId, type, qrData, amount) {
  if (!OZ._todayActs) return;
  if (type === 'individual' || type === 'free_used') {
    OZ._todayActs.usedIndividual.add(barId);
  } else if (type === 'night_link' || type === 'night') {
    OZ._todayActs.usedNight = true;
    OZ._todayActs.usedNightBars.add(barId);
  }
  if (OZ._todayActs._rawActs) {
    OZ._todayActs._rawActs.push({
      id: qrData, user_id: OZ.currentUser.id, bar_id: barId,
      type, amount, status: 'active', created_at: Date.now(),
    });
  }
}

/* ── Modal de PIX + polling de status ────────────────────────────────────── */
function _showPixModal({ bar, type, qrData, activationId, pixCopyPaste, pixQrCode, pixExpiresAt, amount }) {
  document.getElementById('modal-pix-payment')?.remove();
  clearInterval(OZ._pixPollingId);

  const expiresLabel = pixExpiresAt
    ? new Date(pixExpiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : '30 min';

  const amountLabel = `R$${amount},00`;
  const typeLabel   = type === 'night_link' || type === 'night' ? 'Noite Toda' : 'Unitário';
  const semCodigo   = !pixCopyPaste && !pixQrCode;

  const modal = document.createElement('div');
  modal.id        = 'modal-pix-payment';
  modal.className = 'modal-overlay open';
  modal.innerHTML = `
    <div class="modal-sheet" style="max-width:420px;margin:auto;">
      <div class="modal-header">
        <h3 class="modal-title"><i class="fa fa-qrcode"></i> Pagar com PIX</h3>
        <button class="modal-close" onclick="clearInterval(OZ._pixPollingId);document.getElementById('modal-pix-payment').remove()">
          <i class="fa fa-times"></i>
        </button>
      </div>
      <div class="modal-body" style="text-align:center;padding:24px 20px;">

        <div id="pix-status-pending">
          <p style="color:var(--text-secondary);font-size:14px;margin-bottom:16px;">
            Pague o PIX para ativar <strong>${typeLabel} — ${amountLabel}</strong>
            em <strong>${bar.name}</strong>.
          </p>

          ${pixQrCode ? `
            <div style="background:#fff;border-radius:12px;padding:12px;display:inline-block;margin-bottom:16px;">
              <img src="data:image/png;base64,${pixQrCode}" alt="QR Code PIX"
                   style="width:200px;height:200px;display:block;" />
            </div>
          ` : ''}

          ${pixCopyPaste ? `
            <div id="pix-code-box" style="background:var(--surface-2);border-radius:8px;padding:12px;
                 margin-bottom:12px;word-break:break-all;font-size:11px;color:var(--text-secondary);
                 text-align:left;max-height:72px;overflow:auto;">${pixCopyPaste}</div>
            <button id="btn-pix-copy" class="btn btn-secondary" style="width:100%;margin-bottom:12px;"
                    onclick="document.getElementById('btn-pix-copy')._pixCode && _copyPixCode(document.getElementById('btn-pix-copy')._pixCode)">
              <i class="fa fa-copy"></i> Copiar código PIX
            </button>
          ` : `
            <div style="background:var(--surface-2);border-radius:8px;padding:16px;margin-bottom:12px;
                 color:var(--text-secondary);font-size:13px;">
              <i class="fa fa-info-circle"></i> Código PIX sendo gerado...
              <br><small>Aguarde ou verifique seu app do banco.</small>
            </div>
          `}

          <div style="display:flex;align-items:center;gap:8px;justify-content:center;
               background:var(--surface-2);border-radius:8px;padding:10px 14px;margin-bottom:12px;">
            <i class="fa fa-clock" style="color:var(--warning,#00F5FF);font-size:15px;"></i>
            <span style="font-size:13px;color:var(--text-secondary);">
              Este PIX é válido por <strong>30 minutos</strong>. Após expirar, será necessário gerar um novo.
            </span>
          </div>

          <div id="pix-polling-status" style="display:flex;align-items:center;gap:8px;
               justify-content:center;color:var(--text-secondary);font-size:13px;margin-bottom:16px;">
            <i class="fa fa-spinner fa-spin"></i>
            <span>Aguardando confirmação do pagamento...</span>
          </div>

          <p style="font-size:12px;color:var(--text-tertiary);">
            Expira às <strong>${expiresLabel}</strong>. O benefício é ativado automaticamente após o pagamento.
          </p>
        </div>

        <div id="pix-status-approved" style="display:none;">
          <div style="font-size:64px;margin-bottom:16px;">✅</div>
          <h3 style="color:var(--success);margin-bottom:8px;">Pagamento confirmado!</h3>
          <p style="color:var(--text-secondary);font-size:14px;margin-bottom:20px;">
            <strong>${typeLabel}</strong> em <strong>${bar.name}</strong> está ativo!
          </p>
          <button id="btn-pix-ver" class="btn btn-primary" style="width:100%;">
            <i class="fa fa-check"></i> Ver benefício ativo
          </button>
        </div>

        <div id="pix-status-failed" style="display:none;">
          <div style="font-size:64px;margin-bottom:16px;">❌</div>
          <h3 style="color:var(--danger);margin-bottom:8px;">Pagamento não confirmado</h3>
          <p style="color:var(--text-secondary);font-size:14px;margin-bottom:20px;">
            O PIX expirou ou foi cancelado. Tente novamente.
          </p>
          <button class="btn btn-secondary" style="width:100%;"
                  onclick="clearInterval(OZ._pixPollingId);document.getElementById('modal-pix-payment').remove()">
            Fechar
          </button>
        </div>

      </div>
    </div>`;

  document.body.appendChild(modal);

  // Guarda o código PIX no botão via propriedade JS (sem injetar no HTML)
  const btnCopy = document.getElementById('btn-pix-copy');
  if (btnCopy) btnCopy._pixCode = pixCopyPaste;

  // Botão "Ver benefício ativo" configurado via JS
  const btnVer = document.getElementById('btn-pix-ver');
  if (btnVer) btnVer.addEventListener('click', () => _onPixApproved(activationId, bar.id, type, qrData));

  // ── Polling de status a cada 3s ──────────────────────────────────────────
  // Primário : get-activation-status (edge function)
  // Fallback : tables/activations direto
  // Feedback : toast com mensagem REAL do erro (sem repetição em sequência)
  const MAX_POLL_ERRORS = 10;
  let _pollErrors    = 0;
  let _lastErrMsg    = '';   // debounce: evita toast repetido da mesma mensagem
  let _lastErrAt     = 0;   // timestamp do último toast de erro
  const ERR_DEBOUNCE = 8000; // ms mínimos entre toasts de erro iguais

  // Extrai mensagem legível de qualquer tipo de erro
  function _pollErrMsg(e) {
    if (!e) return 'Erro ao verificar ativação';
    // Erro de rede / timeout (fetch falhou antes de receber resposta)
    if (e instanceof TypeError || (e.message || '').toLowerCase().includes('fetch')) {
      return 'Erro de conexão ao verificar ativação';
    }
    // Mensagem vinda do servidor (via edgeFn ou apiGet)
    return e.message || e.error?.message || e.error || 'Erro ao verificar ativação';
  }

  // Dispara toast de erro com debounce (não repete a mesma msg em 8s)
  function _pollToast(msg) {
    const now = Date.now();
    if (msg === _lastErrMsg && (now - _lastErrAt) < ERR_DEBOUNCE) return;
    _lastErrMsg = msg;
    _lastErrAt  = now;
    showToast(msg, 'error', 4500);
  }

  OZ._pixPollingId = setInterval(async () => {
    try {
      let status   = null;
      let pollErr  = null;

      // ── Primário: edge function get-activation-status ─────────────────
      try {
        const res = await edgeFnGet('get-activation-status', { activation_id: activationId });
        status = res?.status ?? null;
        if (!status) throw new Error(res?.error || 'Resposta inválida da edge function');
        _pollErrors = 0; // reset ao ter sucesso
      } catch (edgeErr) {
        pollErr = edgeErr;
        console.warn('[OZ][poll] edge function falhou, tentando fallback:', edgeErr.message);

        // ── Fallback: lê activations direto ──────────────────────────────
        try {
          const act = await apiGet(`tables/activations/${activationId}`);
          status = act?.status ?? null;
          if (!status) throw new Error('Ativação não encontrada no banco');
          _pollErrors = 0; // fallback funcionou
          pollErr = null;  // limpa o erro pois o fallback resolveu
        } catch (fbErr) {
          // Ambos falharam — incrementa contador e notifica
          _pollErrors++;
          const msg = _pollErrMsg(pollErr); // usa o erro original da edge fn
          console.error(`[OZ][poll] erro #${_pollErrors}/${MAX_POLL_ERRORS}:`, msg, '| fallback:', fbErr.message);
          _pollToast(msg);

          if (_pollErrors >= MAX_POLL_ERRORS) {
            clearInterval(OZ._pixPollingId);
            showToast(`Polling encerrado após ${MAX_POLL_ERRORS} erros. Verifique sua conexão.`, 'error', 6000);
            console.error('[OZ][poll] encerrado após máximo de erros.');
          }
          return; // não processa status nesta iteração
        }
      }

      // ── Processa status retornado ─────────────────────────────────────
      console.log(`[OZ][poll] activation ${activationId} → status: ${status}`);

      if (status === 'active') {
        clearInterval(OZ._pixPollingId);
        document.getElementById('pix-status-pending').style.display  = 'none';
        document.getElementById('pix-status-approved').style.display = 'block';
        _updateTodayActsCache(bar.id, type, qrData, amount);
        // Busca count real do banco para garantir que grantInviterFreeCredit receba valor correto
        let prevCount = OZ.currentUser.activations_count || 0;
        try {
          const freshUser = await apiGet(`tables/users/${OZ.currentUser.id}`);
          if (freshUser?.activations_count !== undefined) {
            prevCount = freshUser.activations_count;
          }
        } catch (_) { /* usa cache se falhar */ }
        OZ.currentUser.activations_count = prevCount + 1;
        OZ.currentUser.total_saved       = (OZ.currentUser.total_saved || 0) + amount;
        grantInviterFreeCredit(OZ.currentUser, prevCount);
        showToast('✅ Pagamento confirmado! Benefício ativado.', 'success');
      } else if (status === 'cancelled' || status === 'failed') {
        clearInterval(OZ._pixPollingId);
        document.getElementById('pix-status-pending').style.display = 'none';
        document.getElementById('pix-status-failed').style.display  = 'block';
        showToast('PIX expirado ou cancelado. Tente novamente.', 'error');
      }
      // pending_payment → continua aguardando silenciosamente

    } catch (e) {
      // Erro inesperado fora do fluxo normal
      _pollErrors++;
      const msg = _pollErrMsg(e);
      console.error(`[OZ][poll] erro inesperado #${_pollErrors}:`, e);
      _pollToast(msg);
      if (_pollErrors >= MAX_POLL_ERRORS) {
        clearInterval(OZ._pixPollingId);
        showToast('Polling encerrado. Verifique sua conexão e tente novamente.', 'error', 6000);
      }
    }
  }, 3000);

  // Para o polling ao fechar clicando no overlay
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      clearInterval(OZ._pixPollingId);
      modal.remove();
    }
  });
}

/* ── Copia código PIX para clipboard ────────────────────────────────────── */
function _copyPixCode(code) {
  navigator.clipboard.writeText(code).then(() => {
    const btn = document.getElementById('btn-pix-copy');
    if (btn) { btn.innerHTML = '<i class="fa fa-check"></i> Copiado!'; setTimeout(() => { btn.innerHTML = '<i class="fa fa-copy"></i> Copiar código PIX'; }, 2000); }
    showToast('Código PIX copiado!', 'success');
  }).catch(() => showToast('Não foi possível copiar. Copie manualmente.', 'error'));
}

/* ── Callback após aprovação no modal PIX ───────────────────────────────── */
function _onPixApproved(activationId, barId, type, qrData) {
  document.getElementById('modal-pix-payment')?.remove();
  clearInterval(OZ._pixPollingId);
  if (OZ.currentBar) setTimeout(() => openQRModal(OZ.currentBar, type, qrData, false), 200);
}

// _activateNightLink removida — substituída por criar-transacao (PIX) em confirmActivation
// e night-checkin (edge function) em confirmNightDirectCheckin.

/* ═══════════════════════════════════════════════════════════════════
   resolveCommissions() — função central de comissões
   Ver detalhamento completo no cabeçalho da função abaixo.
═══════════════════════════════════════════════════════════════════ */
/*
 * ═══════════════════════════════════════════════════════════════════
 *  grantInviterFreeCredit
 *  Recompensa o CLIENTE que convidou com 1 ativação unitária grátis
 *  quando o convidado realiza sua PRIMEIRA ativação (paga ou grátis).
 *
 *  Regras:
 *  - Só dispara se activationsCountBefore === 0 (primeira ativação).
 *  - Só dispara se referred_by aponta para um usuário com role='cliente'.
 *  - Gera um registro free_credit com origin='referral' na tabela activations,
 *    vinculado ao cliente que convidou.
 *  - Não bloqueia o fluxo principal — erros são silenciosos.
 * ═══════════════════════════════════════════════════════════════════
 */
async function grantInviterFreeCredit(newUser, activationsCountBefore) {
  try {
    // Só na primeira ativação
    if (activationsCountBefore !== 0) return;

    const referredById = newUser?.referred_by;
    if (!referredById) return;

    // ── EDGE FUNCTION: grant-free-credit (valida role e idempotência no servidor) ──
    const result = await edgeFn('grant-free-credit', {
      new_user_id: newUser.id,
      inviter_id:  referredById,
    });

    if (result?.success) {
      console.log(`[OZ] free_credit concedido via Edge Function (inviter: ${referredById})`);
    } else if (result?.skipped) {
      console.log(`[OZ] grantInviterFreeCredit ignorado: ${result.message}`);
    }
  } catch (err) {
    // Silencioso — não deve bloquear o fluxo principal
    console.warn('[OZ] grantInviterFreeCredit silenciado:', err?.message || err);
  }
}

/*
 * ═══════════════════════════════════════════════════════════════════
 *  resolveCommissions — Regras de comissão entre promoters
 * ═══════════════════════════════════════════════════════════════════
 *
 *  Valores distribuíveis por ativação (IGUAL para unitário e noite toda):
 *    Unitário  R$5  → R$5 distribuível  / R$0 para plataforma
 *    Noite Toda R$10 → R$5 distribuível  / R$5 para a plataforma (margem fixa)
 *
 *  O "bolo" de R$5 é dividido da mesma forma nos dois casos.
 *
 *  Papéis:
 *    referredBy   = promoter que trouxe o usuário (código de convite no cadastro).
 *                   Vigência: primeiras 3 ativações pagas do usuário.
 *    pickPromoter = promoter que indicou o bar no dia (pick diário).
 *                   Vigência: somente enquanto aquele bar for a indicação ativa.
 *
 *  O bolo sempre é R$5 (unitário) ou R$5 distribuível (noite toda, os outros R$5 ficam
 *  na plataforma). Ref e pick DIVIDEM esse bolo — a plataforma não absorve custo extra.
 *
 *  referredBy = promoter que convidou o usuário para a plataforma (código no cadastro).
 *               Recebe comissão apenas nas primeiras 3 ativações pagas do usuário.
 *  pick       = promoter com aquele bar como indicação ativa no dia.
 *               Recebe R$1 de qualquer ativação via indicação, em qualquer momento.
 *
 *  [A] ref dentro do cap (ativ. 1-5) + pick DIFERENTE do ref:
 *        referredBy   → R$4   — convite (bolo dividido)
 *        pickPromoter → R$1   — indicação de bar
 *
 *  [B] ref dentro do cap + pick = MESMO promoter que ref:
 *        referredBy   → R$5   — recebe tudo (é os dois ao mesmo tempo)
 *
 *  [C] ref dentro do cap + sem pick:
 *        referredBy   → R$5   — recebe tudo
 *
 *  [D] ref FORA do cap (≥ 5 ativ.) + tem pick:
 *        referredBy   → R$0   — teto atingido
 *        pickPromoter → R$1   — só comissão de bar
 *
 *  [E] ref fora do cap + sem pick:
 *        ninguém recebe
 *
 *  [F] sem referredBy + tem pick:
 *        pickPromoter → R$1   — só comissão de bar
 *
 *  [G] sem referredBy + sem pick:
 *        ninguém recebe
 * ═══════════════════════════════════════════════════════════════════
 */
/**
 * resolveCommissions — delegado à Edge Function gerar-earning.
 *
 * Todas as chamadas internas do app que ainda passam por aqui
 * (aliases processPromoterCommission, processPickCommission, etc.)
 * redirecionam para o servidor automaticamente.
 *
 * A ativação já deve existir no banco antes desta chamada.
 */
async function resolveCommissions({ pickPromoterId, referredById, userId, amount, type, barName, activationId }) {
  try {
    if (!activationId) {
      console.warn('[OZ] resolveCommissions: activationId ausente — comissão ignorada.');
      return;
    }

    // ── EDGE FUNCTION: gerar-earning (calcula e credita no servidor) ──
    const result = await edgeFn('gerar-earning', { activation_id: activationId });
    console.log(`[OZ] resolveCommissions → Edge Function gerar-earning:`, result?.earnings?.length ?? 0, 'earning(s) criado(s)');
  } catch (err) {
    // Silencioso — não deve bloquear o fluxo principal de ativação
    console.warn('[OZ] resolveCommissions (edge) silenciado:', err?.message || err);
  }
}

// Aliases de compatibilidade (redirecionam para resolveCommissions central)
async function processPromoterCommission(promoterRef, type, activationId, amount) {
  return resolveCommissions({ pickPromoterId: null, referredById: promoterRef, userId: OZ.currentUser?.id, amount: amount || (type==='night_link'||type==='night' ? 10 : 5), type, barName: '—', activationId });
}

/* ═══════════════════════════════════════════════════════
   COMISSÃO DE INDICAÇÃO DE BAR (promoter_pick)
   Regra: R$1 fixo — igual para unitário e Noite Toda.
   Paga ao promoter que indicou o bar no dia (pick diário).
   Vigência: somente enquanto o bar for a indicação ativa do promoter.
   Independente do cap de 3 ativações do referredBy.
═══════════════════════════════════════════════════════ */

/**
 * Busca qual promoter (se houver) tem este bar como sua indicação ativa (promoter_pick).
 * Retorna o ID do promoter ou null.
 */
async function _findPickPromoter(barId) {
  try {
    const res = await apiGet(`tables/users?limit=500`);
    return (res.data||[]).find(u => u.role==='promoter' && u.promoter_pick===barId)?.id || null;
  } catch { return null; }
}

async function processPickCommission(promoterId, amount, type, barName, activationId) {
  return resolveCommissions({ pickPromoterId: promoterId, referredById: null, userId: OZ.currentUser?.id, amount, type, barName, activationId });
}

async function splitPickCommission(pickPromoterId, referredById, amount, type, barName, activationId, userId) {
  return resolveCommissions({ pickPromoterId, referredById, userId, amount, type, barName, activationId });
}

/* ══════════════════════════════════
   QR CODE MODAL
══════════════════════════════════ */
function openQRModal(bar, type, qrData, isFree = false) {
  const isNight    = (type === 'night_link' || type === 'night' || type === 'night_checkin');
  const baseLabel  = isNight ? 'Link da Noite Toda' : 'Benefício Unitário';
  const label      = isFree ? `${baseLabel} · 🎁 Grátis` : baseLabel;
  const barDisplay = (type === 'night_link' || type === 'night')
    ? 'Todos os bares parceiros 🌙'
    : bar?.name || '—';

  // Preenche meta da tela de sucesso
  const barEl  = document.getElementById('qr-bar-label');
  const typeEl = document.getElementById('qr-benefit-label');
  if (barEl)  barEl.textContent  = barDisplay;
  if (typeEl) typeEl.textContent = `${label} · válido até 06h00`;

  // Garante que os campos meta estejam visíveis
  if (barEl)  barEl.style.display  = '';
  if (typeEl) typeEl.style.display = '';

  // Botão "Usar em outro bar" — só para night_link original (não para checkin)
  const useBtn = document.getElementById('btn-qr-night-checkin');
  if (useBtn) {
    useBtn.style.display = (type === 'night_link' || type === 'night') ? 'flex' : 'none';
  }

  openModal('modal-qrcode');

  if (isNight) {
    showToast('🌙 Você está na lista! Aproveite a noite até as 6h 🎉', 'success');
  } else {
    showToast('✅ Benefício ativado! Aproveite o evento 🎉', 'success');
  }
}

/* ═══════════════════════════════════════════════════════════
   LINK DA NOITE TODA — CHECK-IN POR BAR
   O cliente usa o link quantas vezes quiser até as 6h,
   escolhendo o bar no momento que chegar nele.
═══════════════════════════════════════════════════════════ */

/*
 * Verifica se há sessão de night_link ativa (não expirada).
 * Retorna o objeto da ativação ou null.
 */
async function getActiveNightSession() {
  const user = OZ.currentUser;
  if (!user || user.id.startsWith('demo-')) return null;
  try {
    const res  = await apiGet(`tables/activations?limit=200`);
    const now  = new Date();
    const session = (res.data || []).find(a =>
      a.user_id === user.id &&
      (a.type === 'night_link' || a.type === 'night') &&
      a.expires_at && new Date(a.expires_at) > now
    );
    return session || null;
  } catch { return null; }
}

/*
 * Abre o modal de check-in com lista de bares ativos.
 * Pode ser chamado da home (banner "Link ativo"), do histórico
 * ou do botão no modal QR.
 */
async function openNightCheckInModal() {
  const session = OZ.activeNightSession
    ? await getActiveNightSession()   // revalida via API
    : await getActiveNightSession();

  if (!session) {
    showToast('Nenhum Link da Noite ativo. Ative primeiro na tela do bar.', 'error');
    return;
  }

  // Guarda sessão em memória para uso no check-in
  OZ.activeNightSession = {
    qrData:       session.qr_code || session.night_session,
    expiry:       session.expires_at,
    sessionId:    session.night_session || session.qr_code,
    activationId: session.id,
  };

  // Carrega bares ativos
  const listEl  = document.getElementById('ncm-bars-list');
  const emptyEl = document.getElementById('ncm-bars-empty');
  if (!listEl) return;

  // Atualiza cabeçalho com expiração
  const expEl = document.getElementById('ncm-expiry');
  if (expEl && session.expires_at) {
    const exp = new Date(session.expires_at);
    expEl.textContent = `Válido até ${exp.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' })}`;
  }

  listEl.innerHTML = `<div class="ncm-loading"><i class="fa fa-spinner fa-spin"></i> Carregando bares...</div>`;
  openModal('modal-night-checkin');

  try {
    const [barsRes, promosRes, actsRes] = await Promise.all([
      apiGet('tables/bars?limit=200'),
      apiGet('tables/promotions?limit=200'),
      apiGet('tables/activations?limit=200'),
    ]);

    const bars   = (barsRes.data   || []).filter(b => b.active !== false);
    const promos = (promosRes.data || []);

    // Check-ins já feitos nesta sessão
    const sessionKey = OZ.activeNightSession.sessionId;
    const doneBarIds = new Set(
      (actsRes.data || [])
        .filter(a =>
          a.user_id === OZ.currentUser.id &&
          a.type === 'night_checkin' &&
          (a.night_session === sessionKey || a.qr_code === sessionKey)
        )
        .map(a => a.bar_id)
    );
    // Também marca o bar original da compra
    doneBarIds.add(session.bar_id);

    // Ordena: bares com promoção ativa primeiro
    const activeBarIds = new Set(
      promos.filter(p => isPromoActive(p)).map(p => p.bar_id)
    );
    bars.sort((a, b) => {
      const aA = activeBarIds.has(a.id) ? 0 : 1;
      const bA = activeBarIds.has(b.id) ? 0 : 1;
      return aA - bA;
    });

    listEl.innerHTML = '';
    if (!bars.length) {
      emptyEl.style.display = 'flex';
      return;
    }
    emptyEl.style.display = 'none';

    bars.forEach(bar => {
      const hasPromo  = activeBarIds.has(bar.id);
      const alreadyIn = doneBarIds.has(bar.id);
      const promo     = promos.find(p => p.bar_id === bar.id && isPromoActive(p));
      const benefit   = promo?.benefit_description || promo?.title || 'Benefício ativo';

      const card = document.createElement('div');
      card.className = `ncm-bar-card${alreadyIn ? ' ncm-checked' : ''}${!hasPromo ? ' ncm-no-promo' : ''}`;

      card.innerHTML = `
        <div class="ncm-bar-photo" style="${bar.photo_url ? `background-image:url('${bar.photo_url}');background-size:cover;background-position:center;` : ''}">
          ${bar.photo_url ? '' : '🍺'}
        </div>
        <div class="ncm-bar-info">
          <p class="ncm-bar-name">${bar.name}</p>
          <p class="ncm-bar-hood"><i class="fa fa-map-marker-alt"></i> ${bar.neighborhood || '—'}</p>
          ${hasPromo ? `<p class="ncm-bar-benefit"><i class="fa fa-gift"></i> ${benefit}</p>` : ''}
        </div>
        <div class="ncm-bar-action">
          ${alreadyIn
            ? `<span class="ncm-checked-tag"><i class="fa fa-check-circle"></i> Feito</span>`
            : hasPromo
              ? `<button class="ncm-checkin-btn" onclick="nightCheckIn('${bar.id}','${bar.name.replace(/'/g,"\\'")}',this)"><i class="fa fa-bolt"></i> Usar</button>`
              : `<button class="ncm-checkin-btn ncm-checkin-muted" onclick="nightCheckIn('${bar.id}','${bar.name.replace(/'/g,"\\'")}',this)"><i class="fa fa-plus"></i> Entrar</button>`
          }
        </div>`;

      listEl.appendChild(card);
    });
  } catch {
    listEl.innerHTML = `<div class="ncm-error"><i class="fa fa-exclamation-circle"></i> Erro ao carregar bares.</div>`;
  }
}

/*
 * Registra o check-in do cliente em um bar específico
 * usando o Link da Noite ativo.
 */
async function nightCheckIn(barId, barName, btn) {
  const session = OZ.activeNightSession;
  if (!session) { showToast('Sessão expirada.', 'error'); return; }

  if (btn) { btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i>'; btn.disabled = true; }

  try {
    const qrData = session.qrData || session.sessionId;
    const expiry = session.expiry;

    // Registra check-in (tipo separado para não poluir o histórico principal)
    await apiPost('tables/activations', {
      user_id:       OZ.currentUser.id,
      bar_id:        barId,
      bar_name:      barName,
      type:          'night_checkin',
      amount:        0,               // já foi pago na ativação principal
      qr_code:       qrData,
      expires_at:    expiry,
      night_session: session.sessionId,
      promoter_id:   OZ.currentUser.referred_by || '',
      promoter_code: OZ.currentUser.referred_by || '',
    });

    // Atualiza visual do card
    const card = btn?.closest('.ncm-bar-card');
    if (card) {
      card.classList.add('ncm-checked');
      const actionEl = card.querySelector('.ncm-bar-action');
      if (actionEl) actionEl.innerHTML = `<span class="ncm-checked-tag"><i class="fa fa-check-circle"></i> Feito</span>`;
    }

    showToast(`✅ ${barName} — seu nome está na lista!`, 'success');
  } catch {
    showToast('Erro ao fazer check-in. Tente novamente.', 'error');
    if (btn) { btn.innerHTML = '<i class="fa fa-bolt"></i> Usar'; btn.disabled = false; }
  }
}

/*
 * Verifica sessão ativa ao abrir a home e exibe/esconde o banner.
 */
async function checkNightBanner() {
  const banner = document.getElementById('night-active-banner');
  if (!banner) return;
  const session = await getActiveNightSession();
  if (session) {
    OZ.activeNightSession = {
      qrData:       session.qr_code || session.night_session,
      expiry:       session.expires_at,
      sessionId:    session.night_session || session.qr_code,
      activationId: session.id,
    };
    const exp = new Date(session.expires_at);
    const expStr = exp.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
    const el = document.getElementById('night-banner-expiry');
    if (el) el.textContent = `Válido até ${expStr}`;
    banner.style.display = 'flex';
  } else {
    OZ.activeNightSession = null;
    banner.style.display = 'none';
  }
}

/* ══════════════════════════════════
   HISTÓRICO — CLIENTE
══════════════════════════════════ */

// Cache das ativações para filtro sem nova requisição
OZ._histAllActs = [];
OZ._histFilter  = 'all';

/* Navegação de abas internas do histórico */
function histSwitchTab(tab, btn) {
  document.querySelectorAll('#screen-history .hist-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#screen-history .hist-panel').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const panel = document.getElementById(`hpanel-${tab}`);
  if (panel) panel.classList.add('active');
  // Renderiza ao trocar de aba
  if (tab === 'ativacoes') _renderHistActs(OZ._histAllActs, OZ._histFilter);
  if (tab === 'resumo')    loadHistFreeCredits(OZ._histAllActs);
}

/* Filtros da aba Ativações */
function histFilterActs(filter, btn) {
  OZ._histFilter = filter;
  document.querySelectorAll('.hist-filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  _renderHistActs(OZ._histAllActs, filter);
}

/* Renderiza a lista de ativações com filtro aplicado */
function _renderHistActs(acts, filter) {
  const listEl  = document.getElementById('history-list');
  const emptyEl = document.getElementById('history-empty');
  const cntEl   = document.getElementById('hist-acts-count-lbl');
  if (!listEl) return;

  const todayStr = _todayStr(); // YYYY-MM-DD

  // Aplica filtro
  // Reservas aparecem sempre no filtro 'all' e no filtro do seu tipo
  let filtered = acts;
  if (filter === 'individual') filtered = acts.filter(a =>
    a.type === 'individual' || a.type === 'free_used' ||
    a.type === 'advance_individual' || a.type === 'reservation'
  );
  else if (filter === 'night') filtered = acts.filter(a =>
    a.type === 'night_link' || a.type === 'night' || a.type === 'advance_night'
  );
  else if (filter === 'free')  filtered = acts.filter(a => a.type === 'free_credit');

  if (cntEl) cntEl.textContent = `${filtered.length} ativação${filtered.length !== 1 ? 'ões' : ''}`;

  listEl.innerHTML = '';
  if (!filtered.length) {
    emptyEl.style.display = 'flex';
    return;
  }
  emptyEl.style.display = 'none';

  const typeMap = {
    free_credit:         { label: '🎁 Grátis',          icon: 'fa-gift',       iconCls: 'hist-act-icon-green',  badgeCls: 'hist-badge-green'  },
    free_used:           { label: '🎁 Grátis',          icon: 'fa-gift',       iconCls: 'hist-act-icon-green',  badgeCls: 'hist-badge-green'  },
    night_link:          { label: '🌙 Noite toda',       icon: 'fa-moon',       iconCls: 'hist-act-icon-purple', badgeCls: 'hist-badge-purple' },
    night:               { label: '🌙 Noite toda',       icon: 'fa-moon',       iconCls: 'hist-act-icon-purple', badgeCls: 'hist-badge-purple' },
    individual:          { label: '🎯 Individual',       icon: 'fa-bolt',       iconCls: 'hist-act-icon-gold',   badgeCls: 'hist-badge-gold'   },
    night_checkin:       { label: '📍 Check-in',        icon: 'fa-map-pin',    iconCls: 'hist-act-icon-purple', badgeCls: 'hist-badge-purple' },
    advance_individual:  { label: '📅 Agendado',        icon: 'fa-calendar',   iconCls: 'hist-act-icon-gold',   badgeCls: 'hist-badge-gold'   },
    advance_night:       { label: '📅 Noite agendada',  icon: 'fa-calendar',   iconCls: 'hist-act-icon-purple', badgeCls: 'hist-badge-purple' },
    advance_free:        { label: '📅 Agendado grátis', icon: 'fa-calendar',   iconCls: 'hist-act-icon-green',  badgeCls: 'hist-badge-green'  },
    reservation:         { label: '🔖 Reserva',         icon: 'fa-bookmark',   iconCls: 'hist-act-icon-gold',   badgeCls: 'hist-badge-gold'   },
  };

  filtered.slice(0, 80).forEach(act => {
    const t       = typeMap[act.type] || { label: act.type || '—', icon: 'fa-ticket-alt', iconCls: 'hist-act-icon-gold', badgeCls: 'hist-badge-gold' };
    const barName = act.bar_name || act._nightBars?.[0] || 'Bar';
    const barId   = act.bar_id   || null;

    // ── Data a exibir ──────────────────────────────────────────────────────
    // Reservas: mostra a data do benefício (benefit_date); ativações: created_at
    let dateStr, dateLabel;
    if (act._isReservation && act.benefit_date) {
      const bd = new Date(act.benefit_date + 'T12:00:00');
      dateStr  = bd.toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'2-digit' });
      // Indica se é futuro ou passado
      dateLabel = act.benefit_date > todayStr
        ? `<span style="color:#60a5fa;font-size:11px;font-weight:600">📅 ${dateStr}</span>`
        : `<span style="color:rgba(255,255,255,.5)">${dateStr}</span>`;
    } else {
      dateStr   = act.created_at
        ? new Date(act.created_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'2-digit' })
        : '—';
      dateLabel = `<span style="color:rgba(255,255,255,.5)">${dateStr}</span>`;
    }

    // ── Botão Avaliar ──────────────────────────────────────────────────────
    // Só aparece quando a data do benefício/ativação já passou (ou é hoje)
    const isPast = act._isReservation
      ? (act._isPast || act.benefit_date <= todayStr)   // reserva: usa benefit_date
      : true;                                            // ativação normal: sempre elegível

    const alreadyRated = barId && OZ._myReviewedBars && OZ._myReviewedBars.has(barId);
    let reviewBtn = '';
    if (barId && isPast) {
      reviewBtn = `<button class="hist-act-review-btn ${alreadyRated ? 'hist-act-review-done' : ''}"
           onclick="openHistReviewModal('${barId}', '${barName.replace(/'/g, "\\'")}')">
           ${alreadyRated
             ? '<i class="fa fa-star"></i> Avaliado'
             : '<i class="far fa-star"></i> Avaliar'}
         </button>`;
    } else if (barId && !isPast) {
      // Benefício futuro: mostra indicativo visual sem ação
      reviewBtn = `<span class="hist-act-future-tag">Em breve</span>`;
    }

    const item = document.createElement('div');
    item.className = 'hist-act-item';
    item.innerHTML = `
      <div class="hist-act-icon ${t.iconCls}"><i class="fa ${t.icon}"></i></div>
      <div class="hist-act-body">
        <div class="hist-act-bar">${barName}</div>
        <div class="hist-act-type">${t.label} · ${dateLabel}${act._isReservation && act.benefit_title ? ` · <em style="color:rgba(255,255,255,.4);font-size:11px">${act.benefit_title}</em>` : ''}</div>
      </div>
      <div class="hist-act-right">
        ${reviewBtn}
      </div>`;
    listEl.appendChild(item);
  });
}

async function loadHistory() {
  const user  = OZ.currentUser;
  const listEl  = document.getElementById('history-list');
  const emptyEl = document.getElementById('history-empty');
  if (listEl) listEl.innerHTML = skeletonCards(3, '70px');

  try {
    // Busca ativações E reservas em paralelo
    const [actsRes, resvsRes] = await Promise.all([
      apiGet(`tables/activations?limit=500`),
      apiGet(`tables/reservations?limit=500`),
    ]);
    const now  = new Date();
    const todayStr = _todayStr(); // YYYY-MM-DD

    const rawActs = (actsRes.data || [])
      .filter(a => a.user_id === user.id)
      .filter(a => a.type !== 'free_credit_used')
      .filter(a => !(a.status === 'cancelled'))
      .sort((a,b) => (b.created_at||0)-(a.created_at||0));

    /* ── Reservas de benefícios agendados (todos os status exceto cancelado) ──
       Exibe TODAS, inclusive as de datas futuras. Se a data já passou, habilita
       avaliação. Evita duplicar caso uma ativação com origin_act_id === reservation.id
       já exista em activations (ativação do mesmo dia). */
    const actOriginIds = new Set(
      rawActs.map(a => a.origin_act_id).filter(Boolean)
    );

    const rawReservations = (resvsRes.data || [])
      .filter(r => r.user_id === user.id)
      .filter(r => r.status !== 'cancelled')
      // Não duplica reservas que já viraram ativação no mesmo dia
      .filter(r => !actOriginIds.has(r.id))
      .map(r => ({
        // Normaliza para o mesmo formato dos itens de activations
        ...r,
        _isReservation: true,
        // Usa created_at como referência de quando reservou
        type: r.activation_type === 'advance_night' ? 'advance_night'
            : r.activation_type === 'advance_individual' ? 'advance_individual'
            : 'reservation',
        bar_id:   r.bar_id,
        bar_name: r.bar_name,
        // Data de ordenação: usa benefit_date convertida para timestamp de início do dia
        _sortTs: r.benefit_date
          ? new Date(r.benefit_date + 'T00:00:00').getTime()
          : (r.created_at || 0),
        // Se benefit_date <= hoje: data passada → pode avaliar
        _isPast: r.benefit_date ? r.benefit_date <= todayStr : true,
      }));

    /* ── Agrupa night_link + night_checkin pela mesma night_session ── */
    const displayActs   = [];
    const nightSessions = new Map();

    rawActs.forEach(act => {
      const isNightMain = (act.type === 'night_link' || act.type === 'night');
      const isCheckIn   = (act.type === 'night_checkin');
      if (isNightMain) {
        const key = act.night_session || act.qr_code || act.id;
        if (!nightSessions.has(key)) {
          const entry = { ...act, _nightBars: [], _sessionKey: key,
                          _isNightGroup: true, _active: act.expires_at && new Date(act.expires_at) > now,
                          _isPast: true };
          if (act.bar_name) entry._nightBars.push(act.bar_name);
          nightSessions.set(key, entry);
          displayActs.push(entry);
        }
      } else if (isCheckIn) {
        const key = act.night_session || act.qr_code;
        if (key && nightSessions.has(key)) {
          const entry = nightSessions.get(key);
          if (act.bar_name && !entry._nightBars.includes(act.bar_name)) entry._nightBars.push(act.bar_name);
        }
      } else {
        displayActs.push({ ...act, _isPast: true });
      }
    });

    // Mescla reservas na lista e reordena: mais recentes/futuras primeiro
    // Reservas futuras ficam no topo (data futura = timestamp maior que hoje)
    const allItems = [
      ...displayActs,
      ...rawReservations,
    ].sort((a, b) => {
      // Para ativações normais usa created_at; para reservas usa _sortTs
      const tsA = a._isReservation ? a._sortTs : (a.created_at || 0);
      const tsB = b._isReservation ? b._sortTs : (b.created_at || 0);
      return tsB - tsA;
    });

    // Guarda para filtro posterior
    OZ._histAllActs = allItems;

    // ── Stats ──
    const uniqueBars = [...new Set([...rawActs, ...rawReservations].map(a => a.bar_id).filter(Boolean))].length;
    const paidActs   = displayActs.filter(a => a.type !== 'free_credit');
    const scEl = document.getElementById('savings-count'); if (scEl) scEl.textContent = paidActs.length;
    const sbEl = document.getElementById('savings-bars');  if (sbEl) sbEl.textContent = uniqueBars;

    const savedEl = document.getElementById('hist-saved-val');
    if (savedEl) {
      const nightCount = rawActs.filter(a => a.type === 'night_link' || a.type === 'night').length;
      const indCount   = rawActs.filter(a => a.type === 'individual').length;
      savedEl.textContent = `R$${nightCount * 10 + indCount * 5}`;
    }

    // Data label
    const dateEl = document.getElementById('hist-date-label');
    if (dateEl) dateEl.textContent = new Date().toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' });

    // ── Carrega bars já avaliados pelo usuário (para o botão "Avaliar") ──
    _loadMyReviewedBars();

    // ── Painel de ativações grátis (aba Resumo) ──
    loadHistFreeCredits(rawActs);

    // ── Se a aba Ativações já está ativa, renderiza a lista ──
    const painel = document.getElementById('hpanel-ativacoes');
    if (painel && painel.classList.contains('active')) {
      _renderHistActs(allItems, OZ._histFilter || 'all');
    } else if (listEl) {
      listEl.innerHTML = '';
    }

  } catch(e) {
    if (listEl) listEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'flex';
  }
}

/* ─ Painel de ativações grátis no Histórico ─ */
function loadHistFreeCredits(rawActs) {
  const allFree    = (rawActs || []).filter(a => a.type === 'free_credit');
  const byReferral = allFree.filter(a => !a.origin || a.origin === 'referral');
  const byCancel   = allFree.filter(a => a.origin === 'bar_cancellation');

  const cntRef  = document.getElementById('hfcp-count-referral');
  const cntCan  = document.getElementById('hfcp-count-cancel');
  const listRef = document.getElementById('hfcp-list-referral');
  const listCan = document.getElementById('hfcp-list-cancel');
  const ldRef   = document.getElementById('hfcp-loading-referral');
  const ldCan   = document.getElementById('hfcp-loading-cancel');

  if (ldRef) ldRef.style.display = 'none';
  if (ldCan) ldCan.style.display = 'none';

  if (cntRef) cntRef.textContent = byReferral.length;
  if (cntCan) cntCan.textContent = byCancel.length;

  if (listRef) {
    listRef.innerHTML = byReferral.length
      ? byReferral.map(a => _buildFcpItem(a, 'referral')).join('')
      : '<div class="fcp-empty">Nenhuma ativação grátis por convite ainda.</div>';
  }
  if (listCan) {
    listCan.innerHTML = byCancel.length
      ? byCancel.map(a => _buildFcpItem(a, 'cancel')).join('')
      : '<div class="fcp-empty">Nenhuma compensação recebida ainda.</div>';
  }
}

/* ══════════════════════════════════
   PERFIL — ABAS COM NOME
══════════════════════════════════ */
function pfSwitchTab(tab, btn) {
  // Atualiza botões (suporta .pf-named-tab e .pf-icon-tab para retrocompatibilidade)
  document.querySelectorAll('#screen-profile .pf-named-tab, #screen-profile .pf-icon-tab')
    .forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  // Atualiza painéis
  document.querySelectorAll('#screen-profile .pf-tab-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(`pf-panel-${tab}`);
  if (panel) panel.classList.add('active');
  // Carrega dados ao trocar aba
  if (tab === 'notif')   { loadInbox(); loadOnlineUsers(); }
  if (tab === 'bares')   { loadFavoriteBars(); }
  if (tab === 'convite') { loadFreeCreditsPanel(); }
}

/* Sincroniza o chat hero com o estado do promoter */
function _syncChatHero(user) {
  if (!user) return;
  const hero     = document.getElementById('client-promoter-chat-hero');
  const heroName = document.getElementById('client-promo-name-hero');
  const heroDot  = document.getElementById('client-promo-online-dot-hero');
  const heroAv   = document.getElementById('client-promo-avatar-hero');
  // Dados do promoter vêm dos mesmos elementos do chat card
  const nameEl  = document.getElementById('client-promo-name');
  const dotEl   = document.getElementById('client-promo-online-dot');
  const avatarEl = document.getElementById('client-promo-avatar');
  if (!hero) return;
  // Mostra hero apenas se o chat card estiver visível
  const chatCard = document.getElementById('client-promoter-chat-card');
  if (!chatCard || chatCard.style.display === 'none') {
    hero.style.display = 'none';
    return;
  }
  hero.style.display = 'flex';
  if (heroName && nameEl)  heroName.textContent  = nameEl.textContent || 'Meu Promoter';
  if (heroDot  && dotEl)   heroDot.style.display  = dotEl.style.display !== 'none' ? 'block' : 'none';
  if (heroAv   && avatarEl) {
    // Copia foto do avatar se existir
    if (avatarEl.style.backgroundImage) {
      heroAv.style.backgroundImage    = avatarEl.style.backgroundImage;
      heroAv.style.backgroundSize     = 'cover';
      heroAv.style.backgroundPosition = 'center';
      heroAv.textContent = '';
    } else {
      heroAv.style.backgroundImage = '';
      heroAv.textContent = '⭐';
    }
  }
}

function pfPromoterSwitchTab(tab, btn) {
  document.querySelectorAll('#screen-promoter-profile .pf-named-tab, #screen-promoter-profile .pf-icon-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.querySelectorAll('#screen-promoter-profile .pf-tab-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(`pfp-panel-${tab}`);
  if (panel) panel.classList.add('active');
  if (tab === 'historico') { loadPromoterInbox(); }
  if (tab === 'config') { _fillPromoterEditForm(); }
}

/* Anima os anéis com base no valor numérico */
function _animateRing(ringId, value, max) {
  const el = document.getElementById(ringId);
  if (!el) return;
  const circumference = 169.6; // 2π×27
  const ratio = max > 0 ? Math.min(value / max, 1) : 0.15;
  const filled = ratio * circumference;
  const offset = circumference - filled;
  el.style.strokeDashoffset = offset > 0 ? offset : 0;
}

/* ══════════════════════════════════
   PERFIL — CLIENTE
══════════════════════════════════ */
async function loadClienteProfile() {
  const user = OZ.currentUser;
  if (!user) return;

  const init = (user.name||'?')[0].toUpperCase();
  const avatarEl = document.getElementById('profile-avatar-big');
  if (avatarEl) {
    if (user.photo_url) {
      avatarEl.style.backgroundImage = `url('${user.photo_url}')`;
      avatarEl.style.backgroundSize  = 'cover';
      avatarEl.style.backgroundPosition = 'center';
      avatarEl.textContent = '';
    } else {
      avatarEl.style.backgroundImage = '';
      avatarEl.textContent = init;
    }
  }

  // ── Foto do perfil também na capa (hero) ──
  const heroBg = document.getElementById('cp-hero-bg');
  if (heroBg) {
    if (user.photo_url) {
      heroBg.style.backgroundImage    = `url('${user.photo_url}')`;
      heroBg.style.backgroundSize     = 'cover';
      heroBg.style.backgroundPosition = 'center center';
      heroBg.classList.add('cp-hero-bg--has-photo');
    } else {
      heroBg.style.backgroundImage    = '';
      heroBg.style.backgroundSize     = '';
      heroBg.style.backgroundPosition = '';
      heroBg.classList.remove('cp-hero-bg--has-photo');
    }
  }

  document.getElementById('profile-name').textContent       = user.name;
  document.getElementById('profile-email').textContent      = user.email;

  document.getElementById('pinfo-birth').textContent  = user.birth_date ? formatDateBR(user.birth_date) : '—';
  document.getElementById('pinfo-gender').textContent = genderMap[user.gender] || '—';
  document.getElementById('pinfo-phone').textContent  = user.phone || '—';

  // Código de convite
  const inviteCode = user.invite_code || (user.id || 'USR').slice(0,8).toUpperCase();
  const refLinkEl = document.getElementById('ref-invite-link');
  if (refLinkEl) refLinkEl.textContent = inviteCode;

  try {
    const res     = await apiGet(`tables/activations?limit=200`);
    const allActs = (res.data || []).filter(a => a.user_id === user.id);

    // Para stats do perfil: exclui registros de crédito já consumidos (free_credit_used)
    const acts       = allActs.filter(a => a.type !== 'free_credit_used');
    const uniqueBars = [...new Set(acts.map(a => a.bar_id))];

    // Total de ativações visíveis no perfil
    const actsEl = document.getElementById('pstat-acts');
    const barsEl = document.getElementById('pstat-bars');
    if (actsEl) actsEl.textContent = acts.length;
    if (barsEl) barsEl.textContent = uniqueBars.length;
    // Stats cards do perfil cliente
    const actsRingEl = document.getElementById('pstat-acts-ring');
    const barsRingEl = document.getElementById('pstat-bars-ring');
    if (actsRingEl) actsRingEl.textContent = acts.length;
    if (barsRingEl) barsRingEl.textContent = uniqueBars.length;
    // Barrinhas de progresso dos cards
    setTimeout(() => {
      const maxActs = Math.max(acts.length, 1);
      const maxBars = Math.max(uniqueBars.length, 1);
      const barActs = document.getElementById('cps-bar-acts');
      const barBars = document.getElementById('cps-bar-bars');
      // barra relativa: ativações é referência 100%, bares proporcional
      if (barActs) barActs.style.width = Math.min(100, Math.round((acts.length / Math.max(acts.length, 1)) * 100)) + '%';
      if (barBars) barBars.style.width = Math.min(100, Math.round((uniqueBars.length / maxActs) * 100)) + '%';
    }, 300);

    // Créditos grátis DISPONÍVEIS = type 'free_credit' ainda não consumidos
    const compensations = acts.filter(a => a.type === 'free_credit');
    const compCount     = compensations.length;
    const compWrap      = document.getElementById('ref-compensation-wrap');
    const compBanner    = document.getElementById('ref-compensation-banner');
    const compCountEl   = document.getElementById('ref-compensation-count');
    const compBannerCnt = document.getElementById('ref-compensation-banner-count');

    if (compCount > 0) {
      if (compWrap)      { compWrap.style.display  = 'flex'; }
      if (compBanner)    { compBanner.style.display = 'flex'; }
      if (compCountEl)   compCountEl.textContent   = compCount;
      if (compBannerCnt) compBannerCnt.textContent = compCount;
    } else {
      if (compWrap)   compWrap.style.display   = 'none';
      if (compBanner) compBanner.style.display = 'none';
    }

    // Contagem de amigos convidados e bônus por indicação
    try {
      const refRes = await apiGet(`tables/users?limit=200`);
      const friends = (refRes.data || []).filter(u => u.referred_by === user.id);
      const pfEl = document.getElementById('pstat-friends'); if (pfEl) pfEl.textContent = friends.length;
      document.getElementById('ref-invited-count').textContent = friends.length;
      document.getElementById('ref-bonus-count').textContent   = friends.length;
      // Barra de amigos
      setTimeout(() => {
        const barFriends = document.getElementById('cps-bar-friends');
        if (barFriends) barFriends.style.width = Math.min(100, friends.length * 20) + '%';
      }, 380);
    } catch {
      const pfEl = document.getElementById('pstat-friends'); if (pfEl) pfEl.textContent = '0';
      document.getElementById('ref-invited-count').textContent = '0';
      document.getElementById('ref-bonus-count').textContent   = '0';
    }
  } catch {
    const _ae = document.getElementById('pstat-acts'); if (_ae) _ae.textContent = user.activations_count || 0;
    const _ae2 = document.getElementById('pstat-acts-ring'); if (_ae2) _ae2.textContent = user.activations_count || 0;
    const _be = document.getElementById('pstat-bars'); if (_be) _be.textContent = '—';
    const _be2 = document.getElementById('pstat-bars-ring'); if (_be2) _be2.textContent = '—';
    const _fe = document.getElementById('pstat-friends'); if (_fe) _fe.textContent = '0';
  }

  loadFavoriteBars();
  loadOnlineUsers();
  loadFreeCreditsPanel();
  checkInboxBadge();
  checkClientPromoterChat();
  loadClientPromoterPick();
}

/* ══════════════════════════════════════════════════════
   INBOX — notificações / mensagens recebidas pelo cliente
══════════════════════════════════════════════════════ */

/** Verifica mensagens não lidas e atualiza os badges na nav */
async function checkInboxBadge() {
  const user = OZ.currentUser;
  if (!user || user.role !== 'cliente') return;
  try {
    const res  = await apiGet(`tables/chat_messages?limit=200`);
    const msgs = (res.data || []).filter(m => m.receiver_id === user.id && !m.read);
    const count = msgs.length;
    // Atualiza badge no card de notificações do perfil
    const inboxBadge = document.getElementById('inbox-unread-badge');
    if (inboxBadge) {
      inboxBadge.textContent = count > 9 ? '9+' : String(count);
      inboxBadge.style.display = count > 0 ? 'inline-flex' : 'none';
    }
    // Atualiza badge no botão de nav (Perfil) — ambas as instâncias
    ['cin-inbox-badge', 'cin-inbox-badge-2'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent    = count > 9 ? '9+' : String(count);
      el.style.display  = count > 0 ? 'inline-flex' : 'none';
    });
  } catch { /* silencia erro */ }
}

/** Carrega e renderiza a lista de mensagens no inbox do perfil */
async function loadInbox() {
  const user   = OZ.currentUser;
  const listEl = document.getElementById('inbox-list');
  if (!user || !listEl) return;

  listEl.innerHTML = '<div class="inbox-loading"><i class="fa fa-spinner fa-spin"></i> Carregando…</div>';

  try {
    const res  = await apiGet(`tables/chat_messages?limit=200`);
    const msgs = (res.data || [])
      .filter(m => m.receiver_id === user.id)
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    if (!msgs.length) {
      listEl.innerHTML = '<div class="inbox-empty"><i class="fa fa-bell-slash"></i><p>Nenhuma mensagem ainda.</p></div>';
      return;
    }

    listEl.innerHTML = '';

    // Marca todas como lidas em background
    const unread = msgs.filter(m => !m.read);
    unread.forEach(m => {
      apiPatch(`tables/chat_messages/${m.id}`, { read: true }).catch(() => {});
    });
    // Zera badges imediatamente
    ['inbox-unread-badge', 'cin-inbox-badge', 'cin-inbox-badge-2'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });

    msgs.forEach(msg => {
      const isNew      = !msg.read;
      const barName    = msg.sender_name || 'Bar';
      const dateStr    = msg.created_at
        ? new Date(msg.created_at).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
        : '';
      // Formata conteúdo: quebra linhas (sanitiza HTML)
      const safeContent = (msg.content || '').replace(/</g, '&lt;').replace(/\n/g, '<br>');
      const item = document.createElement('div');
      item.className = `inbox-item${isNew ? ' inbox-item-new' : ''}`;
      item.innerHTML = `
        <div class="inbox-bar-header">
          <div class="inbox-bar-avatar"><i class="fa fa-store"></i></div>
          <div class="inbox-bar-info">
            <span class="inbox-bar-name">${barName}</span>
            <span class="inbox-date">${dateStr}</span>
          </div>
          ${isNew ? '<span class="inbox-new-dot">Nova</span>' : ''}
        </div>
        <div class="inbox-body">${safeContent}</div>`;
      listEl.appendChild(item);
    });
  } catch {
    listEl.innerHTML = '<div class="inbox-empty"><i class="fa fa-exclamation-circle"></i><p>Erro ao carregar mensagens.</p></div>';
  }
}

/* ══════════════════════════════════════════════════════
   PAINEL DE ATIVAÇÕES GRÁTIS — aba Convidar
══════════════════════════════════════════════════════ */
async function loadFreeCreditsPanel() {
  const user    = OZ.currentUser;
  const loading = document.getElementById('fcp-loading');
  const listRef = document.getElementById('fcp-list-referral');
  const listCan = document.getElementById('fcp-list-cancel');
  const cntRef  = document.getElementById('fcp-count-referral');
  const cntCan  = document.getElementById('fcp-count-cancel');
  if (!user || !listRef || !listCan) return;

  if (loading) loading.style.display = 'flex';

  try {
    const res  = await apiGet(`tables/activations?limit=500`);
    const all  = (res.data || []).filter(a =>
      a.user_id === user.id && a.type === 'free_credit'
    );

    // Separa por origem
    const byReferral = all.filter(a => !a.origin || a.origin === 'referral');
    const byCancel   = all.filter(a => a.origin === 'bar_cancellation');

    // Atualiza contadores
    if (cntRef) cntRef.textContent = byReferral.length;
    if (cntCan) cntCan.textContent = byCancel.length;

    // Renderiza lista de convites
    if (byReferral.length === 0) {
      listRef.innerHTML = '<div class="fcp-empty">Nenhuma ativação grátis por convite ainda.</div>';
    } else {
      listRef.innerHTML = byReferral.map(a => _buildFcpItem(a, 'referral')).join('');
    }

    // Renderiza lista de cancelamentos
    if (byCancel.length === 0) {
      listCan.innerHTML = '<div class="fcp-empty">Nenhuma compensação recebida ainda.</div>';
    } else {
      listCan.innerHTML = byCancel.map(a => _buildFcpItem(a, 'cancel')).join('');
    }

  } catch {
    if (listRef) listRef.innerHTML = '<div class="fcp-empty">Erro ao carregar.</div>';
    if (listCan) listCan.innerHTML = '<div class="fcp-empty">Erro ao carregar.</div>';
  } finally {
    if (loading) loading.style.display = 'none';
  }
}

function _buildFcpItem(act, kind) {
  const isUsed  = act.type === 'free_credit_used';
  const dateStr = act.created_at
    ? new Date(act.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
    : '—';

  // Label de status: usado ou disponível
  const usedLabel = isUsed
    ? '<span class="fcp-item-status fcp-used">Usado</span>'
    : '<span class="fcp-item-status fcp-available">Disponível</span>';

  // Ícone e descrição conforme origem
  let icon, desc;
  if (kind === 'cancel') {
    icon = '<i class="fa fa-undo-alt fcp-item-icon fcp-icon-orange"></i>';
    desc = act.bar_name ? `Compensação — ${act.bar_name}` : 'Compensação por cancelamento';
  } else {
    icon = '<i class="fa fa-user-plus fcp-item-icon fcp-icon-purple"></i>';
    desc = 'Bônus por convite de amigo';
  }

  return `
    <div class="fcp-item">
      ${icon}
      <div class="fcp-item-info">
        <span class="fcp-item-desc">${desc}</span>
        <span class="fcp-item-date">${dateStr}</span>
      </div>
      ${usedLabel}
    </div>`;
}

/* ══════════════════════════════════════════════════════
   EDITAR PERFIL — CLIENTE
   Abre o modal pré-preenchido e salva as alterações via PATCH
══════════════════════════════════════════════════════ */
function openClientEdit() {
  const user = OZ.currentUser;
  if (!user) return;

  // Pré-preenche os campos
  const nameEl  = document.getElementById('cedit-name');
  const phoneEl = document.getElementById('cedit-phone');
  const genEl   = document.getElementById('cedit-gender');
  const birthEl = document.getElementById('cedit-birth');

  if (nameEl)  nameEl.value  = user.name  || '';
  if (phoneEl) phoneEl.value = user.phone || '';
  if (genEl)   genEl.value   = user.gender || '';
  if (birthEl) birthEl.value = user.birth_date || '';

  // Define limite máximo de data (18 anos)
  if (birthEl) {
    const maxDate = new Date();
    maxDate.setFullYear(maxDate.getFullYear() - 18);
    birthEl.max = maxDate.toISOString().slice(0, 10);
  }

  // Atualiza o preview do avatar no modal
  const previewEl = document.getElementById('cedit-avatar-preview');
  if (previewEl) {
    if (user.photo_url) {
      previewEl.style.backgroundImage    = `url('${user.photo_url}')`;
      previewEl.style.backgroundSize     = 'cover';
      previewEl.style.backgroundPosition = 'center';
      previewEl.textContent = '';
    } else {
      previewEl.style.backgroundImage = '';
      previewEl.textContent = (user.name || '?')[0].toUpperCase();
    }
  }

  // Reseta botão
  const btn = document.getElementById('btn-save-client-edit');
  if (btn) {
    btn.innerHTML = '<i class="fa fa-check"></i> Salvar alterações';
    btn.disabled  = false;
  }

  openModal('modal-client-edit');
}

async function saveClientProfile() {
  const user = OZ.currentUser;
  if (!user) return;

  const btn     = document.getElementById('btn-save-client-edit');
  const nameVal = (document.getElementById('cedit-name')?.value || '').trim();
  const phoneVal= (document.getElementById('cedit-phone')?.value || '').trim();
  const genVal  = document.getElementById('cedit-gender')?.value || '';
  const birthVal= document.getElementById('cedit-birth')?.value  || '';

  if (!nameVal) {
    showToast('Por favor, informe seu nome.', 'error');
    return;
  }

  if (btn) { btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Salvando...'; btn.disabled = true; }

  try {
    const updates = {
      name:       nameVal,
      phone:      phoneVal,
      gender:     genVal,
      birth_date: birthVal,
    };

    await apiPatch(`tables/users/${user.id}`, updates);

    // Atualiza cache em memória
    Object.assign(OZ.currentUser, updates);

    // Atualiza a tela de perfil
    document.getElementById('profile-name').textContent   = nameVal;
    document.getElementById('pinfo-phone').textContent    = phoneVal || '—';
    document.getElementById('pinfo-gender').textContent   = genderMap[genVal] || '—';
    document.getElementById('pinfo-birth').textContent    = birthVal ? formatDateBR(birthVal) : '—';

    closeModal('modal-client-edit');
    showToast('Perfil atualizado com sucesso! ✅', 'success');
  } catch {
    showToast('Erro ao salvar. Tente novamente.', 'error');
  } finally {
    if (btn) { btn.innerHTML = '<i class="fa fa-check"></i> Salvar alterações'; btn.disabled = false; }
  }
}

/* ══════════════════════════════════
   FAVORITOS
══════════════════════════════════ */
function toggleFavoriteBar() {
  // Delega à função de like que gerencia tanto favorito local quanto API
  toggleLikeBar(null);
}

/* ═══════════════════════════════════════════════════════════
   CURTIDAS / LIKES — CLIENTE ↔ BAR
   Regra: cliente/promoter curte o bar → like salvo na API
          bar pode responder → mensagem chega ao cliente
          chat só é visível após a curtida
═══════════════════════════════════════════════════════════ */

/* ── Curtir / descurtir um bar ─────────────────────────── */
async function toggleLikeBar(forceLike = null) {
  const bar  = OZ.currentBar;
  const user = OZ.currentUser;
  if (!bar || !user) { showToast('Faça login para curtir.', 'error'); return; }
  if (user.id.startsWith('demo-')) {
    showToast('Conta demo não pode curtir.', 'error'); return;
  }

  // Verifica se já curtiu
  let existingLike = null;
  try {
    const res = await apiGet(`tables/bar_likes?limit=500`);
    existingLike = (res.data || []).find(
      l => l.bar_id === bar.id && l.user_id === user.id
    );
  } catch { /* segue mesmo sem dado */ }

  const shouldLike = forceLike !== null ? forceLike : !existingLike;

  if (shouldLike && !existingLike) {
    // Criar like
    try {
      await apiPost('tables/bar_likes', {
        bar_id:     bar.id,
        bar_name:   bar.name,
        user_id:    user.id,
        user_name:  user.name || 'Usuário',
        user_photo: user.photo_url || '',
        user_role:  user.role || 'cliente',
        bar_replied: false,
        bar_reply:   '',
        liked_at:   new Date().toISOString(),
      });
      // Também adiciona ao favoritos locais
      if (!OZ.favoriteBars.includes(bar.id)) {
        OZ.favoriteBars.push(bar.id);
        localStorage.setItem('oz_fav_bars', JSON.stringify(OZ.favoriteBars));
      }
      showToast(`❤️ Você curtiu ${bar.name}! Chat desbloqueado.`, 'success');
      _updateBarDetailLikeUI(true, null);
    } catch { showToast('Erro ao curtir. Tente novamente.', 'error'); }

  } else if (!shouldLike && existingLike) {
    // Remover like
    try {
      await apiDelete(`tables/bar_likes/${existingLike.id}`);
      const idx = OZ.favoriteBars.indexOf(bar.id);
      if (idx !== -1) {
        OZ.favoriteBars.splice(idx, 1);
        localStorage.setItem('oz_fav_bars', JSON.stringify(OZ.favoriteBars));
      }
      showToast(`Curtida removida.`, '');
      _updateBarDetailLikeUI(false, null);
    } catch { showToast('Erro ao remover curtida.', 'error'); }
  }

  // Atualiza o botão de favorito do hero
  const favBtn = document.getElementById('btn-favorite-bar');
  if (favBtn) favBtn.className = OZ.favoriteBars.includes(bar.id)
    ? 'dp-btn-fav favorited' : 'dp-btn-fav';
  const favIcon2 = document.getElementById('dp-fav-icon2');
  if (favIcon2) favIcon2.style.color = OZ.favoriteBars.includes(bar.id) ? '#ef4444' : '';
}

/* ── Atualiza a UI de chat/like na tela de detalhe do bar ── */
function _updateBarDetailLikeUI(isLiked, replyText) {
  const locked   = document.getElementById('bar-chat-locked');
  const unlocked = document.getElementById('bar-chat-unlocked');
  if (!locked || !unlocked) return;

  if (isLiked) {
    locked.style.display   = 'none';
    unlocked.style.display = 'block';

    // Foto/nome do bar no chat
    const bar = OZ.currentBar;
    const avatarEl = document.getElementById('bar-chat-avatar');
    const nameEl   = document.getElementById('bar-chat-name');
    if (avatarEl) {
      if (bar?.photo_url) {
        avatarEl.style.backgroundImage    = `url('${bar.photo_url}')`;
        avatarEl.style.backgroundSize     = 'cover';
        avatarEl.style.backgroundPosition = 'center';
        avatarEl.textContent = '';
      } else {
        avatarEl.textContent = '🍺';
      }
    }
    if (nameEl) nameEl.textContent = bar?.name || 'Bar';

    // Exibe resposta do bar se houver
    const replyWrap    = document.getElementById('bar-chat-reply-wrap');
    const replyBubble  = document.getElementById('bar-chat-reply-bubble');
    const replyTimeEl  = document.getElementById('bar-chat-reply-time');
    const waitingEl    = document.getElementById('bar-chat-waiting');

    if (replyText) {
      if (replyWrap)   replyWrap.style.display   = 'block';
      if (replyBubble) replyBubble.textContent    = replyText;
      if (waitingEl)   waitingEl.style.display    = 'none';
      if (replyTimeEl) replyTimeEl.textContent    = 'Respondido pelo bar';
    } else {
      if (replyWrap)  replyWrap.style.display  = 'none';
      if (waitingEl)  waitingEl.style.display  = 'flex';
    }
  } else {
    locked.style.display   = 'block';
    unlocked.style.display = 'none';
  }
}

/* ── Carrega estado de like ao abrir o detalhe do bar ───── */
async function loadBarLikeState() {
  const bar  = OZ.currentBar;
  const user = OZ.currentUser;
  const chatSection = document.getElementById('bar-chat-section');

  // Esconde o chat para promoters/bars (só clientes e promoters podem curtir)
  if (!user || user.role === 'bar') {
    if (chatSection) chatSection.style.display = 'none';
    return;
  }
  if (chatSection) chatSection.style.display = 'block';

  // Visitante não logado — mostra bloqueado
  if (!bar || !user) { _updateBarDetailLikeUI(false, null); return; }

  // Conta demo: exibe bloqueado
  if (user.id.startsWith('demo-')) {
    _updateBarDetailLikeUI(false, null); return;
  }

  try {
    const res  = await apiGet(`tables/bar_likes?limit=500`);
    const like = (res.data || []).find(
      l => l.bar_id === bar.id && l.user_id === user.id
    );
    _updateBarDetailLikeUI(!!like, like?.bar_reply || null);
  } catch {
    _updateBarDetailLikeUI(false, null);
  }
}

/* ══════════════════════════════════════════════════════════
   PAINEL DO BAR — ABA FÃS
══════════════════════════════════════════════════════════ */
let _currentReplyLikeId = null;

async function loadBarLikes(filter = 'all') {
  const user  = OZ.currentUser;
  const barId = user?.bar_id;
  if (!barId) return;

  const listEl  = document.getElementById('bar-likes-list');
  const emptyEl = document.getElementById('bar-likes-empty');
  if (!listEl) return;

  listEl.innerHTML = `<div class="bar-likes-skeleton">
    <div class="bls-item"></div><div class="bls-item"></div><div class="bls-item"></div>
  </div>`;

  try {
    const res   = await apiGet(`tables/bar_likes?limit=200`);
    let   likes = (res.data || [])
      .filter(l => l.bar_id === barId)
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    // Aplica filtro
    if (filter === 'new')     likes = likes.filter(l => !l.bar_replied);
    if (filter === 'replied') likes = likes.filter(l => !!l.bar_replied);

    // Atualiza contador total e badge da aba
    const total   = (res.data || []).filter(l => l.bar_id === barId).length;
    const noReply = (res.data || []).filter(l => l.bar_id === barId && !l.bar_replied).length;
    const totalEl  = document.getElementById('bar-likes-total');
    const badgeEl  = document.getElementById('btab-fas-badge');
    const previewEl = document.getElementById('bex-likes-preview-list');

    if (totalEl) totalEl.textContent = `${total} curtida${total !== 1 ? 's' : ''}`;
    if (badgeEl) {
      badgeEl.textContent    = noReply || '';
      badgeEl.style.display  = noReply > 0 ? 'inline-flex' : 'none';
    }

    listEl.innerHTML = '';

    if (!likes.length) {
      emptyEl.style.display = 'flex';
      if (previewEl) previewEl.innerHTML =
        `<div class="bex-likes-empty-mini"><i class="fa fa-heart"></i> Nenhuma curtida ainda</div>`;
      return;
    }
    emptyEl.style.display = 'none';

    // Preview no painel principal (até 3)
    if (previewEl) {
      const previewLikes = (res.data || [])
        .filter(l => l.bar_id === barId)
        .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
        .slice(0, 3);
      previewEl.innerHTML = '';
      previewLikes.forEach(l => {
        const div = document.createElement('div');
        div.className = 'bex-like-mini-item';
        const init = (l.user_name || '?')[0].toUpperCase();
        const roleIcon = l.user_role === 'promoter' ? '⭐' : '👤';
        div.innerHTML = `
          <div class="blmi-avatar" style="${l.user_photo ? `background-image:url('${l.user_photo}');background-size:cover;background-position:center;` : ''}">${l.user_photo ? '' : init}</div>
          <div class="blmi-info">
            <span class="blmi-name">${l.user_name || 'Usuário'}</span>
            <span class="blmi-role">${roleIcon} ${l.user_role === 'promoter' ? 'Promoter' : 'Cliente'}</span>
          </div>
          ${l.bar_replied ? '<span class="blmi-replied">✅</span>' : '<span class="blmi-new">Novo</span>'}`;
        previewEl.appendChild(div);
      });
    }

    likes.forEach(like => {
      const card = document.createElement('div');
      card.className = `bar-like-card${like.bar_replied ? ' replied' : ''}`;

      const init     = (like.user_name || '?')[0].toUpperCase();
      const roleIcon = like.user_role === 'promoter' ? '⭐ Promoter' : '👤 Cliente';
      const roleClass= like.user_role === 'promoter' ? 'role-promoter' : 'role-cliente';
      const dateStr  = formatDate(like.created_at);

      card.innerHTML = `
        <div class="blc-left">
          <div class="blc-avatar" style="${like.user_photo
            ? `background-image:url('${like.user_photo}');background-size:cover;background-position:center;`
            : ''}">${like.user_photo ? '' : init}</div>
        </div>
        <div class="blc-body">
          <div class="blc-top-row">
            <span class="blc-name">${like.user_name || 'Usuário'}</span>
            <span class="blc-role ${roleClass}">${roleIcon}</span>
          </div>
          <p class="blc-date"><i class="fa fa-heart"></i> Curtiu em ${dateStr}</p>
          ${like.bar_replied
            ? `<div class="blc-reply-preview"><i class="fa fa-reply"></i> <em>${(like.bar_reply || '').slice(0, 80)}${(like.bar_reply || '').length > 80 ? '...' : ''}</em></div>`
            : `<p class="blc-no-reply">Sem resposta ainda</p>`}
        </div>
        <button class="blc-reply-btn${like.bar_replied ? ' replied' : ''}"
          onclick="openBarReplyModal('${like.id}', '${(like.user_name || '').replace(/'/g,"\\'")}', '${like.user_role || 'cliente'}', '${(like.bar_reply || '').replace(/'/g,"\\'")}', '${like.user_photo || ''}', '${dateStr}')">
          <i class="fa fa-reply"></i>
          ${like.bar_replied ? 'Editar' : 'Responder'}
        </button>`;

      listEl.appendChild(card);
    });

  } catch {
    listEl.innerHTML = '';
    emptyEl.style.display = 'flex';
  }
}

function filterBarLikes(filter) {
  ['all','new','replied'].forEach(f => {
    const btn = document.getElementById(`blf-${f}`);
    if (btn) btn.classList.toggle('active', f === filter);
  });
  loadBarLikes(filter);
}

/* ── Abre o modal de resposta do bar ───────────────────── */
function openBarReplyModal(likeId, userName, userRole, prevReply, userPhoto, dateStr) {
  _currentReplyLikeId = likeId;

  const nameEl    = document.getElementById('mbr-fan-name');
  const roleEl    = document.getElementById('mbr-fan-role');
  const dateEl    = document.getElementById('mbr-fan-date');
  const avatarEl  = document.getElementById('mbr-fan-avatar');
  const prevWrap  = document.getElementById('mbr-prev-reply');
  const prevText  = document.getElementById('mbr-prev-text');
  const textArea  = document.getElementById('bar-reply-text');
  const charCount = document.getElementById('mbr-char-count');
  const btn       = document.getElementById('btn-send-bar-reply');

  if (nameEl) nameEl.textContent   = userName || 'Usuário';
  if (roleEl) roleEl.textContent   = userRole === 'promoter' ? '⭐ Promoter' : '👤 Cliente';
  if (dateEl) dateEl.textContent   = `Curtiu em ${dateStr}`;
  if (avatarEl) {
    if (userPhoto) {
      avatarEl.style.backgroundImage    = `url('${userPhoto}')`;
      avatarEl.style.backgroundSize     = 'cover';
      avatarEl.style.backgroundPosition = 'center';
      avatarEl.textContent = '';
    } else {
      avatarEl.style.backgroundImage = '';
      avatarEl.textContent = (userName || '?')[0].toUpperCase();
    }
  }

  if (prevReply) {
    if (prevWrap) prevWrap.style.display = 'block';
    if (prevText) prevText.textContent   = prevReply;
    if (textArea) textArea.value = prevReply;
  } else {
    if (prevWrap) prevWrap.style.display = 'none';
    if (textArea) textArea.value = '';
  }

  if (charCount) charCount.textContent = `${(textArea?.value || '').length} / 200`;
  if (btn) { btn.innerHTML = '<i class="fa fa-paper-plane"></i> Enviar resposta'; btn.disabled = false; }

  openModal('modal-bar-reply');
}

/* Atualiza contador de caracteres no textarea */
function barReplyTextInput() {
  const ta  = document.getElementById('bar-reply-text');
  const cnt = document.getElementById('mbr-char-count');
  if (ta && cnt) {
    const len = ta.value.length;
    cnt.textContent = `${len} / 200`;
    cnt.style.color = len > 180 ? '#f87171' : 'rgba(255,255,255,0.35)';
    if (len > 200) ta.value = ta.value.slice(0, 200);
  }
}

function setBarReplyText(text) {
  const ta = document.getElementById('bar-reply-text');
  if (ta) {
    ta.value = text;
    barReplyTextInput();
    ta.focus();
  }
}

/* ── Envia a resposta do bar ao fã ─────────────────────── */
async function sendBarReply() {
  const likeId  = _currentReplyLikeId;
  const text    = (document.getElementById('bar-reply-text')?.value || '').trim();
  const btn     = document.getElementById('btn-send-bar-reply');

  if (!likeId) return;
  if (!text)   { showToast('Escreva uma mensagem antes de enviar.', 'error'); return; }

  if (btn) { btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Enviando...'; btn.disabled = true; }

  try {
    await apiPatch(`tables/bar_likes/${likeId}`, {
      bar_replied:  true,
      bar_reply:    text,
      bar_reply_at: new Date().toISOString(),
    });
    closeModal('modal-bar-reply');
    showToast('Resposta enviada! ✅', 'success');
    loadBarLikes(); // Atualiza lista
  } catch {
    showToast('Erro ao enviar. Tente novamente.', 'error');
  } finally {
    if (btn) { btn.innerHTML = '<i class="fa fa-paper-plane"></i> Enviar resposta'; btn.disabled = false; }
  }
}

function loadFavoriteBars() {
  const listEl  = document.getElementById('profile-favbars-list');
  const emptyEl = document.getElementById('profile-favbars-empty');
  if (!listEl) return;
  listEl.innerHTML = '';
  const favIds = OZ.favoriteBars;
  if (!favIds.length) { emptyEl.style.display = 'flex'; return; }
  emptyEl.style.display = 'none';
  const allB = allBars.length ? allBars : FALLBACK_BARS;
  favIds.forEach(id => {
    const bar = allB.find(b => b.id === id);
    if (!bar) return;
    const card = document.createElement('div');
    card.className = 'fav-bar-card';
    card.onclick = () => openBarDetail(bar);
    card.innerHTML = `
      <img src="${bar.photo_url || DEF_IMG}" alt="${bar.name}" onerror="this.src='${DEF_IMG}'" />
      <div class="fav-bar-info">
        <p class="fav-bar-name">${bar.name}</p>
        <p class="fav-bar-hood"><i class="fa fa-map-marker-alt"></i> ${bar.neighborhood}</p>
        ${bar.event_tonight ? `<p class="fav-bar-event"><i class="fa fa-music"></i> ${bar.event_tonight}</p>` : ''}
      </div>
      <i class="fa fa-chevron-right fav-bar-arrow"></i>`;
    listEl.appendChild(card);
  });
}

function renderFavBarsHome() {
  const listEl  = document.getElementById('fav-bars-list');
  const emptyEl = document.getElementById('fav-bars-empty');
  if (!listEl) return;
  listEl.innerHTML = '';
  const favIds = OZ.favoriteBars;
  if (!favIds.length) { emptyEl.style.display = 'flex'; return; }
  emptyEl.style.display = 'none';
  const allB = allBars.length ? allBars : FALLBACK_BARS;
  const favB = favIds.map(id => allB.find(b => b.id === id)).filter(Boolean);

  listEl.innerHTML = `
    <div class="cine-section-header">
      <span class="cine-section-title"><i class="fa fa-heart"></i> Meus bares favoritos</span>
      <span class="cine-section-count">${favB.length}</span>
    </div>
    <div class="cine-cards-list" id="cine-fav-list"></div>`;

  _renderCineList('cine-fav-list', favB, allPromos);
}

function toggleNfxSearch() {
  const bar = document.getElementById('nfx-search-bar');
  const input = document.getElementById('search-bars');
  if (!bar) return;
  const isOpen = bar.style.display !== 'none';
  bar.style.display = isOpen ? 'none' : 'flex';
  if (!isOpen && input) { input.value = ''; input.focus(); filterBars(); }
  if (isOpen && input) { input.value = ''; filterBars(); }
}

function switchHomeTab(tab) {
  /* Fecha feed se estava aberto */
  if (window.OZFeed) OZFeed.close();

  document.getElementById('htab-discover') ?.classList.toggle('active', tab === 'discover');
  document.getElementById('htab-favorites')?.classList.toggle('active', tab === 'favorites');
  document.getElementById('htab-scheduled')?.classList.toggle('active', tab === 'scheduled');

  document.getElementById('home-discover-pane') .style.display = tab === 'discover'  ? 'block' : 'none';
  document.getElementById('home-favorites-pane').style.display = tab === 'favorites' ? 'block' : 'none';
  document.getElementById('home-scheduled-pane').style.display = tab === 'scheduled' ? 'block' : 'none';

  const titleMap = {
    discover:  OZ.currentUser?.name?.split(' ')[0] || 'Bares parceiros',
    favorites: 'Meus Bares',
    scheduled: 'Benefícios Agendados',
  };
  const titleEl = document.getElementById('home-title');
  if (titleEl) titleEl.textContent = titleMap[tab] || 'Bares parceiros';

  if (tab === 'favorites') renderFavBarsHome();
  if (tab === 'scheduled') {
    // Garante que não há data de hoje selecionada (aba só mostra datas futuras)
    if (!OZ._hcal.selectedDate || OZ._hcal.selectedDate <= _todayStr()) {
      OZ._hcal.selectedDate = null;
    }
    if (!_barsDataLoaded) {
      // Dados ainda não foram carregados (ou estão sendo carregados).
      // Se já está em andamento, o .then() de loadBars() vai re-renderizar o calendário.
      // Se não iniciou ainda, chama loadBars() agora.
      if (!_barsDataLoading) loadBars();
      // Mostra feedback visual enquanto aguarda
      hcalRender();
    } else {
      hcalRender();
      _hcalApplyFilter();
    }
  }
}

/* ══════════════════════════════════
   INDIQUE E GANHE
══════════════════════════════════ */
function shareInviteWhatsApp() {
  const user = OZ.currentUser;
  if (!user) return;
  const code = user.invite_code || (user.id || 'OZ').slice(0,8).toUpperCase();
  const msg = encodeURIComponent(`🎉 Oi! Te convido para a *Oz App* — descubra bares incríveis e ative benefícios exclusivos!\n\nUse meu link: oz.app/convite/${code}\n\nBaixe agora e ganhe seu primeiro benefício!`);
  window.open(`https://wa.me/?text=${msg}`, '_blank');
}

function copyInviteLink() {
  copyInviteCode();
}

function copyInviteCode() {
  const user = OZ.currentUser;
  if (!user) return;
  const code = user.invite_code || (user.id || 'OZ').slice(0,8).toUpperCase();
  copyToClipboard(code);
  showToast('Código copiado! 🔗', 'success');
}

/* ══════════════════════════════════
   TOGGLE SEÇÕES DO PERFIL
══════════════════════════════════ */
function toggleSection(id) {
  const body  = document.getElementById(id);
  const arrow = document.getElementById(`${id}-arrow`);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  if (arrow) arrow.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
  // Recarrega usuários online ao abrir o chat
  if (id === 'chat-section' && !isOpen) {
    loadOnlineUsers();
  }
}

/* ══════════════════════════════════
   PRESENÇA ONLINE (user_presence)
══════════════════════════════════ */
async function updatePresence() {
  const user = OZ.currentUser;
  if (!user || user.id.startsWith('demo-')) return;
  try {
    // Busca registro existente
    const res = await apiGet(`tables/user_presence?limit=500`);
    const existing = (res.data || []).find(p => p.user_id === user.id);
    const payload = {
      user_id:   user.id,
      user_name: user.name,
      user_avatar: (user.name || '?')[0].toUpperCase(),
      user_role:   user.role,
      last_seen:   Date.now(),
      is_online:   true,
      current_bar: OZ.currentBar?.name || ''
    };
    if (existing) {
      await apiPatch(`tables/user_presence/${existing.id}`, payload);
    } else {
      await apiPost('tables/user_presence', payload);
    }
  } catch {}
}

async function markPresenceOffline() {
  const user = OZ.currentUser;
  if (!user || user.id.startsWith('demo-')) return;
  try {
    const res = await apiGet(`tables/user_presence?limit=500`);
    const existing = (res.data || []).find(p => p.user_id === user.id);
    if (existing) await apiPatch(`tables/user_presence/${existing.id}`, { is_online: false });
  } catch {}
}

async function loadOnlineUsers() {
  const listEl = document.getElementById('chat-online-list');
  const badge  = document.getElementById('online-count-badge');
  if (!listEl) return;
  const user = OZ.currentUser;
  if (!user || user.id.startsWith('demo-')) {
    // Demo: sem usuários reais
    listEl.innerHTML = '<div class="empty-state"><i class="fa fa-circle" style="color:#6b7280"></i><p>Nenhum usuário online agora.</p></div>';
    if (badge) badge.textContent = '0 online';
    return;
  }
  try {
    const res = await apiGet(`tables/user_presence?limit=500`);
    const now = Date.now();
    // Considera online quem viu nos últimos 3 minutos
    const online = (res.data || []).filter(p =>
      p.is_online && p.user_id !== user.id && (now - (p.last_seen || 0)) < 3 * 60 * 1000
    );
    OZ.onlineUsers = online;
    if (badge) badge.textContent = `${online.length} online`;
    if (!online.length) {
      listEl.innerHTML = '<div class="empty-state"><i class="fa fa-circle" style="color:#6b7280"></i><p>Nenhum usuário online agora.</p></div>';
      return;
    }
    listEl.innerHTML = '';
    online.forEach(u => {
      const item = document.createElement('div');
      item.className = 'online-user-item';
      const photoUrl   = u.user_photo || '';
      const avatarText = u.user_name?.[0]?.toUpperCase() || '?';
      const avatarEl   = photoUrl
        ? `<div class="online-user-avatar" style="background-image:url('${photoUrl}');background-size:cover;background-position:center;"></div>`
        : `<div class="online-user-avatar">${avatarText}</div>`;
      item.innerHTML = `
        ${avatarEl}
        <div class="online-user-info">
          <p class="online-user-name">${u.user_name}</p>
          <p class="online-user-meta"><span class="online-dot-sm"></span> online${u.current_bar ? ' · ' + u.current_bar : ''}</p>
        </div>
        <button class="btn-start-chat" onclick="openChatWith('${u.user_id}','${u.user_name}','${avatarText}','${photoUrl}')">
          <i class="fa fa-comment"></i>
        </button>`;
      listEl.appendChild(item);
    });
  } catch {
    listEl.innerHTML = '<div class="empty-state"><i class="fa fa-circle" style="color:#6b7280"></i><p>Nenhum usuário online agora.</p></div>';
  }
}

/* ══════════════════════════════════
   CHAT REAL (chat_messages + polling)
══════════════════════════════════ */
function openChatWith(userId, name, avatar, photoUrl) {
  OZ.chatTarget = { id: userId, name, avatar, photoUrl: photoUrl || '' };
  document.getElementById('chat-modal-avatar').textContent = avatar;
  document.getElementById('chat-modal-name').textContent   = name;
  // Para poll anterior se existir
  if (OZ.chatPollInterval) { clearInterval(OZ.chatPollInterval); OZ.chatPollInterval = null; }
  loadChatMessages();
  openModal('modal-chat');
  // Polling a cada 3s enquanto modal aberto
  OZ.chatPollInterval = setInterval(loadChatMessages, 3000);
}

async function loadChatMessages() {
  const el = document.getElementById('chat-messages');
  if (!el || !OZ.chatTarget || !OZ.currentUser) return;
  const myId     = OZ.currentUser.id;
  const theirId  = OZ.chatTarget.id;
  if (myId.startsWith('demo-') || theirId.startsWith('demo-')) {
    if (!OZ.chatMessages[theirId]) OZ.chatMessages[theirId] = [];
    renderChatMessages(OZ.chatMessages[theirId]);
    return;
  }
  try {
    const res = await apiGet(`tables/chat_messages?limit=200&sort=created_at`);
    const msgs = (res.data || []).filter(m =>
      (m.sender_id === myId && m.receiver_id === theirId) ||
      (m.sender_id === theirId && m.receiver_id === myId)
    ).sort((a, b) => a.created_at - b.created_at);
    renderChatMessages(msgs);
  } catch {
    renderChatMessages([]);
  }
}

function renderChatMessages(msgs) {
  const el = document.getElementById('chat-messages');
  if (!el) return;
  if (!msgs.length) {
    el.innerHTML = '<div class="chat-msg-empty"><i class="fa fa-comments"></i><p>Inicie uma conversa!</p></div>';
    return;
  }

  const myUser    = OZ.currentUser;
  const myPhoto   = myUser?.photo_url || '';
  const myInitial = (myUser?.name || '?')[0].toUpperCase();
  const theirPhoto   = OZ.chatTarget?.photoUrl || '';
  const theirInitial = (OZ.chatTarget?.name || '?')[0].toUpperCase();

  el.innerHTML = msgs.map(m => {
    const mine = m.from === myUser?.id || m.sender_id === myUser?.id;
    const ts   = m.ts || m.created_at || 0;
    const photo   = mine ? myPhoto   : theirPhoto;
    const initial = mine ? myInitial : theirInitial;
    const avatarHtml = photo
      ? `<div class="chat-avatar" style="background-image:url('${photo}');background-size:cover;background-position:center;"></div>`
      : `<div class="chat-avatar chat-avatar-init">${initial}</div>`;
    return `
    <div class="chat-msg-row ${mine ? 'mine' : 'theirs'}">
      ${!mine ? avatarHtml : ''}
      <div class="chat-bubble ${mine ? 'mine' : 'theirs'}">
        <p>${m.text || m.content || ''}</p>
        <span class="chat-time">${formatTime(ts)}</span>
      </div>
      ${mine ? avatarHtml : ''}
    </div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const text  = input.value.trim();
  if (!text || !OZ.chatTarget || !OZ.currentUser) return;
  input.value = '';
  const myId    = OZ.currentUser.id;
  const theirId = OZ.chatTarget.id;
  // Demo: armazena localmente
  if (myId.startsWith('demo-') || theirId.startsWith('demo-')) {
    if (!OZ.chatMessages[theirId]) OZ.chatMessages[theirId] = [];
    OZ.chatMessages[theirId].push({ from: myId, text, ts: Date.now() });
    renderChatMessages(OZ.chatMessages[theirId]);
    return;
  }
  try {
    await apiPost('tables/chat_messages', {
      sender_id:    myId,
      sender_name:  OZ.currentUser.name,
      receiver_id:  theirId,
      receiver_name: OZ.chatTarget.name,
      content:      text,
      read:         false,
    });
    // Recarrega imediatamente
    await loadChatMessages();
  } catch {
    showToast('Erro ao enviar mensagem', 'error');
  }
}

function closeChatModal() {
  if (OZ.chatPollInterval) { clearInterval(OZ.chatPollInterval); OZ.chatPollInterval = null; }
  closeModal('modal-chat');
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}



/* ══════════════════════════════════
   PAINEL — BAR
══════════════════════════════════ */
async function loadBarPanel() {
  const user = OZ.currentUser;
  if (!user || user.role !== 'bar') return;

  // Preenche header executivo
  const nameEl  = document.getElementById('bar-panel-name');
  const genreEl = document.getElementById('bar-panel-genre');
  if (nameEl)  nameEl.textContent  = user.bar_name || user.name;
  if (genreEl) genreEl.textContent = genreMap[user.bar_genre] || '';

  try {
    const barId = user.bar_id;
    if (!barId || barId.startsWith('demo-')) {
      document.getElementById('bm-activations').textContent = '142';
      document.getElementById('bm-visitors').textContent    = '98';
      document.getElementById('bm-peak').textContent        = '23h–01h';
      document.getElementById('bm-promos').textContent      = '2';
      loadBarTabInfo(DEMO_BAR_DATA);
      initPromoTab([], barId || 'demo');
      return;
    }

    const barData = await apiGet(`tables/bars/${barId}`);

    // Foto no header executivo: cover_url no fundo, photo_url no logo
    const heroBg  = document.getElementById('bar-panel-hero-bg');
    const logoImg = document.getElementById('bex-logo-img');
    const bgUrl   = barData.cover_url || barData.photo_url || '';
    const logoUrl = barData.photo_url || barData.cover_url || '';
    if (bgUrl && heroBg) {
      heroBg.style.backgroundImage    = `url('${bgUrl}')`;
      heroBg.style.backgroundSize     = 'cover';
      heroBg.style.backgroundPosition = 'center';
    }
    if (logoUrl && logoImg) {
      logoImg.style.backgroundImage    = `url('${logoUrl}')`;
      logoImg.style.backgroundSize     = 'cover';
      logoImg.style.backgroundPosition = 'center';
      logoImg.textContent = '';
    }

    // Métricas — apenas ativações confirmadas (status=active), exclui grátis e pending
    const actsRes  = await apiGet(`tables/activations?limit=200`);
    const BLOCKED_STATUS = new Set(['cancelled', 'failed', 'pending_payment', 'pending']);
    const acts     = (actsRes.data || []).filter(a =>
      a.bar_id === barId &&
      a.type !== 'free_credit' &&
      !BLOCKED_STATUS.has(a.status)
    );
    const promoRes = await apiGet(`tables/promotions?limit=50`);
    const promos   = (promoRes.data || []).filter(p => p.bar_id === barId && isPromoActive(p));

    const totalActs    = acts.length;
    const uniqueVisits = [...new Set(acts.map(a => a.user_id))].length;
    // KPI antigos (mantidos para compatibilidade)
    const bmActs = document.getElementById('bm-activations');
    if (bmActs) bmActs.textContent = totalActs;
    const bmVis = document.getElementById('bm-visitors');
    if (bmVis) bmVis.textContent = uniqueVisits;
    const bmPeak = document.getElementById('bm-peak');
    if (bmPeak) bmPeak.textContent = barData.peak_hour || '--';
    const bmPromos = document.getElementById('bm-promos');
    if (bmPromos) bmPromos.textContent = promos.length;

    // Ativações hoje
    const todayStr = localDateStr(new Date());
    const actsToday = acts.filter(a => localDateStr(new Date(a.created_at)) === todayStr);
    const bdEl = document.getElementById('bm-acts-today');
    if (bdEl) bdEl.textContent = actsToday.length;

    // Novas abas internas — Ativações totais
    _renderBpdTotaisTab(acts, uniqueVisits, barData, promos);

    // Gráfico de ativações (últimos 7 dias)
    _renderBarDashboardChart(acts);

    // Funil de tipos (novos IDs bpit-)
    _renderBarFunnel(acts);

    // Tabela de ativações recentes (preview + full) — resolve nomes antes de renderizar
    await resolveUserNames(acts.map(a => a.user_id));
    _renderBarActsTable(acts.slice(0, 5));
    _renderBarActsTableFull(acts);
    // Atualiza contador do card recentes
    const rcCount = document.getElementById('bpd-recent-count');
    if (rcCount) rcCount.textContent = acts.length;

    loadBarTabInfo(barData);
    initPromoTab(promos, barId);
    loadBarResults(acts);
    loadBarLikes('all');
  } catch {
    document.getElementById('bm-activations').textContent = user.total_activations || 0;
    document.getElementById('bm-visitors').textContent    = user.total_visitors    || 0;
    document.getElementById('bm-peak').textContent        = '--';
    document.getElementById('bm-promos').textContent      = '0';
  }
}

/* ─ Gráfico de linha: ativações × visitantes (7 dias) ─ */
let _barChartInstance = null;
function _renderBarDashboardChart(acts) {
  const canvas = document.getElementById('bar-chart-activations');
  if (!canvas || typeof Chart === 'undefined') return;

  // Últimos 7 dias
  const days = [];
  const labelsActs = []; const labelsVisits = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const str = localDateStr(d);
    const dayActs    = acts.filter(a => localDateStr(new Date(a.created_at)) === str);
    const dayVisits  = [...new Set(dayActs.map(a => a.user_id))].length;
    const label      = d.toLocaleDateString('pt-BR', { weekday: 'short' }).toUpperCase().replace('.','');
    days.push(label); labelsActs.push(dayActs.length); labelsVisits.push(dayVisits);
  }
  if (_barChartInstance) { _barChartInstance.destroy(); _barChartInstance = null; }
  _barChartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      labels: days,
      datasets: [
        { label: 'Ativações', data: labelsActs,
          borderColor: '#00F5FF',
          backgroundColor: (ctx) => {
            const {ctx: c, chartArea} = ctx.chart;
            if (!chartArea) return 'rgba(0,245,255,0.12)';
            const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            g.addColorStop(0, 'rgba(0,245,255,0.26)'); g.addColorStop(1, 'rgba(0,245,255,0.0)');
            return g;
          },
          borderWidth: 2.5, fill: true, tension: 0.45,
          pointBackgroundColor: '#3cf7ff', pointBorderColor: '#0f0e09',
          pointBorderWidth: 2, pointRadius: 5, pointHoverRadius: 7 },
        { label: 'Visitantes', data: labelsVisits,
          borderColor: '#a78bfa',
          backgroundColor: (ctx) => {
            const {ctx: c, chartArea} = ctx.chart;
            if (!chartArea) return 'rgba(167,139,250,0.06)';
            const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            g.addColorStop(0, 'rgba(167,139,250,0.16)'); g.addColorStop(1, 'rgba(167,139,250,0.0)');
            return g;
          },
          borderWidth: 2, fill: true, tension: 0.45,
          pointBackgroundColor: '#a78bfa', pointBorderColor: '#0f0e09',
          pointBorderWidth: 2, pointRadius: 4, pointHoverRadius: 6 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: {
        backgroundColor: '#181710', borderColor: 'rgba(0,245,255,0.3)',
        borderWidth: 1, titleColor: '#3cf7ff', bodyColor: 'rgba(242,240,230,0.75)',
        padding: 14, cornerRadius: 10
      }},
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: 'rgba(242,240,230,0.35)', font: { size: 12, weight: '600' } } },
        y: { grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false }, border: { display: false }, ticks: { color: 'rgba(242,240,230,0.35)', font: { size: 12 } }, beginAtZero: true }
      }
    }
  });
}

/* ─ Aba Ativações Totais (novos KPIs bpit-) ─ */
function _renderBpdTotaisTab(acts, uniqueVisits, barData, promos) {
  const todayStr  = localDateStr(new Date());
  const actsToday = acts.filter(a => localDateStr(new Date(a.created_at)) === todayStr);
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('bpit-total-acts', acts.length);
  set('bpit-today-acts', actsToday.length);
  set('bpit-visitors',   uniqueVisits);
  set('bpit-promos',     promos.length);
}

/* ─ Funil de tipos de ativação ─ */
function _renderBarFunnel(acts) {
  const ind   = acts.filter(a => a.type === 'individual' || a.type === 'night').length;
  const night = acts.filter(a => a.type === 'night_link').length;
  const free  = acts.filter(a => a.type === 'free_credit').length;
  const total = acts.length || 1;

  const set = (idBar, idVal, count, max) => {
    const barEl = document.getElementById(idBar);
    const valEl = document.getElementById(idVal);
    if (barEl) barEl.style.width = Math.round((count/max)*100) + '%';
    if (valEl) valEl.textContent = count;
  };
  // IDs do funil na aba totais
  set('bpit-funnel-ind',   'bpit-funnel-ind-val',   ind,   total);
  set('bpit-funnel-night', 'bpit-funnel-night-val',  night, total);
  set('bpit-funnel-free',  'bpit-funnel-free-val',   free,  total);
  // IDs legados (compatibilidade, se existirem)
  set('bar-funnel-ind',   'bar-funnel-ind-val',   ind,   total);
  set('bar-funnel-night', 'bar-funnel-night-val',  night, total);
  set('bar-funnel-free',  'bar-funnel-free-val',   free,  total);
}

/* ─ Helper para renderizar linhas da tabela de ativações ─ */
function _buildActsRows(acts) {
  return acts.map(a => {
    const name = a.user_name || OZ.userNameCache[a.user_id] || 'Cliente';
    const date = a.created_at ? new Date(a.created_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' }) : '—';
    return `<div class="dbd-table-row">
      <div class="dbd-tr-name">${name}</div>
      <div class="dbd-tr-date">${date}</div>
    </div>`;
  }).join('');
}

/* ─ Tabela de ativações recentes (preview – 5 itens) ─ */
function _renderBarActsTable(acts) {
  const el = document.getElementById('bm-acts-table');
  if (!el) return;
  if (!acts.length) { el.innerHTML = '<div class="dbd-table-empty"><i class="fa fa-inbox"></i> Sem ativações ainda</div>'; return; }
  el.innerHTML = _buildActsRows(acts);
}

/* ─ Tabela completa de ativações (todas) ─ */
function _renderBarActsTableFull(acts) {
  const el = document.getElementById('bm-acts-table-full');
  if (!el) return;
  if (!acts.length) { el.innerHTML = '<div class="dbd-table-empty"><i class="fa fa-inbox"></i> Sem ativações ainda</div>'; return; }
  el.innerHTML = _buildActsRows(acts);
}

function loadBarTabInfo(barData) {
  // Campos de texto
  const nameEl    = document.getElementById('bar-edit-name');
  const hoodEl    = document.getElementById('bar-edit-hood');
  const photoEl   = document.getElementById('bar-edit-photo');
  const coverEl   = document.getElementById('bar-edit-cover');
  const activeEl  = document.getElementById('bar-edit-active');
  const igEl      = document.getElementById('bar-edit-instagram');
  const relEl     = document.getElementById('bar-edit-release');
  const genreEl   = document.getElementById('bar-edit-genre');
  const addrEl    = document.getElementById('bar-edit-address');
  const hoursEl   = document.getElementById('bar-edit-hours');
  const waEl      = document.getElementById('bar-edit-whatsapp');

  if (nameEl)   nameEl.value   = barData.name         || '';
  if (hoodEl)   hoodEl.value   = barData.neighborhood || '';
  if (photoEl)  photoEl.value  = barData.photo_url    || '';
  if (coverEl)  coverEl.value  = barData.cover_url    || '';
  if (activeEl) activeEl.value = barData.active !== false ? 'true' : 'false';
  if (igEl)     igEl.value     = barData.instagram    || '';
  if (relEl)    relEl.value    = barData.release       || barData.description || '';
  if (addrEl)   addrEl.value   = barData.address      || '';
  if (waEl)     waEl.value     = barData.whatsapp      || '';

  // Carrega horário no picker (campo oculto + seletores visuais)
  if (hoursEl)  hoursEl.value  = barData.hours || '';
  loadHoursIntopicker(barData.hours || '');

  // Gênero
  const genre = barData.genre || OZ.currentUser?.bar_genre || '';
  if (genreEl && genre) genreEl.value = genre;

  // ── Preview da CAPA ──
  const coverImg        = document.getElementById('bar-cover-preview-img');
  const coverHolder     = document.getElementById('bar-cover-placeholder');
  const coverChangeBadge= document.getElementById('bar-cover-change-badge');
  const coverUrl        = barData.cover_url || '';
  if (coverUrl && coverImg) {
    coverImg.src = coverUrl; coverImg.style.display = 'block';
    if (coverHolder)      coverHolder.style.display = 'none';
    if (coverChangeBadge) coverChangeBadge.style.display = 'flex';
  } else if (coverImg) {
    coverImg.style.display = 'none';
    if (coverHolder)      coverHolder.style.display = 'flex';
    if (coverChangeBadge) coverChangeBadge.style.display = 'none';
  }

  // ── Preview do LOGO / foto de perfil ──
  const logoPreview = document.getElementById('bar-edit-logo-preview');
  if (logoPreview) {
    const logoUrl = barData.photo_url || '';
    if (logoUrl) {
      logoPreview.style.backgroundImage    = `url('${logoUrl}')`;
      logoPreview.style.backgroundSize     = 'cover';
      logoPreview.style.backgroundPosition = 'center';
      logoPreview.textContent = '';
    } else {
      logoPreview.style.backgroundImage = '';
      logoPreview.textContent = '🍺';
    }
  }

  // ── Galeria ──
  const gallery = Array.isArray(barData.gallery) ? barData.gallery : [];
  renderBarGalleryGrid(gallery);
}

function loadBarPromos(promos, barId) {
  const listEl    = document.getElementById('bar-promos-list');
  const emptyEl   = document.getElementById('bar-promos-empty');
  const cancelBtn = document.getElementById('bsl-cancel-all-btn');
  listEl.innerHTML = '';
  const hasActive = (promos || []).some(p => isPromoActive(p));
  if (cancelBtn) cancelBtn.style.display = hasActive ? 'flex' : 'none';
  if (!promos.length) { emptyEl.style.display = 'flex'; return; }
  emptyEl.style.display = 'none';
  promos.forEach(p => {
    const item = document.createElement('div');
    item.className = 'promo-item';
    const badgeLabel = p.benefit_type === 'livre' ? '✍️ Livre' : (promoTypeMap[p.benefit_type] || p.benefit_type || '🎁 Promo');
    const maxInfo = p.max_activations > 0
      ? `<span class="promo-item-limit"><i class="fa fa-users"></i> Limite: ${p.activations_count||0}/${p.max_activations}</span>`
      : '';
    item.innerHTML = `
      <div class="promo-item-main">
        <div class="promo-item-info">
          <p class="promo-item-title">${p.title}</p>
          <p class="promo-item-desc">${p.description || ''}</p>
          <div class="promo-item-footer">
            <p class="promo-item-meta"><i class="fa fa-clock"></i> ${p.valid_from||'--'} até 06:00</p>
            ${maxInfo}
          </div>
        </div>
        <span class="promo-item-badge">${badgeLabel}</span>
      </div>
      <button class="promo-cancel-btn" onclick="openCancelPromoModal('${p.id}', '${(p.title||'').replace(/'/g,"\\'")}')">
        <i class="fa fa-times-circle"></i> Cancelar benefício
      </button>`;
    listEl.appendChild(item);
  });
}

/* ─────────────────────────────────────────────────────────────
   CANCELAMENTO DE BENEFÍCIO PELO BAR
───────────────────────────────────────────────────────────── */
function openCancelPromoModal(promoId, promoTitle, isScheduled = false) {
  OZ.cancelPromoId          = promoId;
  OZ.cancelPromoTitle       = promoTitle;
  OZ.cancelPromoIsScheduled = !!isScheduled;
  const titleEl = document.getElementById('cancel-promo-modal-title');
  if (titleEl) titleEl.textContent = `"${promoTitle}"`;

  // Reseta o modal para a fase 1
  const stepReason = document.getElementById('mcp-step-reason');
  const stepDone   = document.getElementById('mcp-step-done');
  const reasonTA   = document.getElementById('mcp-cancel-reason');
  const reasonLen  = document.getElementById('mcp-reason-len');
  if (stepReason) stepReason.style.display = '';
  if (stepDone)   stepDone.style.display   = 'none';
  if (reasonTA)   reasonTA.value           = '';
  if (reasonLen)  reasonLen.textContent    = '0';

  // Restaura botão de confirmar
  const btn = document.getElementById('btn-confirm-cancel-promo');
  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa fa-times-circle"></i> Cancelar e avisar clientes'; }

  openModal('modal-cancel-promo');

  // Contador de caracteres
  if (reasonTA) {
    reasonTA.oninput = () => {
      if (reasonLen) reasonLen.textContent = reasonTA.value.length;
    };
  }
}

async function cancelPromotion() {
  const promoId      = OZ.cancelPromoId;
  const isScheduled  = !!OZ.cancelPromoIsScheduled;
  if (!promoId) return;

  // Valida o motivo
  const reasonTA = document.getElementById('mcp-cancel-reason');
  const reason   = (reasonTA?.value || '').trim();
  if (!reason) {
    if (reasonTA) {
      reasonTA.style.borderColor = '#ef4444';
      reasonTA.focus();
      setTimeout(() => { reasonTA.style.borderColor = ''; }, 2500);
    }
    showToast('Por favor, informe o motivo do cancelamento.', 'error');
    return;
  }

  const btn = document.getElementById('btn-confirm-cancel-promo');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Cancelando...'; }

  try {
    const isDemo = !promoId || promoId.startsWith('demo-') || promoId.startsWith('fb');

    if (!isDemo) {
      const barId   = OZ.currentUser?.bar_id;
      const barName = OZ.currentUser?.bar_name || OZ.currentUser?.name || '';

      // 1) Busca os dados completos e determina o cutoff de tempo
      // cutoff = timestamp ms (int8) de quando o benefício/promo ficou ativo.
      // Ativações criadas APÓS esse momento serão canceladas.
      // Para garantir que TODAS as ativações do dia sejam capturadas,
      // usamos o início do dia às 06:00 NO FUSO LOCAL do cliente (não UTC).
      let promoCreatedAt = null;
      if (isScheduled) {
        // Para agendados: cutoff = início do dia às 06:00 horário local
        try {
          const schedData = await apiGet(`tables/scheduled_benefits/${promoId}`);
          const schedDate = schedData.date || _todayStr();
          // Usa Date.UTC não — queremos horário local pois o servidor tb usa Date.now() local
          // Estratégia segura: pegar meia-noite do dia como cutoff (captura tudo do dia)
          const [fy, fm, fd] = schedDate.split('-').map(Number);
          promoCreatedAt  = new Date(fy, fm - 1, fd, 0, 0, 0, 0).getTime(); // 00:00 local do dia
        } catch { promoCreatedAt = new Date(_todayStr() + 'T00:00:00').getTime(); }
        // 2a) Desativa o benefício agendado
        try { await apiPatch(`tables/scheduled_benefits/${promoId}`, { active: false }); } catch { /* ignora */ }
        // Remove do cache local de agendamentos
        const cacheBarId = barId;
        const list = getSchedules(cacheBarId);
        const updated = list.map(s => {
          if (s.api_id === promoId || s.id === promoId) return { ...s, active: false };
          return s;
        });
        saveSchedules(cacheBarId, updated);
        // Limpa allPromos para esse bar para que a home reflita corretamente
        if (OZ.allPromos && OZ.allPromos[barId]) {
          OZ.allPromos[barId] = OZ.allPromos[barId].filter(p => p.id !== promoId && p._schedId !== promoId);
        }
      } else {
        // Para promos ao vivo: usa o created_at da promoção
        try {
          const promoData = await apiGet(`tables/promotions/${promoId}`);
          promoCreatedAt  = promoData.created_at ? new Date(promoData.created_at).getTime() : null;
        } catch { /* prossegue sem o created_at */ }
        // 2b) Desativa a promoção ao vivo
        await apiPatch(`tables/promotions/${promoId}`, { active: false });
        // Atualiza cache local
        if (OZ.allPromos) {
          OZ.allPromos = OZ.allPromos.filter(p => p.id !== promoId);
        }
      }

      // 3) Delega ao servidor: cancela ativações + reservas + cria free_credits + notifica clientes
      // ── EDGE FUNCTION: cancelar-beneficio-status (service_role — contorna RLS) ──
      const barSenderName = barName || 'Bar';
      const promoTitle    = OZ.cancelPromoTitle || 'benefício';

      let edgeFnResult = { ativacoes_canceladas: 0, clientes_compensados: 0 };
      try {
        const todayForCancel = _todayStr();
        const efRes = await edgeFn('cancelar-beneficio-status', {
          bar_id:               barId,
          today:                todayForCancel,
          promo_id:             !isScheduled ? promoId : undefined,
          scheduled_benefit_id: isScheduled ? promoId : undefined,
          cancel_activations:   true,   // ★ sempre cancela ativações (ao vivo e agendado)
          compensar_clientes:   true,   // ★ edge function cria free_credits + notifica
          motivo:               reason,
          bar_name:             barSenderName,
          promo_title:          promoTitle,
          cutoff_ts:            promoCreatedAt || null,
        });
        if (efRes) edgeFnResult = efRes;
        console.log('[cancelarPromo] cancelar-beneficio-status ok:', efRes);
      } catch (e) {
        console.warn('[cancelarPromo] cancelar-beneficio-status silenciado:', e?.message);
      }

      // Usa contagem retornada pelo servidor para o toast
      const affectedCount = edgeFnResult.clientes_compensados ?? 0;

      // 7) ★ Limpa promoter_pick de todos os promoters que indicavam este bar (background)
      try {
        const usersRes2 = await apiGet('tables/users?limit=500');
        const promotersToClean = (usersRes2.data || []).filter(u =>
          u.role === 'promoter' && u.promoter_pick === barId
        );
        await Promise.all(promotersToClean.map(async pu => {
          try {
            await apiPatch(`tables/users/${pu.id}`, { promoter_pick: '' });
            if (OZ.currentUser && OZ.currentUser.id === pu.id) {
              OZ.currentUser.promoter_pick = '';
              localStorage.setItem('oz_user', JSON.stringify(OZ.currentUser));
            }
          } catch { /* ignora */ }
        }));
      } catch { /* ignora — não bloqueia o cancelamento */ }

      const credMsg = affectedCount > 0
        ? ` ${affectedCount} cliente(s) receberam 1 ativação grátis.`
        : '';
      showToast(`Benefício cancelado!${credMsg}`, 'success');

    } else {
      showToast('Benefício cancelado (demo)!', 'success');
    }

    // Mostra fase 2 (mensagem enviada) em vez de fechar imediatamente
    const stepReason = document.getElementById('mcp-step-reason');
    const stepDone   = document.getElementById('mcp-step-done');
    if (stepReason && stepDone) {
      stepReason.style.display = 'none';
      stepDone.style.display   = '';
    } else {
      closeModal('modal-cancel-promo');
    }

    // Fecha a lista ao vivo imediatamente
    if (typeof closeResultsList === 'function') closeResultsList('cancel');

    // Recarrega promoções ao vivo do bar (para promos ao vivo; agendados são tratados pelo bslLoadFromAPI)
    const barIdReload = OZ.currentUser?.bar_id;
    if (!isScheduled) {
      try {
        const promoRes = await apiGet(`tables/promotions?limit=50`);
        const promos   = (promoRes.data || []).filter(p => p.bar_id === barIdReload && isPromoActive(p));
        loadBarPromos(promos, barIdReload);
        checkActivePromo(promos);
      } catch {
        loadBarPromos([], barIdReload);
        checkActivePromo([]);
      }
    } else {
      // Para agendados: recarrega a lista de agendamentos
      try { await bslLoadFromAPI(barIdReload); } catch { /* ignora */ }
      if (typeof loadSchedList === 'function') loadSchedList(barIdReload);
      if (typeof renderSchedCalendar === 'function') renderSchedCalendar();
    }

  } catch (err) {
    console.error('[OZ] cancelPromotion:', err);
    showToast('Erro ao cancelar o benefício. Tente novamente.', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa fa-times-circle"></i> Cancelar e avisar clientes'; }
  } finally {
    // Só limpa o ID/título quando o modal for fechado (não aqui)
  }
}

/* ═══════════════════════════════════════════════════════════════
   RESULTADOS EM TEMPO REAL — painel do bar
   • polling a cada 10 s quando a aba está ativa
   • agrupamento por benefício (accordion expansível)
   • busca por nome de cliente em tempo real
   • highlight nas ativações novas (últimos 30 s)
═══════════════════════════════════════════════════════════════ */

// Cache de nomes de usuários { userId → name }
OZ.userNameCache = OZ.userNameCache || {};
// Snapshot anterior para detectar novas ativações
OZ._lastActsSnapshot = OZ._lastActsSnapshot || [];
// Timestamp do último poll
OZ._lastPollAt = 0;

/* Busca o nome de um usuário pelo ID (com cache) */
async function resolveUserName(userId) {
  if (!userId) return 'Cliente';
  if (OZ.userNameCache[userId]) return OZ.userNameCache[userId];
  try {
    const u    = await apiGet(`tables/users/${userId}`);
    // Garante nome completo: prioriza u.name (campo padrão do schema)
    const name = (u.name && u.name.trim()) ? u.name.trim() : `#${userId.slice(0, 8)}`;
    OZ.userNameCache[userId] = name;
    return name;
  } catch {
    OZ.userNameCache[userId] = `#${userId.slice(0, 8)}`;
    return OZ.userNameCache[userId];
  }
}

/* Busca todos os usuários de uma vez e popula o cache de nomes completos */
async function resolveUserNames(ids) {
  const missing = [...new Set(ids)].filter(id => id && !OZ.userNameCache[id]);
  if (!missing.length) return;

  try {
    // Busca todos os usuários em uma única chamada
    const res   = await apiGet(`tables/users?limit=500`);
    const users = res.data || [];
    // Popula o cache com o nome completo de cada usuário
    users.forEach(u => {
      if (u.id) OZ.userNameCache[u.id] = u.name || `#${u.id.slice(0, 8)}`;
    });
    // Para os IDs que ainda não foram encontrados, marca com fallback
    missing.forEach(id => {
      if (!OZ.userNameCache[id]) OZ.userNameCache[id] = `#${id.slice(0, 8)}`;
    });
  } catch {
    // Fallback: marca todos os pendentes com ID curto
    missing.forEach(id => {
      if (!OZ.userNameCache[id]) OZ.userNameCache[id] = `#${id.slice(0, 8)}`;
    });
  }
}

/* Formata horário HH:MM */
function fmtTime(ts) {
  if (!ts) return '--:--';
  const d = new Date(ts);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/* Formata data curta: "hoje 21:30" ou "22/06 21:30" */
function fmtDateTime(ts) {
  if (!ts) return '--';
  const d   = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return `hoje ${fmtTime(ts)}`;
  return `${d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' })} ${fmtTime(ts)}`;
}

/* Indica se a ativação é "nova" (criada nos últimos 60 s) */
function isNewAct(ts) {
  return ts && (Date.now() - new Date(ts).getTime()) < 60_000;
}

/* ── Auxiliares de data ──────────────────────────────────── */
/* Retorna "YYYY-MM-DD" de um timestamp */
function dateKey(ts) {
  if (!ts) return '0000-00-00';
  const d = new Date(ts);
  return d.toISOString().slice(0, 10);
}

/* Label legível para o dia: "Hoje", "Ontem" ou "sex, 20/06" */
function dayLabel(isoDate) {
  const today     = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const d = new Date(isoDate + 'T00:00:00');
  if (d.getTime() === today.getTime())     return 'Hoje';
  if (d.getTime() === yesterday.getTime()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { weekday:'short', day:'2-digit', month:'2-digit' })
           .replace('.','');
}

/* Verifica se um isoDate é hoje */
function isToday(isoDate) {
  const today = new Date(); today.setHours(0,0,0,0);
  const d     = new Date(isoDate + 'T00:00:00');
  return d.getTime() === today.getTime();
}

/* ── Renderiza lista de itens de um dia filtrada por query ── */
function renderDayList(bodyEl, dayActs, promos, dk, query) {
  // Limpa listas existentes mas preserva o campo de busca
  bodyEl.querySelectorAll('.rd-subgroup').forEach(el => el.remove());

  const q = (query || '').toLowerCase().trim();
  const filtered = q
    ? dayActs.filter(a => {
        const n = a.user_name || OZ.userNameCache[a.user_id] || '';
        return n.toLowerCase().includes(q);
      })
    : dayActs;

  // Empty state dentro da pasta
  let noResult = bodyEl.querySelector('.rd-day-no-result');
  if (!noResult) {
    noResult = document.createElement('div');
    noResult.className = 'rd-day-no-result';
    noResult.innerHTML = `<i class="fa fa-search"></i> Nenhum cliente encontrado`;
    bodyEl.appendChild(noResult);
  }

  if (filtered.length === 0) {
    noResult.style.display = 'flex';
    return;
  }
  noResult.style.display = 'none';

  // Agrupa ativações do dia por promoção
  const promoMap = {};
  filtered.forEach(a => {
    const promo = promos.find(p =>
      p.bar_id === a.bar_id &&
      p.created_at && dateKey(p.created_at) === dk
    );
    const pKey   = promo ? (promo.id || promo.title) : '__misc__';
    const pTitle = promo ? promo.title : 'Benefícios do dia';
    if (!promoMap[pKey]) promoMap[pKey] = { title: pTitle, acts: [] };
    promoMap[pKey].acts.push(a);
  });

  Object.entries(promoMap).forEach(([pKey, pGroup]) => {
    const subEl = document.createElement('div');
    subEl.className = 'rd-subgroup';

    // Cabeçalho do sub‑grupo — apenas se houver mais de um benefício no dia
    if (Object.keys(promoMap).length > 1) {
      const subHdr = document.createElement('div');
      subHdr.className = 'rd-subgroup-header';
      subHdr.innerHTML = `<span class="rd-subgroup-name">${pGroup.title}</span>
        <span class="rd-subgroup-count">${pGroup.acts.length}</span>`;
      subEl.appendChild(subHdr);
    }

    // Lista de clientes
    const listEl = document.createElement('ul');
    listEl.className = 'rd-act-list';

    pGroup.acts.forEach(act => {
      const name        = act.user_name || OZ.userNameCache[act.user_id] || `#${(act.user_id||'').slice(0,8)}`;
      if (act.user_id && act.user_name) OZ.userNameCache[act.user_id] = act.user_name;
      const isNew       = isNewAct(act.created_at);
      const time        = fmtTime(act.created_at);
      const isCancelled = act.status === 'cancelled';

      // Badge do tipo de ativação
      const isNightAct   = (act.type === 'night_link' || act.type === 'night' || act.type === 'night_checkin');
      const isFreeAct    = (act.type === 'free_used');
      const isCheckinAct = (act.type === 'night_checkin');
      const typeBadge = isCancelled
        ? `<span class="rd-type-badge rd-type-cancelled">✕ Cancelado</span>`
        : isNightAct
          ? `<span class="rd-type-badge rd-type-night">🌙 ${isCheckinAct ? 'Link da Noite' : 'Noite Toda'}</span>`
          : isFreeAct
            ? `<span class="rd-type-badge rd-type-free">🎁 Grátis</span>`
            : `<span class="rd-type-badge rd-type-individual">🎯 Unitário</span>`;

      const li = document.createElement('li');
      li.className = `rd-act-item${isNew ? ' rd-act-new' : ''}${isCancelled ? ' rd-act-cancelled' : ''}`;
      li.setAttribute('data-act-id', act.id || '');

      li.innerHTML = `
        <div class="rd-act-avatar">${(name[0] || '?').toUpperCase()}</div>
        <div class="rd-act-info">
          <span class="rd-act-name">${name}</span>
          <span class="rd-act-time"><i class="fa fa-clock"></i> ${time} ${typeBadge}</span>
        </div>
        ${isNew ? '<span class="rd-act-new-dot"></span>' : ''}`;
      listEl.appendChild(li);
    });

    subEl.appendChild(listEl);
    // Insere antes do no-result
    bodyEl.insertBefore(subEl, noResult);
  });
}

/* ── Renderiza lista da promoção ativa ───────────────────── */
function renderResultsPromo(acts, activePromos) {
  const container = document.getElementById('ativados-groups-container');
  const emptyEl   = document.getElementById('ativados-empty');
  if (!container) return;

  // KPIs — atualiza contadores se os elementos existirem
  const totalActsEl    = document.getElementById('res-total-acts');
  const totalVisitorsEl = document.getElementById('res-total-visitors');
  if (totalActsEl)     totalActsEl.textContent     = acts.length;
  if (totalVisitorsEl) totalVisitorsEl.textContent = acts.length;

  if (!acts.length) {
    container.innerHTML      = '';
    emptyEl.style.display    = 'flex';
    return;
  }
  emptyEl.style.display = 'none';

  // ── Cabeçalho do evento ativo ──────────────────────────
  const promo      = activePromos[0];
  const promoTitle = promo?.title || 'Benefício ativo';
  const promoDesc  = promo?.description || '';
  const isDayList  = promo?._source === 'day';
  const expiry     = promo?.expiry_at
    ? new Date(promo.expiry_at).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' })
    : '06:00';

  // Preserva query de busca existente
  const prevInput = container.querySelector('.rp-search-input');
  const savedQ    = prevInput?.value || '';

  container.innerHTML = '';

  // Cabeçalho do evento
  const headerEl = document.createElement('div');
  headerEl.className = 'rp-event-header';
  headerEl.innerHTML = `
    <div class="rp-event-info">
      <span class="rp-event-badge"><span class="rp-event-dot"></span>Lista aberta</span>
      <strong class="rp-event-title">${promoTitle}</strong>
      ${promoDesc ? `<span class="rp-event-desc">${promoDesc}</span>` : ''}
    </div>
    ${!isDayList ? `<div class="rp-event-meta"><i class="fa fa-clock"></i> Fecha às ${expiry}</div>` : ''}`;
  container.appendChild(headerEl);

  // Campo de busca
  const searchWrap = document.createElement('div');
  searchWrap.className = 'rd-day-search-wrap';
  searchWrap.innerHTML = `
    <i class="fa fa-search rd-day-search-icon"></i>
    <input type="text" class="rp-search-input rd-day-search-input"
      placeholder="Buscar cliente na lista..."
      autocomplete="off"
      value="${savedQ.replace(/"/g,'&quot;')}"/>
    <button class="rd-day-search-clear" style="display:${savedQ ? 'flex' : 'none'}">
      <i class="fa fa-times"></i>
    </button>`;
  container.appendChild(searchWrap);

  // Corpo da lista
  const bodyEl = document.createElement('div');
  bodyEl.className = 'rp-list-body';
  container.appendChild(bodyEl);

  // Renderiza a lista filtrada
  _renderPromoList(bodyEl, acts, savedQ);

  // Eventos de busca
  const inp      = searchWrap.querySelector('.rp-search-input');
  const clearBtn = searchWrap.querySelector('.rd-day-search-clear');
  inp.addEventListener('input', () => {
    clearBtn.style.display = inp.value ? 'flex' : 'none';
    _renderPromoList(bodyEl, acts, inp.value);
  });
  clearBtn.addEventListener('click', e => {
    e.stopPropagation();
    inp.value = '';
    clearBtn.style.display = 'none';
    inp.focus();
    _renderPromoList(bodyEl, acts, '');
  });
  searchWrap.addEventListener('click', e => e.stopPropagation());
}

/* ── Renderiza os itens da lista da promoção ─────────────── */
function _renderPromoList(bodyEl, acts, query) {
  bodyEl.innerHTML = '';
  const q = (query || '').toLowerCase().trim();
  // Usa user_name do registro (gravado na ativação) ou cache como fallback
  const filtered = q
    ? acts.filter(a => {
        const n = a.user_name || OZ.userNameCache[a.user_id] || '';
        return n.toLowerCase().includes(q);
      })
    : acts;

  if (!filtered.length) {
    bodyEl.innerHTML = `<div class="rd-day-no-result"><i class="fa fa-search"></i> Nenhum cliente encontrado</div>`;
    return;
  }

  // Contador: total na lista (canceladas já foram removidas antes de chegar aqui)
  const counterEl = document.createElement('div');
  counterEl.className = 'rp-list-counter';
  counterEl.innerHTML = `<span>${filtered.length} na lista</span>`;
  bodyEl.appendChild(counterEl);

  const listEl = document.createElement('ul');
  listEl.className = 'rd-act-list';

  filtered.forEach((act, idx) => {
    // Prioriza user_name gravado na ativação (imediato) antes de consultar cache/API
    const name        = act.user_name || OZ.userNameCache[act.user_id] || `#${(act.user_id||'').slice(0,8)}`;
    // Garante que o cache fica consistente para buscas futuras
    if (act.user_id && act.user_name) OZ.userNameCache[act.user_id] = act.user_name;
    const isNew       = isNewAct(act.created_at);
    const isCancelled = act.status === 'cancelled';

    const isPending    = act.status === 'pending_payment';
    const isNightAct   = (act.type === 'night_link' || act.type === 'night' || act.type === 'night_checkin' || act.type === 'advance_night');
    const isFreeAct    = (act.type === 'free_used' || act.type === 'advance_free');
    const isCheckinAct = (act.type === 'night_checkin');
    const isAdvanceAct = (act.type === 'advance_individual' || act.type === 'advance_night' || act.type === 'advance_free');

    const typeBadge = isNightAct
      ? `<span class="rd-type-badge rd-type-night">🌙 ${isCheckinAct ? 'Link da Noite' : 'Noite Toda'}${isAdvanceAct ? ' · Antecipado' : ''}</span>`
      : isFreeAct
        ? `<span class="rd-type-badge rd-type-free">🎁 Grátis${isAdvanceAct ? ' · Antecipado' : ''}</span>`
        : `<span class="rd-type-badge rd-type-individual">🎯 Unitário${isAdvanceAct ? ' · Antecipado' : ''}</span>`;

    // Badge de pagamento aguardando confirmação (PIX gerado, webhook ainda não chegou)
    const pendingBadge = isPending
      ? `<span class="rd-type-badge rd-type-pending">⏳ Pix pendente</span>`
      : '';

    const li = document.createElement('li');
    li.className = `rd-act-item rp-act-item${isNew && !isPending ? ' rd-act-new' : ''}${isCancelled ? ' rp-act-cancelled' : ''}${isPending ? ' rp-act-pending' : ''}`;
    li.setAttribute('data-act-id', act.id || '');

    const timeStr = fmtTime(act.created_at);

    li.innerHTML = `
      <span class="rp-pos-num${isCancelled ? ' rp-pos-cancelled' : ''}">${String(idx + 1).padStart(2,'0')}</span>
      <div class="rd-act-avatar${isCancelled ? ' rp-avatar-cancelled' : ''}${isPending ? ' rp-avatar-pending' : ''}">${(name[0]||'?').toUpperCase()}</div>
      <div class="rd-act-info">
        <span class="rd-act-name${isCancelled ? ' rp-name-cancelled' : ''}">${name}</span>
        <span class="rd-act-time"><i class="fa fa-clock"></i> ${timeStr} ${typeBadge}${pendingBadge}</span>
      </div>
      ${isNew && !isCancelled && !isPending ? '<span class="rd-act-new-dot"></span>' : ''}`;
    listEl.appendChild(li);
  });

  bodyEl.appendChild(listEl);
}

/* ── renderResultsGroups (legado — mantido para compatibilidade) ── */
function renderResultsGroups(acts, promos) {
  // Redireciona para a nova função de promoção
  const activePromos = promos.filter(p => isPromoActive(p));
  renderResultsPromo(acts, activePromos);
}

/* ── Fecha a lista ao vivo e para o poller ───────────────── */
function closeResultsList(reason) {
  stopResultsPoller();

  const liveWrap  = document.getElementById('ativados-list-wrap');
  const closedEl  = document.getElementById('res-list-closed');
  const subEl     = document.getElementById('res-closed-sub');
  const dotEl     = document.getElementById('ativados-live-dot');

  if (liveWrap)  liveWrap.style.display  = 'none';
  if (closedEl)  closedEl.style.display  = 'block';
  if (dotEl) {
    dotEl.classList.remove('pulsing');
    dotEl.classList.add('rd-dot-closed');
  }

  const msgs = {
    expiry:   'A lista encerrou automaticamente às 06h00. Publique um novo benefício para abrir uma nova lista.',
    cancel:   'O benefício foi cancelado e a lista foi encerrada. Publique um novo benefício para reabrir.',
    default:  'A lista está encerrada. Publique um benefício ativo para receber clientes.',
  };
  if (subEl) subEl.textContent = msgs[reason] || msgs.default;
}

/* ── Abre (ou reabre) a lista ao vivo ───────────────────── */
function openResultsList() {
  const liveWrap  = document.getElementById('ativados-list-wrap');
  const closedEl  = document.getElementById('res-list-closed');
  const dotEl     = document.getElementById('ativados-live-dot');

  if (liveWrap)  liveWrap.style.display  = 'block';
  if (closedEl)  closedEl.style.display  = 'none';
  if (dotEl)     dotEl.classList.remove('rd-dot-closed');
}

/* ── Polling principal ───────────────────────────────────── */
async function pollBarResults() {
  const barId = OZ.currentUser?.bar_id;
  if (!barId) return;

  const dotEl = document.getElementById('ativados-live-dot');

  try {
    if (dotEl) dotEl.classList.add('pulsing');

    // Data de hoje em BRT (UTC-3), respeitando a regra das 06h
    const todayStr = _todayStr();

    // Helper: fetch direto ao PostgREST — cache: 'no-store' garante sempre dados frescos do banco
    async function sbQuery(table, filters = {}, extra = '') {
      const hdrs = await sbHeaders({ 'Prefer': 'count=exact' });
      const qs = Object.entries(filters)
        .map(([k, v]) => `${encodeURIComponent(k)}=eq.${encodeURIComponent(v)}`)
        .join('&');
      const url = `${SB_URL}/${table}?${qs}${extra ? '&' + extra : ''}`;
      const r = await fetch(url, { headers: hdrs, cache: 'no-store' });
      if (!r.ok) throw new Error(`sbQuery ${table}: ${r.status}`);
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    }

    // Status de reserva aceitos — allowlist: só reservas confirmadas/ativas
    const RESVS_STATUS_OK = 'in.(confirmed,active,pre_activated)';

    // 1) Busca em paralelo com filtros no servidor
    const [actsRaw, promosRaw, schedsRaw, resvsRaw] = await Promise.all([
      // Ativações: filtra bar_id + benefit_date diretamente no PostgREST
      sbQuery('activations', { bar_id: barId, benefit_date: todayStr }, 'limit=500&order=created_at.desc'),
      // Promoções do bar
      sbQuery('promotions', { bar_id: barId }, 'limit=100'),
      // Benefícios agendados do bar para hoje
      sbQuery('scheduled_benefits', { bar_id: barId, date: todayStr }, 'limit=50'),
      // Reservas do bar para hoje — só status válidos direto no servidor
      sbQuery('reservations', { bar_id: barId, benefit_date: todayStr }, `status=${RESVS_STATUS_OK}&limit=500`),
    ]);

    // Revalida barId após o await — aborta se o usuário trocou de conta
    if (OZ.currentUser?.bar_id !== barId) return;

    // Allowlist de status de reserva — só confirmadas/ativas aparecem na lista
    // 'pending' / 'pending_payment' / 'cancelled' / 'failed' → excluídos
    const RESVS_OK = new Set(['confirmed', 'active', 'pre_activated']);

    // Filtro defensivo no cliente (dupla garantia além do servidor)
    const actsFiltered   = actsRaw .filter(a => a.bar_id === barId && a.benefit_date === todayStr);
    const promosFiltered = promosRaw.filter(p => p.bar_id === barId);
    const schedsFiltered = schedsRaw.filter(s => s.bar_id === barId);
    const resvsFiltered  = resvsRaw .filter(r => r.bar_id === barId && r.benefit_date === todayStr && RESVS_OK.has(r.status));

    const activePromos = promosFiltered.filter(p => isPromoActive(p));

    // Benefício agendado para hoje (ativo)
    const schedToday = schedsFiltered.find(s => s.active !== false) || null;

    // Reservas válidas (já filtradas pela allowlist acima)
    const todayReservations = resvsFiltered.filter(r =>
      r.user_id &&
      r.user_name
    );

    // Ativações do bar hoje — exclui todos os status inválidos
    const TIPOS_INTERNOS = new Set();
    const barActs = actsFiltered
      .filter(a =>
        a.status !== 'cancelled' &&
        a.status !== 'failed' &&
        a.status !== 'pending_payment' &&
        a.status !== 'pending' &&
        !TIPOS_INTERNOS.has(a.type)
      );

    const barActsDay = barActs;

    // ── Fecha a lista só se não há NADA: sem promoção, sem agendamento, sem ativações, sem reservas
    if (activePromos.length === 0 && !schedToday && barActsDay.length === 0 && todayReservations.length === 0) {
      closeResultsList('default');
      return;
    }

    openResultsList();

    // Promoção efetiva para o cabeçalho da lista
    const effectivePromos = activePromos.length > 0
      ? activePromos
      : schedToday
        ? [{
            id:          schedToday.id,
            bar_id:      barId,
            title:       schedToday.title,
            description: schedToday.description || '',
            expiry_at:   null,
            active:      true,
            _source:     'scheduled',
          }]
        : [{
            id:          `day-${todayStr}`,
            bar_id:      barId,
            title:       'Lista do dia',
            description: '',
            expiry_at:   null,
            active:      true,
            _source:     'day',
          }];

    // 3) Converte reservas de hoje em entradas no formato de activation
    //    para quem ainda NÃO tem activation própria (evita duplicata)
    //    Reservas canceladas são ignoradas — cliente saiu da lista
    const actUserIds = new Set(barActs.map(a => a.user_id).filter(Boolean));
    const RESVS_OK2 = new Set(['confirmed', 'active', 'pre_activated']);
    const reservationEntries = todayReservations
      .filter(r =>
        !actUserIds.has(r.user_id) &&
        RESVS_OK2.has(r.status)
      )
      .map(r => ({
        id:         `res-${r.id}`,
        user_id:    r.user_id,
        user_name:  r.user_name,
        bar_id:     r.bar_id,
        bar_name:   r.bar_name,
        type:       r.activation_type === 'advance_night' ? 'advance_night' : 'advance_individual',
        amount:     r.amount || 0,
        status:     r.status === 'cancelled' ? 'cancelled' : 'active',
        created_at: r.confirmed_at || r.created_at,
        _from_reservation: true,
      }));

    // 4) Mescla ativações + reservas e deduplica por user_id
    const allEntries = [...barActs, ...reservationEntries]
      .sort((a, b) => (new Date(b.created_at || 0)) - (new Date(a.created_at || 0)));

    const userMap = new Map();
    allEntries.forEach(a => {
      const key = a.user_id;
      if (!userMap.has(key)) {
        userMap.set(key, a);
      } else {
        const existing = userMap.get(key);
        // Prefere ativação real sobre reserva; entre ativas prefere a mais recente
        const existingIsRes = !!existing._from_reservation;
        const newIsRes      = !!a._from_reservation;
        if (existingIsRes && !newIsRes) {
          userMap.set(key, a); // troca reserva por ativação real
        } else if (existing.status === 'cancelled' && a.status !== 'cancelled') {
          userMap.set(key, a); // prefere ativa sobre cancelada
        }
      }
    });

    const barActsUniq = [...userMap.values()]
      .sort((a, b) => (new Date(b.created_at || 0)) - (new Date(a.created_at || 0)));

    // 5) Popula cache de nomes
    const allUserIds = [...new Set(allEntries.map(a => a.user_id).filter(Boolean))];
    allEntries.forEach(a => {
      if (a.user_id && a.user_name && a.user_name.trim()) {
        OZ.userNameCache[a.user_id] = a.user_name.trim();
      }
    });
    const stillMissing = allUserIds.filter(id => !OZ.userNameCache[id]);
    if (stillMissing.length) await resolveUserNames(stillMissing);

    // 6) Detecta novas entradas
    const prevIds = new Set(OZ._lastActsSnapshot.map(a => a.id));
    const newActs = barActsUniq.filter(a => a.id && !prevIds.has(a.id));
    OZ._lastActsSnapshot = barActsUniq;

    // 7) Renderiza
    renderResultsPromo(barActsUniq, effectivePromos);

    // 8) Toast para novas ativações
    if (newActs.length > 0 && OZ._lastPollAt > 0) {
      const names = newActs.slice(0, 2).map(a => a.user_name || OZ.userNameCache[a.user_id] || 'Cliente');
      const extra = newActs.length > 2 ? ` +${newActs.length - 2}` : '';
      const firstType = newActs[0]?.type;
      const icon = (firstType === 'night_link' || firstType === 'night' || firstType === 'night_checkin') ? '🌙' : '🎯';
      const verb = (firstType === 'night_checkin') ? 'chegou agora!' : 'ativou agora!';
      showToast(`${icon} ${names.join(', ')}${extra} ${verb}`, 'success');
    }

    OZ._lastPollAt = Date.now();
  } catch (e) {
    console.warn('[pollBarResults]', e);
  } finally {
    if (dotEl) dotEl.classList.remove('pulsing');
  }
}

/* ══════════════════════════════════════════════════════════
   CANCELAMENTO DE ATIVAÇÃO PELO BAR
   O bar pode cancelar a entrada de um cliente:
   1. Marca a ativação como status='cancelled'
   2. Cria um free_credit para o cliente (compensação)
   3. O cliente some da lista imediatamente
   4. O cliente pode usar o crédito para se reativar
══════════════════════════════════════════════════════════ */
async function cancelBarActivation(actId, userId, userName, btn) {
  // Confirmação inline no botão
  if (!btn._confirming) {
    btn._confirming = true;
    btn.title = 'Clique novamente para confirmar cancelamento';
    btn.classList.add('rd-cancel-btn-confirm');
    btn.innerHTML = '<i class="fa fa-triangle-exclamation"></i>';
    // Reverte se não confirmar em 4s
    setTimeout(() => {
      if (btn._confirming) {
        btn._confirming = false;
        btn.classList.remove('rd-cancel-btn-confirm');
        btn.innerHTML = '<i class="fa fa-xmark"></i>';
        btn.title = 'Cancelar entrada e devolver crédito ao cliente';
      }
    }, 4000);
    return;
  }

  // Segunda confirmação — executa
  btn._confirming = false;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i>';

  try {
    // ── EDGE FUNCTION: cancelar-ativacao (cancela + cria free_credit no servidor) ──
    // O servidor valida que a ativação pertence ao bar autenticado
    // e cria o free_credit de compensação com amount=0 fixo.
    await edgeFn('cancelar-ativacao', {
      activation_id: actId,
      user_id:       userId,
      user_name:     userName,
    });

    // 3) Atualiza visual do item na lista sem aguardar o próximo poll
    const li = btn.closest('li');
    if (li) {
      li.classList.add('rd-act-cancelled');
      li.classList.remove('rd-act-new');
      const avatarEl  = li.querySelector('.rd-act-avatar');
      const nameEl    = li.querySelector('.rd-act-name');
      const timeEl    = li.querySelector('.rd-act-time');
      const newDotEl  = li.querySelector('.rd-act-new-dot');
      if (avatarEl) avatarEl.classList.add('rd-act-avatar-cancelled');
      if (nameEl)   nameEl.classList.add('rd-act-name-cancelled');
      if (timeEl) {
        // Substitui badge pelo de cancelado
        timeEl.querySelectorAll('.rd-type-badge').forEach(b => b.remove());
        timeEl.insertAdjacentHTML('beforeend',
          `<span class="rd-type-badge rd-type-cancelled">✕ Cancelado</span>`);
      }
      if (newDotEl) newDotEl.remove();
      // Adiciona hint de crédito devolvido
      const info = li.querySelector('.rd-act-info');
      if (info && !info.querySelector('.rd-act-refund-hint')) {
        const hint = document.createElement('span');
        hint.className = 'rd-act-refund-hint';
        hint.textContent = 'Crédito grátis devolvido ao cliente';
        info.appendChild(hint);
      }
      btn.remove(); // remove o botão cancelar
    }

    showToast(`✅ Entrada de ${userName} cancelada. Crédito devolvido.`, 'success');

  } catch(e) {
    showToast('Erro ao cancelar. Tente novamente.', 'error');
    btn.disabled = false;
    btn.innerHTML = '<i class="fa fa-xmark"></i>';
  }
}

/* Inicia o poller (intervalo de 3 s enquanto lista aberta, fallback 10 s) */
function startResultsPoller() {
  stopResultsPoller();
  // Primeira carga imediata
  pollBarResults();
  // 3 s: garante que uma nova ativação aparece na lista em até 3 s
  OZ.resultsPoller = setInterval(pollBarResults, 3_000);
}

/* Para o poller */
function stopResultsPoller() {
  if (OZ.resultsPoller) {
    clearInterval(OZ.resultsPoller);
    OZ.resultsPoller = null;
  }
}

/* ── Busca global (legado — cada pasta tem seu próprio campo) ── */
function filterResultsLive() {}
function clearResultsSearch() {}

/* ══════════════════════════════════════════════════════════
   BAR — ABA "ATIVADOS DO DIA"
   Mostra clientes que ativaram qualquer benefício do bar hoje.
   Fontes: tables/activations + tables/reservations (hoje).
   Atualiza a cada 5 s enquanto a aba estiver aberta.
══════════════════════════════════════════════════════════ */

OZ.ativadosPoller = null;

function startAtivadosPoller() {
  stopAtivadosPoller();
  pollAtivados();
  OZ.ativadosPoller = setInterval(pollAtivados, 5_000);
}

function stopAtivadosPoller() {
  if (OZ.ativadosPoller) {
    clearInterval(OZ.ativadosPoller);
    OZ.ativadosPoller = null;
  }
}

async function pollAtivados() {
  // Captura barId no início — será revalidado após cada await
  const barId = OZ.currentUser?.bar_id;
  if (!barId) return;

  const dotEl = document.getElementById('ativados-live-dot');
  if (dotEl) dotEl.classList.add('pulsing');

  try {
    const todayStr = _todayStr();

    // Helper: fetch direto ao PostgREST — cache: 'no-store' garante sempre dados frescos do banco
    async function sbQuery(table, filters = {}, extra = '') {
      const hdrs = await sbHeaders({ 'Prefer': 'count=exact' });
      const qs = Object.entries(filters)
        .map(([k, v]) => `${encodeURIComponent(k)}=eq.${encodeURIComponent(v)}`)
        .join('&');
      const url = `${SB_URL}/${table}?${qs}${extra ? '&' + extra : ''}`;
      const r = await fetch(url, { headers: hdrs, cache: 'no-store' });
      if (!r.ok) throw new Error(`sbQuery ${table}: ${r.status}`);
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    }

    // Status de reserva aceitos na lista — allowlist: só reservas confirmadas/ativas
    // 'pending'         → aguardando confirmação → fora
    // 'pending_payment' → aguardando pagamento   → fora
    // 'cancelled'       → cancelada              → fora
    // 'failed'          → falha                  → fora
    const RESVS_STATUS_OK = 'in.(confirmed,active,pre_activated)';

    // Tipos de benefício antecipado — exigem pagamento confirmado (status = 'active')
    const ADVANCE_TYPES = new Set(['advance_individual', 'advance_night', 'advance_free']);

    // Busca em paralelo — sem filtros de status/type no servidor
    // (PostgREST desta instância não suporta not.in/in nos query params)
    // Filtragem por status e type é feita 100% no cliente abaixo.
    const [actsRaw, resvsRaw] = await Promise.all([
      sbQuery('activations', { bar_id: barId, benefit_date: todayStr },
        'limit=500&order=created_at.desc'),
      sbQuery('reservations', { bar_id: barId, benefit_date: todayStr },
        'limit=500'),
    ]);

    // Revalida barId após o await — aborta se o usuário trocou de conta durante o fetch
    if (OZ.currentUser?.bar_id !== barId) return;

    // Filtro defensivo no cliente (dupla garantia além do servidor):
    // Filtragem 100% no cliente — dupla garantia de status e tipo
    const RESVS_OK = new Set(['confirmed', 'active', 'pre_activated']);
    const BLOCKED_STATUS = new Set(['cancelled', 'failed', 'pending_payment', 'pending']);

    // Ativações normais: não-antecipadas + status não-bloqueado
    const actsNormalFiltered = actsRaw.filter(a =>
      a.bar_id === barId &&
      a.benefit_date === todayStr &&
      !ADVANCE_TYPES.has(a.type) &&
      !BLOCKED_STATUS.has(a.status)
    );

    // Ativações antecipadas: status === 'active' obrigatório (pagamento confirmado)
    const actsAdvanceFiltered = actsRaw.filter(a =>
      a.bar_id === barId &&
      a.benefit_date === todayStr &&
      ADVANCE_TYPES.has(a.type) &&
      a.status === 'active'
    );

    const actsFiltered  = [...actsNormalFiltered, ...actsAdvanceFiltered];
    const resvsFiltered = resvsRaw.filter(r =>
      r.bar_id === barId &&
      r.benefit_date === todayStr &&
      RESVS_OK.has(r.status)
    );

    // Tipos internos que não devem aparecer na lista
    const TIPOS_INTERNOS = new Set();

    // Mescla de ativações já filtradas por tipo + status
    const barActs = actsFiltered.filter(a => !TIPOS_INTERNOS.has(a.type));

    const actUserIds = new Set(barActs.map(a => a.user_id).filter(Boolean));
    const todayReservations = resvsFiltered
      .filter(r =>
        RESVS_OK.has(r.status) &&
        r.user_id &&
        r.user_name &&
        !actUserIds.has(r.user_id)
      )
      .map(r => ({
        id:         `res-${r.id}`,
        user_id:    r.user_id,
        user_name:  r.user_name,
        bar_id:     r.bar_id,
        type:       r.activation_type === 'advance_night' ? 'advance_night' : 'advance_individual',
        amount:     r.amount || 0,
        status:     'active',
        created_at: r.confirmed_at || r.created_at,
        _from_reservation: true,
      }));

    // Mescla e deduplica por user_id
    const allEntries = [...barActs, ...todayReservations]
      .sort((a, b) => (new Date(b.created_at || 0)) - (new Date(a.created_at || 0)));

    const userMap = new Map();
    allEntries.forEach(a => {
      const key = a.user_id;
      if (!userMap.has(key)) {
        userMap.set(key, a);
      } else {
        const cur = userMap.get(key);
        if ((cur._from_reservation && !a._from_reservation) ||
            (cur.status === 'cancelled' && a.status !== 'cancelled')) {
          userMap.set(key, a);
        }
      }
    });

    const entries = [...userMap.values()]
      .sort((a, b) => (new Date(b.created_at || 0)) - (new Date(a.created_at || 0)));

    // Popula cache de nomes
    entries.forEach(a => {
      if (a.user_id && a.user_name) OZ.userNameCache[a.user_id] = a.user_name;
    });

    _renderAtivados(entries, todayStr);

    // Atualiza badge na aba
    const activeCount = entries.filter(e => e.status !== 'cancelled').length;
    const badge = document.getElementById('btab-ativados-badge');
    if (badge) {
      badge.textContent   = activeCount;
      badge.style.display = activeCount > 0 ? 'inline-flex' : 'none';
    }

  } catch (e) {
    console.warn('[pollAtivados]', e);
  } finally {
    if (dotEl) dotEl.classList.remove('pulsing');
  }
}

function _renderAtivados(entries, todayStr) {
  const container = document.getElementById('ativados-groups-container');
  const emptyEl   = document.getElementById('ativados-empty');
  if (!container) return;

  if (!entries.length) {
    container.innerHTML    = '';
    if (emptyEl) emptyEl.style.display = 'flex';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  // Preserva busca existente
  const prevInput = container.querySelector('.rp-search-input');
  const savedQ    = prevInput?.value || '';

  container.innerHTML = '';

  // Cabeçalho
  const [y, m, d] = todayStr.split('-').map(Number);
  const dateLabel = new Date(y, m - 1, d)
    .toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  const headerEl = document.createElement('div');
  headerEl.className = 'rp-event-header';
  headerEl.innerHTML = `
    <div class="rp-event-info">
      <span class="rp-event-badge"><span class="rp-event-dot"></span>Ao vivo</span>
      <strong class="rp-event-title">Ativados de hoje</strong>
      <span class="rp-event-desc">${dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1)}</span>
    </div>`;
  container.appendChild(headerEl);

  // Campo de busca
  const searchWrap = document.createElement('div');
  searchWrap.className = 'rd-day-search-wrap';
  searchWrap.innerHTML = `
    <i class="fa fa-search rd-day-search-icon"></i>
    <input type="text" class="rp-search-input rd-day-search-input"
      placeholder="Buscar cliente..."
      autocomplete="off"
      value="${savedQ.replace(/"/g,'&quot;')}"/>
    <button class="rd-day-search-clear" style="display:${savedQ ? 'flex' : 'none'}">
      <i class="fa fa-times"></i>
    </button>`;
  container.appendChild(searchWrap);

  // Corpo da lista
  const bodyEl = document.createElement('div');
  bodyEl.className = 'rp-list-body';
  container.appendChild(bodyEl);

  _renderAtivadosList(bodyEl, entries, savedQ);

  // Eventos de busca
  const inp      = searchWrap.querySelector('.rp-search-input');
  const clearBtn = searchWrap.querySelector('.rd-day-search-clear');
  inp.addEventListener('input', () => {
    clearBtn.style.display = inp.value ? 'flex' : 'none';
    _renderAtivadosList(bodyEl, entries, inp.value);
  });
  clearBtn.addEventListener('click', e => {
    e.stopPropagation();
    inp.value = '';
    clearBtn.style.display = 'none';
    inp.focus();
    _renderAtivadosList(bodyEl, entries, '');
  });
  searchWrap.addEventListener('click', e => e.stopPropagation());
}

function _renderAtivadosList(bodyEl, entries, query) {
  bodyEl.innerHTML = '';
  const q = (query || '').toLowerCase().trim();
  const filtered = q
    ? entries.filter(a => (a.user_name || OZ.userNameCache[a.user_id] || '').toLowerCase().includes(q))
    : entries;

  if (!filtered.length) {
    bodyEl.innerHTML = `<div class="rd-day-no-result"><i class="fa fa-search"></i> Nenhum cliente encontrado</div>`;
    return;
  }

  const activeCount = filtered.filter(a => a.status !== 'cancelled').length;
  const totalCount  = filtered.length;
  const counterEl   = document.createElement('div');
  counterEl.className = 'rp-list-counter';
  counterEl.innerHTML = `<span>${activeCount} na lista${
    totalCount !== activeCount
      ? ` <span class="rp-counter-muted">(${totalCount - activeCount} cancelado${totalCount - activeCount > 1 ? 's' : ''})</span>`
      : ''
  }</span>`;
  bodyEl.appendChild(counterEl);

  const listEl = document.createElement('ul');
  listEl.className = 'rd-act-list';

  filtered.forEach((act, idx) => {
    const name        = act.user_name || OZ.userNameCache[act.user_id] || `#${(act.user_id||'').slice(0,8)}`;
    const isCancelled = act.status === 'cancelled';
    const isNew       = isNewAct(act.created_at);

    const isNight   = (act.type === 'night_link' || act.type === 'night' || act.type === 'night_checkin' || act.type === 'advance_night');
    const isFree    = (act.type === 'free_used'  || act.type === 'advance_free');
    const isAdvance = (act.type === 'advance_individual' || act.type === 'advance_night' || act.type === 'advance_free');
    const isCheckin = (act.type === 'night_checkin');

    const typeBadge = isNight
      ? `<span class="rd-type-badge rd-type-night">🌙 ${isCheckin ? 'Link da Noite' : 'Noite Toda'}${isAdvance ? ' · Antecipado' : ''}</span>`
      : isFree
        ? `<span class="rd-type-badge rd-type-free">🎁 Grátis${isAdvance ? ' · Antecipado' : ''}</span>`
        : `<span class="rd-type-badge rd-type-individual">🎯 Unitário${isAdvance ? ' · Antecipado' : ''}</span>`;

    const timeStr = fmtTime(act.created_at);
    const li = document.createElement('li');
    li.className = `rd-act-item rp-act-item${isNew ? ' rd-act-new' : ''}${isCancelled ? ' rp-act-cancelled' : ''}`;
    li.setAttribute('data-act-id', act.id || '');
    li.innerHTML = `
      <span class="rp-pos-num${isCancelled ? ' rp-pos-cancelled' : ''}">${String(idx + 1).padStart(2,'0')}</span>
      <div class="rd-act-avatar${isCancelled ? ' rp-avatar-cancelled' : ''}">${(name[0]||'?').toUpperCase()}</div>
      <div class="rd-act-info">
        <span class="rd-act-name${isCancelled ? ' rp-name-cancelled' : ''}">${name}</span>
        <span class="rd-act-time"><i class="fa fa-clock"></i> ${timeStr} ${typeBadge}</span>
      </div>
      ${isNew && !isCancelled ? '<span class="rd-act-new-dot"></span>' : ''}`;
    listEl.appendChild(li);
  });

  bodyEl.appendChild(listEl);
}

/* ── loadBarResults (chamado pelo loadBarPanel legado) ───── */
function loadBarResults(acts) {
  // Apenas atualiza KPIs com dados já carregados pelo loadBarPanel
  const realActs = acts.filter(a => a.type !== 'free_credit' && a.type !== 'free_credit_used');
  const el1 = document.getElementById('res-total-acts');
  const el2 = document.getElementById('res-total-visitors');
  if (el1) el1.textContent = realActs.length;
  if (el2) el2.textContent = [...new Set(realActs.map(a => a.user_id))].length;
  // A lista detalhada é gerenciada pelo poller
}

/* ─ Alterna abas internas do card de ativações ─ */
function switchBpdInnerTab(tab) {
  ['7dias', 'distrib'].forEach(t => {
    const btn = document.getElementById('bpit-' + t);
    const panel = document.getElementById('bpit-panel-' + t);
    if (btn)   btn.classList.toggle('active',   t === tab);
    if (panel) panel.classList.toggle('active', t === tab);
  });
}

/* ─ Expande/colapsa card de ativações recentes ─ */
function toggleBpdRecentActs() {
  const full     = document.getElementById('bpd-recent-full');
  const preview  = document.getElementById('bpd-recent-preview');
  const chevron  = document.getElementById('bpd-recent-chevron');
  const lbl      = document.getElementById('bpd-recent-toggle-lbl');
  if (!full) return;
  const isOpen = full.style.display !== 'none';
  if (isOpen) {
    full.style.display = 'none';
    if (preview) preview.style.display = '';
    if (chevron) chevron.classList.remove('open');
    if (lbl)    lbl.textContent = 'Ver tudo';
  } else {
    full.style.display = 'block';
    if (preview) preview.style.display = 'none';
    if (chevron) chevron.classList.add('open');
    if (lbl)    lbl.textContent = 'Recolher';
  }
}

function switchBarTab(tab) {
  /* 'info' abre a tela de edição de perfil (bar-perfil), acessível via Conta */
  if (tab === 'info') {
    switchTab('bar-perfil');
    return;
  }
  /* 'promocoes' agora é a tela própria bar-beneficios */
  if (tab === 'promocoes') {
    switchTab('bar-beneficios');
    updateBarNav('beneficios');
    return;
  }
  /* 'fas' foi movido para a tela Conta */
  if (tab === 'fas') {
    switchTab('bar-profile');
    updateBarNav('profile');
    return;
  }
  /* 'explorar' agora é tela própria na nav de rodapé */
  if (tab === 'explorar') {
    switchTab('bar-explorar');
    updateBarNav('explorar');
    return;
  }
  /* Fecha feed se estava no explorar e está saindo */
  if (window.OZFeed) OZFeed.close();
  const tabs = ['painel', 'info', 'promocoes', 'ativados', 'explorar', 'comentarios'];
  // Atualiza botões (suporta .bex-tab e legado .tab-btn)
  tabs.forEach(t => {
    const btn = document.getElementById(`btab-${t}`);
    if (btn) btn.classList.toggle('active', t === tab);
  });
  document.querySelectorAll('.tab-btn').forEach((b, i) => {
    b.classList.toggle('active', tabs[i] === tab);
  });
  // Troca painel visível
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  const el = document.getElementById(`bar-tab-${tab}`);
  if (el) el.classList.add('active');

  // Gerencia pollers por aba
  if (tab === 'ativados') {
    stopExplorePoller();
    startAtivadosPoller();
  } else if (tab === 'explorar') {
    stopAtivadosPoller();
    loadBarExplore();
  } else if (tab === 'fas') {
    stopAtivadosPoller();
    stopExplorePoller();
    loadBarLikes();
  } else if (tab === 'comentarios') {
    stopAtivadosPoller();
    stopExplorePoller();
    loadBarComments();
  } else {
    stopAtivadosPoller();
    stopExplorePoller();
  }
}

/* ══════════════════════════════════════════════════════════
   BAR — ABA EXPLORAR (visão em tempo real da plataforma)
══════════════════════════════════════════════════════════ */

OZ._exploreAllBars   = [];
OZ._exploreAllPromos = {};
OZ.explorePoller     = null;

/* ── Helpers: data de hoje para comparação ───────────────── */
function _todayStr() {
  const now = new Date();
  // Regra: antes das 06h pertence à noite anterior
  if (now.getHours() < 6) now.setDate(now.getDate() - 1);
  return localDateStr(now);
}

/* ── Poll principal: busca promoções ao vivo + agendados para hoje ── */
async function pollBarExplore() {
  const dotEl   = document.getElementById('explore-live-dot');
  const listEl  = document.getElementById('explore-bars-list');
  const emptyEl = document.getElementById('explore-empty');
  if (!listEl) return;

  if (dotEl) dotEl.classList.add('pulsing');

  try {
    const todayStr = _todayStr();

    const [promosRes, schedRes, barsRes] = await Promise.all([
      apiGet('tables/promotions?limit=200'),
      apiGet('tables/scheduled_benefits?limit=200'),
      apiGet('tables/bars?limit=200'),
    ]);

    const rawPromos = promosRes.data || [];
    const rawScheds = schedRes.data  || [];
    const rawBars   = barsRes.data   || [];

    // Mapa bar_id → bar
    const barsMap = {};
    rawBars.forEach(b => { barsMap[b.id] = b; });

    // Monta mapa bar_id → benefício (promoções ao vivo têm prioridade)
    const promoMap = {}; // bar_id → { benefit, source: 'live'|'scheduled', promo }

    // 1) Promoções ao vivo (tables/promotions)
    rawPromos.forEach(p => {
      if (!isPromoActive(p)) return;
      if (!promoMap[p.bar_id]) promoMap[p.bar_id] = [];
      promoMap[p.bar_id].push({ ...p, _source: 'live' });
    });

    // 2) Benefícios agendados para hoje (tables/scheduled_benefits)
    rawScheds.forEach(s => {
      if (s.active === false) return;
      if (s.date !== todayStr) return;
      const barId = s.bar_id;
      if (!barId) return;
      // Adiciona ao promoMap mesmo que não tenha live (cria array se necessário)
      if (!promoMap[barId]) promoMap[barId] = [];
      // Evita duplicata se já veio da live
      const alreadyLive = promoMap[barId].some(p => p._source === 'live');
      if (!alreadyLive) {
        promoMap[barId].push({
          id:           s.id,
          bar_id:       barId,
          title:        s.title,
          description:  s.description,
          event:        s.event || '',
          max_activations: s.max_activations || 0,
          activations_count: s.activations_count || 0,
          active:       true,
          _source:      'scheduled',
          _schedDate:   s.date,
        });
      }
    });

    // Bares com benefício (ao vivo ou agendado para hoje)
    const activeBars = Object.keys(promoMap)
      .filter(id => barsMap[id] && barsMap[id].active !== false)
      .map(id => barsMap[id]);

    // Salva cache
    OZ._exploreAllBars   = activeBars;
    OZ._exploreAllPromos = promoMap;

    // Atualiza contador
    const elCount  = document.getElementById('explore-total-bars');
    const elPlural = document.getElementById('explore-bars-plural');
    if (elCount)  elCount.textContent  = activeBars.length;
    if (elPlural) elPlural.textContent = activeBars.length === 1 ? '' : 'es';

    // Renderiza (preservando filtro de busca ativo)
    const q = document.getElementById('explore-search')?.value || '';
    const toRender = q
      ? activeBars.filter(b =>
          (b.name || '').toLowerCase().includes(q.toLowerCase()) ||
          (b.neighborhood || '').toLowerCase().includes(q.toLowerCase())
        )
      : activeBars;

    renderBarExploreCards(toRender, promoMap);

  } catch(e) {
    console.warn('[pollBarExplore]', e);
  } finally {
    if (dotEl) dotEl.classList.remove('pulsing');
  }
}

function startExplorePoller() {
  stopExplorePoller();
  pollBarExplore();                                       // carga imediata
  OZ.explorePoller = setInterval(pollBarExplore, 15_000); // atualiza a cada 15 s
}

function stopExplorePoller() {
  if (OZ.explorePoller) {
    clearInterval(OZ.explorePoller);
    OZ.explorePoller = null;
  }
}

/* ── Carregamento inicial (mostra skeleton na 1ª vez) ─────── */
async function loadBarExplore() {
  const listEl  = document.getElementById('explore-bars-list');
  const emptyEl = document.getElementById('explore-empty');
  if (!listEl) return;

  // Skeleton apenas se ainda não há dados no cache
  if (!OZ._exploreAllBars.length) {
    listEl.innerHTML = `
      <div class="bex-explore-skeleton">
        ${[1,2,3].map(() => `
          <div class="bex-explore-sk-card">
            <div class="bex-explore-sk-img"></div>
            <div class="bex-explore-sk-body">
              <div class="bex-explore-sk-line bex-explore-sk-title"></div>
              <div class="bex-explore-sk-line bex-explore-sk-sub"></div>
              <div class="bex-explore-sk-line bex-explore-sk-benefit"></div>
            </div>
          </div>`).join('')}
      </div>`;
    emptyEl.style.display = 'none';
  }

  startExplorePoller();
}

/* ── Renderiza os cards — estilo cinema (explorar do bar) ─── */
function renderBarExploreCards(bars, promoMap) {
  const listEl  = document.getElementById('explore-bars-list');
  const emptyEl = document.getElementById('explore-empty');
  if (!listEl) return;

  listEl.innerHTML = '';

  if (!bars.length) {
    emptyEl.style.display = 'flex';
    return;
  }
  emptyEl.style.display = 'none';

  const myBarId = OZ.currentUser?.bar_id;

  // Lista única: live + agendados de hoje juntos
  const liveCount  = bars.filter(b => (promoMap[b.id]||[])[0]?._source !== 'scheduled').length;
  const schedCount = bars.length - liveCount;
  const sectionLabel = liveCount && schedCount
    ? `Ativo hoje · ${liveCount} ao vivo, ${schedCount} agendado${schedCount>1?'s':''}`
    : liveCount ? 'Benefício ativo agora' : 'Agendado para hoje';

  listEl.innerHTML = `
    <div class="cine-section-header">
      <span class="cine-section-title"><i class="fa fa-bolt"></i> ${sectionLabel}</span>
      <span class="cine-section-count">${bars.length}</span>
    </div>
    <div class="cine-cards-list" id="cine-explore-all-list"></div>`;

  const renderGroup = (groupBars, containerId) => {
    const container = document.getElementById(containerId);
    if (!container) return;
    groupBars.forEach(bar => {
      const barPromos   = promoMap[bar.id] || [];
      const promoAtiva  = barPromos[0];
      const isScheduled = promoAtiva?._source === 'scheduled';
      const benefitText = promoAtiva?.title || bar.benefit || 'Benefício especial';
      const benefitDesc = promoAtiva?.description || '';
      const eventText   = promoAtiva?.event || promoAtiva?.event_tonight || bar.event_tonight || '';
      const genreLabel  = genreMap[bar.genre || bar.bar_genre] || '';
      const isOwn       = bar.id === myBarId;
      const imgSrc      = bar.cover_url || bar.photo_url || DEF_IMG;
      const actCount    = bar.total_activations || 0;

      let slotsHtml = '';
      if (promoAtiva?.max_activations > 0) {
        const rem = promoAtiva.max_activations - (promoAtiva.activations_count || 0);
        slotsHtml = `<span class="cine-meta-item cine-slots"><i class="fa fa-users"></i> ${Math.max(0,rem)} vagas</span>`;
      }

      const badge = isOwn
        ? '<span class="cine-own-badge"><i class="fa fa-store"></i> Seu bar</span>'
        : isScheduled
          ? '<span class="cine-live-badge cine-live-badge-sched"><i class="fa fa-calendar-day"></i> HOJE</span>'
          : '<span class="cine-live-badge"><i class="fa fa-bolt"></i> AO VIVO</span>';

      const card = document.createElement('div');
      card.className = `cine-card${isOwn ? ' cine-card-own' : ''}${isScheduled ? ' cine-card-sched' : ''}`;
      card.innerHTML = `
        <div class="cine-card-img-wrap">
          <img class="cine-card-img" src="${imgSrc}" alt="${bar.name}" loading="lazy" onerror="this.src='${DEF_IMG}'"/>
          <div class="cine-card-img-overlay"></div>
          ${badge}
          ${genreLabel ? `<span class="cine-genre-badge">${genreLabel}</span>` : ''}
        </div>
        <div class="cine-card-body">
          <p class="cine-card-studio">OZ · ${isOwn ? 'Seu bar na plataforma' : isScheduled ? 'Benefício do dia' : 'Benefício exclusivo'}</p>
          <h3 class="cine-card-title">${bar.name}</h3>
          <div class="cine-card-meta">
            <span class="cine-meta-item"><i class="fa fa-map-marker-alt"></i> ${bar.neighborhood || '—'}</span>
            <span class="cine-meta-dot">·</span>
            <span class="cine-meta-item"><i class="fa fa-bolt"></i> ${actCount} ativações</span>
            ${eventText ? `<span class="cine-meta-dot">·</span><span class="cine-meta-item cine-meta-music"><i class="fa fa-music"></i> Ao vivo</span>` : ''}
            ${slotsHtml ? `<span class="cine-meta-dot">·</span>${slotsHtml}` : ''}
          </div>
          <div class="cine-benefit-inline-card${isScheduled ? ' cine-benefit-inline-sched' : ''}">
            <i class="fa fa-gift"></i>
            <div class="cine-benefit-inline-body">
              <span class="cine-benefit-inline-title">${benefitText}</span>
              ${benefitDesc ? `<span class="cine-benefit-inline-desc">${benefitDesc}</span>` : ''}
              ${eventText ? `<span class="cine-benefit-inline-desc"><i class="fa fa-music"></i> ${eventText}</span>` : ''}
            </div>
            <span class="cine-benefit-inline-dot"></span>
          </div>
          <button class="cine-btn-activate${isScheduled ? ' cine-btn-activate-sched' : ''}">
            <i class="fa fa-eye"></i> Ver detalhes
          </button>
        </div>`;
      card.style.cursor = 'pointer';
      card.querySelector('.cine-btn-activate').addEventListener('click', (e) => { e.stopPropagation(); openBarDetailReadOnly(bar); });
      card.addEventListener('click', () => openBarDetailReadOnly(bar));
      container.appendChild(card);
    });
  };

  // Renderiza todos em lista única (live primeiro, depois agendados)
  const allSorted = [
    ...bars.filter(b => (promoMap[b.id]||[])[0]?._source !== 'scheduled'),
    ...bars.filter(b => (promoMap[b.id]||[])[0]?._source === 'scheduled'),
  ];
  renderGroup(allSorted, 'cine-explore-all-list');
}

/* ── Busca ao vivo ───────────────────────────────────────── */
function filterBarExplore() {
  const q       = (document.getElementById('explore-search')?.value || '').toLowerCase().trim();
  const clearBtn= document.getElementById('explore-search-clear');
  if (clearBtn) clearBtn.style.display = q ? 'flex' : 'none';

  const filtered = q
    ? OZ._exploreAllBars.filter(b =>
        (b.name || '').toLowerCase().includes(q) ||
        (b.neighborhood || '').toLowerCase().includes(q) ||
        (b.genre || '').toLowerCase().includes(q)
      )
    : OZ._exploreAllBars;

  renderBarExploreCards(filtered, OZ._exploreAllPromos);
}

function clearBarExploreSearch() {
  const inp = document.getElementById('explore-search');
  if (inp) { inp.value = ''; inp.focus(); }
  const clearBtn = document.getElementById('explore-search-clear');
  if (clearBtn) clearBtn.style.display = 'none';
  renderBarExploreCards(OZ._exploreAllBars, OZ._exploreAllPromos);
}

/* ══════════════════════════════════════════════════════════
   PROMOTER — ABA EXPLORAR (visão da plataforma com ativação)
══════════════════════════════════════════════════════════ */

OZ._prxExploreBars   = [];
OZ._prxExplorePromos = {};
OZ.prxExplorePoller  = null;

/* ── Poll principal (promoter) — ao vivo + agendados para hoje ── */
async function pollPromoterExplore() {
  const dotEl   = document.getElementById('prx-explore-live-dot');
  const listEl  = document.getElementById('prx-explore-bars-list');
  const emptyEl = document.getElementById('prx-explore-empty');
  if (!listEl) return;

  if (dotEl) dotEl.classList.add('pulsing');

  try {
    const todayStr = _todayStr();

    const [promosRes, schedRes, barsRes] = await Promise.all([
      apiGet('tables/promotions?limit=200'),
      apiGet('tables/scheduled_benefits?limit=200'),
      apiGet('tables/bars?limit=200'),
    ]);

    const rawPromos = promosRes.data || [];
    const rawScheds = schedRes.data  || [];
    const rawBars   = barsRes.data   || [];

    // Mapa bar_id → bar
    const barsMap = {};
    rawBars.forEach(b => { barsMap[b.id] = b; });

    // Monta mapa bar_id → benefícios (ao vivo + agendados para hoje)
    const promoMap = {};

    // 1) Promoções ao vivo
    rawPromos.forEach(p => {
      if (!isPromoActive(p)) return;
      if (!promoMap[p.bar_id]) promoMap[p.bar_id] = [];
      promoMap[p.bar_id].push({ ...p, _source: 'live' });
    });

    // 2) Benefícios agendados para hoje
    rawScheds.forEach(s => {
      if (s.active === false) return;
      if (s.date !== todayStr) return;
      const barId = s.bar_id;
      if (!barId) return;
      if (!promoMap[barId]) promoMap[barId] = [];
      const alreadyLive = promoMap[barId].some(p => p._source === 'live');
      if (!alreadyLive) {
        promoMap[barId].push({
          id:           s.id,
          bar_id:       barId,
          title:        s.title,
          description:  s.description,
          event:        s.event || '',
          max_activations: s.max_activations || 0,
          activations_count: s.activations_count || 0,
          active:       true,
          _source:      'scheduled',
          _schedDate:   s.date,
        });
      }
    });

    // Bares com benefício
    const barsMap2 = {};
    rawBars.forEach(b => { barsMap2[b.id] = b; });
    const activeBars = Object.keys(promoMap)
      .filter(id => barsMap2[id] && barsMap2[id].active !== false)
      .map(id => barsMap2[id]);

    // Salva cache
    OZ._prxExploreBars   = activeBars;
    OZ._prxExplorePromos = promoMap;

    // Atualiza contador
    const elCount  = document.getElementById('prx-explore-total-bars');
    const elPlural = document.getElementById('prx-explore-bars-plural');
    if (elCount)  elCount.textContent  = activeBars.length;
    if (elPlural) elPlural.textContent = activeBars.length === 1 ? '' : 'es';

    // Renderiza preservando filtro de busca ativo
    const q = document.getElementById('prx-explore-search')?.value || '';
    const toRender = q
      ? activeBars.filter(b =>
          (b.name || '').toLowerCase().includes(q.toLowerCase()) ||
          (b.neighborhood || '').toLowerCase().includes(q.toLowerCase())
        )
      : activeBars;

    renderPromoterExploreCards(toRender, promoMap);

  } catch(e) {
    console.warn('[pollPromoterExplore]', e);
  } finally {
    if (dotEl) dotEl.classList.remove('pulsing');
  }
}

function startPromoterExplorePoller() {
  stopPromoterExplorePoller();
  pollPromoterExplore();
  OZ.prxExplorePoller = setInterval(pollPromoterExplore, 15_000);
}

function stopPromoterExplorePoller() {
  if (OZ.prxExplorePoller) {
    clearInterval(OZ.prxExplorePoller);
    OZ.prxExplorePoller = null;
  }
}

/* ── Carregamento inicial (skeleton na 1ª vez) ───────────── */
async function loadPromoterExplore() {
  const listEl  = document.getElementById('prx-explore-bars-list');
  const emptyEl = document.getElementById('prx-explore-empty');
  if (!listEl) return;

  if (!OZ._prxExploreBars.length) {
    listEl.innerHTML = `
      <div class="bex-explore-skeleton">
        ${[1,2,3].map(() => `
          <div class="bex-explore-sk-card">
            <div class="bex-explore-sk-img"></div>
            <div class="bex-explore-sk-body">
              <div class="bex-explore-sk-line bex-explore-sk-title"></div>
              <div class="bex-explore-sk-line bex-explore-sk-sub"></div>
              <div class="bex-explore-sk-line bex-explore-sk-benefit"></div>
            </div>
          </div>`).join('')}
      </div>`;
    if (emptyEl) emptyEl.style.display = 'none';
  }

  startPromoterExplorePoller();
}

/* ── Renderiza cards — explorar do promoter (com botão ativar) ── */
function renderPromoterExploreCards(bars, promoMap) {
  const listEl  = document.getElementById('prx-explore-bars-list');
  const emptyEl = document.getElementById('prx-explore-empty');
  if (!listEl) return;

  listEl.innerHTML = '';

  if (!bars.length) {
    if (emptyEl) emptyEl.style.display = 'flex';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  // Lista única: live primeiro, depois agendados
  const liveCountP  = bars.filter(b => (promoMap[b.id]||[])[0]?._source !== 'scheduled').length;
  const schedCountP = bars.length - liveCountP;
  const sectionLabelP = liveCountP && schedCountP
    ? `Ativo hoje · ${liveCountP} ao vivo, ${schedCountP} agendado${schedCountP>1?'s':''}`
    : liveCountP ? 'Benefício ativo agora' : 'Agendado para hoje';

  listEl.innerHTML = `
    <div class="cine-section-header">
      <span class="cine-section-title"><i class="fa fa-bolt"></i> ${sectionLabelP}</span>
      <span class="cine-section-count">${bars.length}</span>
    </div>
    <div class="cine-cards-list" id="cine-prx-all-list"></div>`;

  const renderGroup = (groupBars, containerId) => {
    const container = document.getElementById(containerId);
    if (!container) return;

    groupBars.forEach(bar => {
      const barPromos   = promoMap[bar.id] || [];
      const promoAtiva  = barPromos[0];
      const isScheduled = promoAtiva?._source === 'scheduled';
      const benefitText = promoAtiva?.title || bar.benefit || 'Benefício especial';
      const benefitDesc = promoAtiva?.description || '';
      const eventText   = promoAtiva?.event || promoAtiva?.event_tonight || bar.event_tonight || '';
      const genreLabel  = genreMap[bar.genre || bar.bar_genre] || '';
      const imgSrc      = bar.cover_url || bar.photo_url || DEF_IMG;
      const actCount    = bar.total_activations || 0;

      let slotsHtml = '';
      if (promoAtiva?.max_activations > 0) {
        const rem = promoAtiva.max_activations - (promoAtiva.activations_count || 0);
        slotsHtml = `<span class="cine-meta-item cine-slots"><i class="fa fa-users"></i> ${Math.max(0,rem)} vagas</span>`;
      }

      const badge = isScheduled
        ? '<span class="cine-live-badge cine-live-badge-sched"><i class="fa fa-calendar-day"></i> HOJE</span>'
        : '<span class="cine-live-badge cine-live-badge-red"><i class="fa fa-bolt"></i> AO VIVO</span>';

      const card = document.createElement('div');
      card.className = `cine-card cine-card-prx${isScheduled ? ' cine-card-sched' : ''}`;
      card.innerHTML = `
        <div class="cine-card-img-wrap">
          <img class="cine-card-img" src="${imgSrc}" alt="${bar.name}" loading="lazy" onerror="this.src='${DEF_IMG}'"/>
          <div class="cine-card-img-overlay"></div>
          ${badge}
          ${genreLabel ? `<span class="cine-genre-badge">${genreLabel}</span>` : ''}
        </div>
        <div class="cine-card-body">
          <p class="cine-card-studio">OZ · ${isScheduled ? 'Benefício do dia' : 'Benefício exclusivo'}</p>
          <h3 class="cine-card-title">${bar.name}</h3>
          <div class="cine-card-meta">
            <span class="cine-meta-item"><i class="fa fa-map-marker-alt"></i> ${bar.neighborhood || '—'}</span>
            <span class="cine-meta-dot">·</span>
            <span class="cine-meta-item"><i class="fa fa-bolt"></i> ${actCount} ativações</span>
            ${eventText ? `<span class="cine-meta-dot">·</span><span class="cine-meta-item cine-meta-music"><i class="fa fa-music"></i> Ao vivo</span>` : ''}
            ${slotsHtml ? `<span class="cine-meta-dot">·</span>${slotsHtml}` : ''}
          </div>
          <div class="cine-benefit-inline-card${isScheduled ? ' cine-benefit-inline-sched' : ''}">
            <i class="fa fa-gift"></i>
            <div class="cine-benefit-inline-body">
              <span class="cine-benefit-inline-title">${benefitText}</span>
              ${benefitDesc ? `<span class="cine-benefit-inline-desc">${benefitDesc}</span>` : ''}
              ${eventText ? `<span class="cine-benefit-inline-desc"><i class="fa fa-music"></i> ${eventText}</span>` : ''}
            </div>
            <span class="cine-benefit-inline-dot${isScheduled ? '-sched' : ''}"></span>
          </div>
          <div class="cine-card-btns">
            <button class="cine-btn-view">
              <i class="fa fa-eye"></i> Ver
            </button>
            <button class="cine-btn-activate-prx${isScheduled ? ' cine-btn-activate-sched' : ''}">
              <i class="fa fa-${isScheduled ? 'calendar-check' : 'bolt'}"></i>
              ${isScheduled ? 'Ver benefício' : 'Ativar benefício'}
            </button>
          </div>
        </div>`;

      // Garante que allPromos tem os dados deste bar antes de abrir o detalhe.
      // O promoter não roda loadBars (home do cliente), então allPromos pode estar
      // vazio para bares que só têm benefício agendado — preenchemos aqui com o
      // promoMap local (já correto) para que loadBarDetailPromos exiba o benefício.
      const _seedPromoForBar = () => {
        if (promoAtiva && (!allPromos[bar.id] || !allPromos[bar.id].length)) {
          allPromos[bar.id] = [promoAtiva];
        }
      };

      card.style.cursor = 'pointer';
      card.addEventListener('click', () => {
        _seedPromoForBar();
        OZ.exploreReadOnly = false;
        OZ.previousScreen  = 'screen-promoter-explore';
        openBarDetail(bar);
      });

      const btnView = card.querySelector('.cine-btn-view');
      if (btnView) btnView.addEventListener('click', (e) => {
        e.stopPropagation();
        _seedPromoForBar();
        OZ.exploreReadOnly = false;
        OZ.previousScreen  = 'screen-promoter-explore';
        openBarDetail(bar);
      });

      const btnActivate = card.querySelector('.cine-btn-activate-prx');
      if (btnActivate) {
        btnActivate._bar = bar;
        if (isScheduled) {
          // Benefício agendado: pré-carrega allPromos e vai para a tela do bar
          btnActivate.addEventListener('click', (e) => {
            e.stopPropagation();
            _seedPromoForBar();
            OZ.exploreReadOnly = false;
            OZ.previousScreen  = 'screen-promoter-explore';
            openBarDetail(bar).then(() => switchBarDetailTab('promocoes'));
          });
        } else {
          btnActivate.addEventListener('click', (e) => { e.stopPropagation(); prxOpenBarAndActivate(btnActivate); });
        }
      }

      container.appendChild(card);
    });
  };

  // Renderiza todos em lista única (live primeiro)
  const allSortedPrx = [
    ...bars.filter(b => (promoMap[b.id]||[])[0]?._source !== 'scheduled'),
    ...bars.filter(b => (promoMap[b.id]||[])[0]?._source === 'scheduled'),
  ];
  renderGroup(allSortedPrx, 'cine-prx-all-list');
}

/* Abre o bar e dispara o modal de ativação */
async function prxOpenBarAndActivate(btn) {
  const bar = btn?._bar;
  if (!bar) return;
  OZ.exploreReadOnly = false;
  OZ.currentBar      = bar;
  OZ.previousScreen  = 'screen-promoter-explore';
  // Preenche a UI do bar e abre o modal de ativação
  _fillBarDetailUI(bar);
  openActivateModal();
}

/* ── Busca ao vivo ───────────────────────────────────────── */
function filterPromoterExplore() {
  const q       = (document.getElementById('prx-explore-search')?.value || '').toLowerCase().trim();
  const clearBtn = document.getElementById('prx-explore-search-clear');
  if (clearBtn) clearBtn.style.display = q ? 'flex' : 'none';

  const filtered = q
    ? OZ._prxExploreBars.filter(b =>
        (b.name || '').toLowerCase().includes(q) ||
        (b.neighborhood || '').toLowerCase().includes(q) ||
        (b.genre || '').toLowerCase().includes(q)
      )
    : OZ._prxExploreBars;

  renderPromoterExploreCards(filtered, OZ._prxExplorePromos);
}

function clearPromoterExploreSearch() {
  const inp = document.getElementById('prx-explore-search');
  if (inp) { inp.value = ''; inp.focus(); }
  const clearBtn = document.getElementById('prx-explore-search-clear');
  if (clearBtn) clearBtn.style.display = 'none';
  renderPromoterExploreCards(OZ._prxExploreBars, OZ._prxExplorePromos);
}

/* ══════════════════════════════════════════════════════════
   PROMOTER EXPLORE — ABA BENEFÍCIOS AGENDADOS (calendário)
══════════════════════════════════════════════════════════ */

// Estado do calendário do promoter explore
OZ._prxCal = { year: 0, month: 0, selectedDate: null };

/* Troca entre as abas Ao Vivo / Benefícios Agendados */
function switchPromoterExploreTab(tab) {
  /* Fecha feed ao trocar de aba */
  if (window.OZFeed) OZFeed.close();
  const livePaneEl  = document.getElementById('prx-explore-live-pane');
  const schedPaneEl = document.getElementById('prx-explore-sched-pane');
  const tabLive     = document.getElementById('prx-etab-live');
  const tabSched    = document.getElementById('prx-etab-scheduled');

  if (livePaneEl)  livePaneEl.style.display  = tab === 'live'      ? 'block' : 'none';
  if (schedPaneEl) schedPaneEl.style.display = tab === 'scheduled' ? 'block' : 'none';
  if (tabLive)     tabLive.classList.toggle('active',  tab === 'live');
  if (tabSched)    tabSched.classList.toggle('active', tab === 'scheduled');

  if (tab === 'scheduled') {
    prxCalInit();
  }
}

/* Inicializa / re-renderiza o calendário do promoter */
async function prxCalInit() {
  const today = new Date();
  if (!OZ._prxCal.year) {
    OZ._prxCal.year  = today.getFullYear();
    OZ._prxCal.month = today.getMonth();
  }
  // Aba só mostra datas futuras — garante que hoje não fique selecionado
  if (!OZ._prxCal.selectedDate || OZ._prxCal.selectedDate <= _todayStr()) {
    OZ._prxCal.selectedDate = null;
  }
  // Busca todos os scheduled_benefits para construir o mapa de datas
  await prxCalLoadScheduled();
  prxCalRender();
  prxCalApplyFilter();
}

// Cache de benefícios agendados para o calendário do promoter
OZ._prxCalScheduled = {}; // date → [{bar, sched}]

async function prxCalLoadScheduled() {
  try {
    const [schedRes, barsRes] = await Promise.all([
      apiGet('tables/scheduled_benefits?limit=200'),
      apiGet('tables/bars?limit=200'),
    ]);
    const rawScheds = schedRes.data || [];
    const rawBars   = barsRes.data  || [];
    const barsMap   = {};
    rawBars.forEach(b => { barsMap[b.id] = b; });

    const map = {};
    rawScheds.forEach(s => {
      if (s.active === false || !s.date || !s.bar_id) return;
      const bar = barsMap[s.bar_id];
      if (!bar || bar.active === false) return;
      if (!map[s.date]) map[s.date] = [];
      map[s.date].push({ bar, sched: s });
    });
    OZ._prxCalScheduled = map;
  } catch(e) {
    console.warn('[prxCalLoadScheduled]', e);
  }
}

function prxCalRender() {
  const gridEl  = document.getElementById('prx-hcal-grid');
  const labelEl = document.getElementById('prx-hcal-month-label');
  if (!gridEl) return;

  const { year, month, selectedDate } = OZ._prxCal;
  const todayStr = localDateStr(new Date());
  const datesWithSched = new Set(Object.keys(OZ._prxCalScheduled));

  if (labelEl) {
    labelEl.textContent = `${HCAL_MONTHS_FULL[month]} ${year}`;
  }

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let html = '';
  // Células vazias antes do primeiro dia
  for (let i = 0; i < firstDay; i++) {
    html += '<div class="hcal-cell hcal-empty"></div>';
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isPast      = dateStr < todayStr;
    const isToday     = dateStr === todayStr;
    const hasData     = datesWithSched.has(dateStr);
    const isSelected  = dateStr === selectedDate;

    // Apenas datas FUTURAS são selecionáveis nesta aba
    const isFuture = dateStr > todayStr;
    let cls = 'hcal-cell';
    if (isPast && !isToday) cls += ' hcal-past';
    if (isFuture && isSelected) {
      cls += ' hcal-sel';
    } else if (isToday && hasData) {
      // Hoje: indica visualmente mas não é selecionável (fica no Descobrir)
      cls += ' hcal-today-sched';
    } else if (isToday) {
      cls += ' hcal-today';
    } else if (isFuture && hasData) {
      cls += ' hcal-sched';
    }

    const onclick = (isFuture && hasData) ? `onclick="prxCalSelect('${dateStr}')"` : '';
    html += `<div class="${cls}" ${onclick}>
      <span class="hcal-dn">${d}</span>
      ${isFuture && hasData && !isSelected ? '<span class="hcal-dot"></span>' : ''}
    </div>`;
  }

  gridEl.innerHTML = html;
}

function prxCalSelect(dateStr) {
  // Somente datas futuras são selecionáveis
  const todayKey = _todayStr();
  if (dateStr <= todayKey) return;
  OZ._prxCal.selectedDate = OZ._prxCal.selectedDate === dateStr ? null : dateStr;
  prxCalRender();
  prxCalApplyFilter();
}

function prxCalGoToday() {
  const today = new Date();
  OZ._prxCal.year         = today.getFullYear();
  OZ._prxCal.month        = today.getMonth();
  OZ._prxCal.selectedDate = null;   // limpa seleção (hoje fica no Descobrir)
  prxCalRender();
  prxCalApplyFilter();
}

function prxCalPrev() {
  if (OZ._prxCal.month === 0) {
    OZ._prxCal.month = 11;
    OZ._prxCal.year--;
  } else {
    OZ._prxCal.month--;
  }
  prxCalRender();
}

function prxCalNext() {
  if (OZ._prxCal.month === 11) {
    OZ._prxCal.month = 0;
    OZ._prxCal.year++;
  } else {
    OZ._prxCal.month++;
  }
  prxCalRender();
}

function prxCalApplyFilter() {
  const todayStr   = _todayStr();
  const dateFilter = OZ._prxCal.selectedDate;  // null = nenhuma seleção
  const labelEl    = document.getElementById('prx-hcal-filter-label');
  const countEl    = document.getElementById('prx-hcal-filter-count');
  const listEl     = document.getElementById('prx-sched-bars-list');
  const emptyEl    = document.getElementById('prx-sched-empty');

  // Sem data futura selecionada: orienta o usuário
  if (!dateFilter || dateFilter <= todayStr) {
    if (labelEl) labelEl.innerHTML = '<i class="fa fa-calendar-alt"></i> Selecione um dia futuro';
    if (countEl) countEl.style.display = 'none';
    if (listEl)  listEl.innerHTML = '';
    if (emptyEl) {
      emptyEl.innerHTML = `<i class="fa fa-calendar-alt"></i>
        <p>Selecione um dia no calendário acima<br><small>Os dias com bolinhas têm benefícios agendados.</small></p>`;
      emptyEl.style.display = 'flex';
    }
    return;
  }

  // Data futura: atualiza label
  const [y, mo, d] = dateFilter.split('-');
  const dt   = new Date(parseInt(y), parseInt(mo)-1, parseInt(d));
  const wday = dt.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.','').toUpperCase();
  const mon  = HCAL_MONTHS[parseInt(mo)-1];
  if (labelEl) labelEl.innerHTML = `<i class="fa fa-calendar-day"></i> ${wday}, ${parseInt(d)} de ${mon}`;

  const entries = OZ._prxCalScheduled[dateFilter] || [];

  if (countEl) {
    countEl.textContent = entries.length;
    countEl.style.display = entries.length ? 'inline-block' : 'none';
  }

  if (!listEl) return;
  listEl.innerHTML = '';

  if (!entries.length) {
    if (emptyEl) emptyEl.style.display = 'flex';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  // Renderiza cards dos bares agendados para a data
  const container = document.createElement('div');
  container.className = 'cine-cards-list';
  listEl.appendChild(container);

  entries.forEach(({ bar, sched }) => {
    const genreLabel = genreMap[bar.genre || bar.bar_genre] || '';
    const imgSrc     = bar.cover_url || bar.photo_url || DEF_IMG;
    const actCount   = bar.total_activations || 0;
    const benefitText = sched.title || bar.benefit || 'Benefício especial';
    const benefitDesc = sched.description || '';
    const eventText   = sched.event || bar.event_tonight || '';
    // dateFilter é sempre futuro nesta aba
    const [sy, smo, sd] = dateFilter.split('-');
    const dtLabel = new Date(parseInt(sy), parseInt(smo)-1, parseInt(sd));
    const dateLabel = dtLabel.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })
      .replace(/\./g,'').toUpperCase();

    const card = document.createElement('div');
    card.className = 'cine-card cine-card-prx cine-card-sched';
    card.innerHTML = `
      <div class="cine-card-img-wrap">
        <img class="cine-card-img" src="${imgSrc}" alt="${bar.name}" loading="lazy" onerror="this.src='${DEF_IMG}'"/>
        <div class="cine-card-img-overlay"></div>
        <span class="cine-live-badge cine-live-badge-sched"><i class="fa fa-calendar-check"></i> ${dateLabel}</span>
        ${genreLabel ? `<span class="cine-genre-badge">${genreLabel}</span>` : ''}
      </div>
      <div class="cine-card-body">
        <p class="cine-card-studio">OZ · Benefício do dia</p>
        <h3 class="cine-card-title">${bar.name}</h3>
        <div class="cine-card-meta">
          <span class="cine-meta-item"><i class="fa fa-map-marker-alt"></i> ${bar.neighborhood || '—'}</span>
          <span class="cine-meta-dot">·</span>
          <span class="cine-meta-item"><i class="fa fa-bolt"></i> ${actCount} ativações</span>
          ${eventText ? `<span class="cine-meta-dot">·</span><span class="cine-meta-item cine-meta-music"><i class="fa fa-music"></i> Ao vivo</span>` : ''}
        </div>
        <div class="cine-benefit-inline-card cine-benefit-inline-sched">
          <i class="fa fa-gift"></i>
          <div class="cine-benefit-inline-body">
            <span class="cine-benefit-inline-title">${benefitText}</span>
            ${benefitDesc ? `<span class="cine-benefit-inline-desc">${benefitDesc}</span>` : ''}
            ${eventText ? `<span class="cine-benefit-inline-desc"><i class="fa fa-music"></i> ${eventText}</span>` : ''}
          </div>
          <span class="cine-benefit-inline-dot-sched"></span>
        </div>
        <div class="cine-card-btns">
          <button class="cine-btn-view prx-cal-view-btn"><i class="fa fa-eye"></i> Ver bar</button>
          <button class="cine-btn-activate-prx cine-btn-activate-sched prx-cal-activate-btn">
            <i class="fa fa-bolt"></i> Ativar por antecipação
          </button>
        </div>
      </div>`;

    card.style.cursor = 'pointer';
    const openBar = () => {
      OZ.exploreReadOnly = false;
      openBarDetail(bar).then(() => {
        OZ.previousScreen = 'screen-promoter-explore';
        switchBarDetailTab('promocoes');
      });
    };

    card.addEventListener('click', openBar);
    const btnView = card.querySelector('.prx-cal-view-btn');
    if (btnView) btnView.addEventListener('click', (e) => { e.stopPropagation(); openBar(); });
    // Botão de ativação antecipada para promoter
    const btnAct = card.querySelector('.prx-cal-activate-btn');
    if (btnAct) btnAct.addEventListener('click', (e) => {
      e.stopPropagation();
      openAdvanceActivateModal(sched, bar);
    });

    container.appendChild(card);
  });
}

async function saveBarInfo() {
  const alertEl = document.getElementById('bar-info-alert');
  if (alertEl) alertEl.style.display = 'none';
  const barId = OZ.currentUser?.bar_id;

  const photoUrl    = document.getElementById('bar-edit-photo')?.value     || '';
  const coverUrl    = document.getElementById('bar-edit-cover')?.value     || '';
  const name        = document.getElementById('bar-edit-name')?.value      || '';
  const neighborhood= document.getElementById('bar-edit-hood')?.value      || '';
  const release     = document.getElementById('bar-edit-release')?.value   || '';
  const instagram   = document.getElementById('bar-edit-instagram')?.value || '';
  const address     = document.getElementById('bar-edit-address')?.value   || '';
  const hours       = document.getElementById('bar-edit-hours')?.value     || '';
  const whatsapp    = document.getElementById('bar-edit-whatsapp')?.value  || '';
  const active      = document.getElementById('bar-edit-active')?.value    === 'true';

  // Atualiza OZ.currentUser e localStorage imediatamente
  if (OZ.currentUser) {
    OZ.currentUser.photo_url = photoUrl;
    localStorage.setItem('oz_user', JSON.stringify(OZ.currentUser));
  }

  if (!barId || barId.startsWith('demo-') || barId.startsWith('fb')) {
    showToast('Modo demo — salvo localmente ✅', 'success');
    if (alertEl) { alertEl.textContent = '✅ Salvo com sucesso!'; alertEl.style.display = 'block'; }
    return;
  }
  try {
    await apiPatch(`tables/bars/${barId}`, {
      name, neighborhood,
      description: release,
      release,
      photo_url:  photoUrl,
      cover_url:  coverUrl,
      instagram,
      address,
      hours,
      whatsapp,
      active,
    });
    allBars = allBars.map(b => b.id === barId
      ? { ...b, photo_url: photoUrl, cover_url: coverUrl, name, neighborhood, address, hours, whatsapp }
      : b);
    if (alertEl) { alertEl.textContent = '✅ Informações salvas!'; alertEl.style.display = 'block'; }
    showToast('Informações atualizadas ✅', 'success');
    setTimeout(() => { if (alertEl) alertEl.style.display = 'none'; }, 3000);
  } catch { showToast('Erro ao salvar. Tente novamente.', 'error'); }
}

async function createPromotion() {
  // ── GUARD: bar não aprovado não pode postar benefícios ──
  const _approvalStatus = OZ.currentUser?.approval_status;
  if (_approvalStatus && _approvalStatus !== 'approved') {
    showToast('Seu cadastro ainda não foi aprovado pelo admin. Aguarde a aprovação para publicar benefícios.', 'error');
    return;
  }

  const alertEl   = document.getElementById('promo-form-alert');
  const publishBtn = document.getElementById('btn-publish-promo');
  alertEl.style.display = 'none';

  const title      = document.getElementById('new-promo-title').value.trim();
  const desc       = document.getElementById('new-promo-desc').value.trim();
  const eventToday = (document.getElementById('new-promo-event')?.value || '').trim();
  const from       = document.getElementById('new-promo-from').value;
  const barId      = OZ.currentUser?.bar_id;

  // Lê limite de ativações (0 = sem limite)
  const limitActive = document.getElementById('plt-on')?.classList.contains('active');
  const maxAct      = limitActive ? (parseInt(document.getElementById('new-promo-max')?.value, 10) || 0) : 0;

  if (!title) { showToast('Informe o título do benefício.', 'error'); return; }
  if (!desc)  { showToast('Descreva o que o cliente vai ganhar.', 'error'); return; }
  if (limitActive && maxAct < 1) { showToast('O limite deve ser pelo menos 1 ativação.', 'error'); return; }

  // ── Ativa loading no botão ──────────────────────────────
  const _setBtnLoading = (loading) => {
    if (!publishBtn) return;
    publishBtn.disabled = loading;
    publishBtn.innerHTML = loading
      ? '<i class="fa fa-spinner fa-spin"></i> Publicando...'
      : '<i class="fa fa-bolt"></i> Publicar benefício agora';
  };
  _setBtnLoading(true);

  // ── GUARD: apenas 1 benefício por data ──────────────────
  if (barId && !barId.startsWith('demo-') && !barId.startsWith('fb')) {
    try {
      const checkRes   = await apiGet(`tables/promotions?limit=50`);
      const activeNow  = (checkRes.data || []).filter(p => p.bar_id === barId && isPromoActive(p));
      if (activeNow.length > 0) {
        const notice = document.getElementById('promo-already-active-notice');
        const form   = document.getElementById('promo-create-form');
        if (notice) notice.style.display = 'flex';
        if (form)   { form.style.opacity = '0.4'; form.style.pointerEvents = 'none'; }
        showToast('Você já tem um benefício ativo hoje. Cancele-o antes de publicar outro.', 'error');
        _setBtnLoading(false);
        return;
      }
    } catch { /* continua se API falhar */ }
  }

  // Expiração sempre às 6h da manhã
  const now    = new Date();
  const expiry = new Date(now);
  if (now.getHours() >= 6) expiry.setDate(expiry.getDate() + 1);
  expiry.setHours(6, 0, 0, 0);
  const expiryISO   = expiry.toISOString();
  const expiryLabel = `${expiry.toLocaleDateString('pt-BR')} às 06:00`;

  try {
    if (!barId || barId.startsWith('demo-') || barId.startsWith('fb')) {
      showToast('Benefício publicado até às 6h da manhã 🎉', 'success');
      alertEl.textContent = `✅ Publicado! Válido até ${expiryLabel}.${maxAct ? ` Limite: ${maxAct} ativações.` : ''}`;
      alertEl.style.display = 'block';
      checkActivePromo([{ title, description: desc, active: true, expiry_at: expiryISO, valid_from: from, valid_until: '06:00', max_activations: maxAct, activations_count: 0 }]);
    } else {
      await apiPost('tables/promotions', {
        bar_id: barId, bar_name: OZ.currentUser.bar_name || OZ.currentUser.name,
        title, description: desc, benefit_type: 'livre',
        event_tonight: eventToday,
        valid_from: from, valid_until: '06:00',
        expiry_at: expiryISO,
        active: true,
        activations_count: 0,
        max_activations: maxAct,
      });
      if (eventToday) {
        await apiPatch(`tables/bars/${barId}`, { event_tonight: eventToday, benefit: title });
      }
      alertEl.textContent = `✅ Publicado! Válido até ${expiryLabel}.${maxAct ? ` Limite: ${maxAct} ativações.` : ''}`;
      alertEl.style.display = 'block';
      showToast('Benefício publicado! 🎉', 'success');
      const promoRes = await apiGet(`tables/promotions?limit=50`);
      const promos   = (promoRes.data || []).filter(p => p.bar_id === barId && isPromoActive(p));
      loadBarPromos(promos, barId);
      checkActivePromo(promos);
    }
    // Limpar campos
    document.getElementById('new-promo-title').value = '';
    document.getElementById('new-promo-desc').value  = '';
    document.getElementById('new-promo-from').value  = '20:00';
    if (document.getElementById('new-promo-event')) document.getElementById('new-promo-event').value = '';
    setPromoLimit(false);
    setTimeout(() => alertEl.style.display = 'none', 5000);
  } catch {
    showToast('Erro ao criar benefício.', 'error');
  } finally {
    _setBtnLoading(false);
  }
}

/* Verifica se há promo ativa e bloqueia/desbloqueia o formulário */
function checkActivePromo(promos) {
  const hasActive = promos.some(p => isPromoActive(p));
  const notice    = document.getElementById('promo-already-active-notice');
  const form      = document.getElementById('promo-create-form');
  if (!notice || !form) return;
  if (hasActive) {
    notice.style.display = 'flex';
    form.style.opacity   = '0.4';
    form.style.pointerEvents = 'none';
  } else {
    notice.style.display = 'none';
    form.style.opacity   = '1';
    form.style.pointerEvents = '';
  }
}

/* Verifica se a promoção ainda está dentro do prazo (até 6h da manhã) */
function isPromoActive(promo) {
  if (!promo.active) return false;
  const now = new Date();

  if (!promo.expiry_at) {
    /* Legado sem expiry_at: a promo vale dentro da "noite atual"
       Regra: a noite começa às 06h00 e vai até as 05h59 do dia seguinte.
       Calcula o início da noite atual (último 06h00 passado). */
    const periodStart = new Date(now);
    if (now.getHours() < 6) {
      // Madrugada: a noite começou ontem às 06h
      periodStart.setDate(periodStart.getDate() - 1);
    }
    periodStart.setHours(6, 0, 0, 0);
    const created = promo.created_at ? new Date(promo.created_at) : null;
    return created ? created >= periodStart : false;
  }

  // Com expiry_at: simplesmente compara com agora
  return now < new Date(promo.expiry_at);
}

/* ══════════════════════════════════════════════════════════════
   CALENDÁRIO DE AGENDAMENTO DE BENEFÍCIOS — SISTEMA COMPLETO
   • Todos os benefícios são agendados (nenhum publicado "ao vivo" direto)
   • Dados persistem na API (tables/scheduled_benefits) + cache local
   • Cache local: oz_sched_cache_<barId>  (array de objetos)
   •              oz_sched_apimap_<barId> (local_id → api_id)
═══════════════════════════════════════════════════════════════ */

/* ── Cache local (sync) ──────────────────────────────────────── */
function getSchedules(barId) {
  try { return JSON.parse(localStorage.getItem(`oz_sched_cache_${barId}`) || '[]'); }
  catch { return []; }
}
function saveSchedules(barId, list) {
  localStorage.setItem(`oz_sched_cache_${barId}`, JSON.stringify(list));
}

/* ── Carrega agendamentos da API e atualiza cache ─────────────── */
async function bslLoadFromAPI(barId) {
  if (!barId || barId.startsWith('demo') || barId.startsWith('fb')) return;
  try {
    const res  = await apiGet(`tables/scheduled_benefits?limit=200`);
    const list = (res.data || []).filter(s => s.bar_id === barId && s.active !== false);
    // Normaliza para o formato interno
    const normalized = list.map(s => ({
      id:              s.local_id ? parseInt(s.local_id) : s.id,
      api_id:          s.id,
      date:            s.date,
      title:           s.title,
      desc:            s.description,
      event:           s.event || '',
      max_activations: s.max_activations || 0,
      created_at:      s.created_at,
    }));
    saveSchedules(barId, normalized);
    // Rebuild apimap
    const map = {};
    normalized.forEach(s => { if (s.api_id) map[s.id] = s.api_id; });
    localStorage.setItem(`oz_sched_apimap_${barId}`, JSON.stringify(map));
    return normalized;
  } catch { return getSchedules(barId); }
}

/* ── Estado do calendário ────────────────────────────────────── */
OZ.schedCalYear        = new Date().getFullYear();
OZ.schedCalMonth       = new Date().getMonth(); // 0-11
OZ.schedSelectedDate   = null;
OZ._bslEditApiId       = null;  // api_id do item em edição (null = novo)
OZ._bslIsEditing       = false; // modo edição ativo

const MONTH_NAMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                     'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const WDAY_NAMES  = ['Domingo','Segunda','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];

/* ── Renderiza o calendário ──────────────────────────────────── */
function renderSchedCalendar() {
  const grid  = document.getElementById('sched-cal-grid');
  const label = document.getElementById('sched-cal-month-label');
  if (!grid || !label) return;

  const y = OZ.schedCalYear;
  const m = OZ.schedCalMonth;
  label.textContent = `${MONTH_NAMES[m]} de ${y}`;

  const barId     = OZ.currentUser?.bar_id || 'demo';
  const schedules = getSchedules(barId);
  const scheduled = schedules.map(s => s.date);

  const todayD      = new Date(); todayD.setHours(0,0,0,0);
  const todayStr    = localDateStr(todayD);
  const firstDay    = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m+1, 0).getDate();

  // Quais datas têm benefício ativo agora (apenas hoje pode ter)
  const activeToday = OZ._bslActiveToday || false; // setado por initPromoTab

  let html = '';
  for (let i = 0; i < firstDay; i++) html += '<div class="bsl-cal-cell bsl-empty"></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr  = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const cellDate = new Date(y, m, d);
    const isPast   = cellDate < todayD;
    const isToday  = dateStr === todayStr;
    const isSched  = scheduled.includes(dateStr);
    const isSel    = OZ.schedSelectedDate === dateStr;
    const isLive   = isToday && activeToday && isSched;

    let cls = 'bsl-cal-cell';
    if (isPast && !isToday) cls += ' bsl-past';
    if (isToday && !isSel)  cls += ' bsl-today';
    if (isSched && !isToday && !isSel) cls += ' bsl-has-sched';
    if (isLive && !isSel)   cls += ' bsl-live-today';
    if (isSel)    cls += ' bsl-selected';

    // Dias passados (exceto hoje) não são clicáveis
    const clickable = !isPast || isToday;
    const onclick   = clickable ? `onclick="selectSchedDate('${dateStr}')"` : '';

    let inner = `<span class="bsl-day-num">${d}</span>`;
    if (isSched) inner += '<span class="bsl-sched-dot"></span>';

    html += `<div class="${cls}" ${onclick}>${inner}</div>`;
  }
  grid.innerHTML = html;
}

/* ── Navegar mês ──────────────────────────────────────────────── */
function schedCalPrev() {
  OZ.schedCalMonth--;
  if (OZ.schedCalMonth < 0) { OZ.schedCalMonth = 11; OZ.schedCalYear--; }
  renderSchedCalendar();
}
function schedCalNext() {
  OZ.schedCalMonth++;
  if (OZ.schedCalMonth > 11) { OZ.schedCalMonth = 0; OZ.schedCalYear++; }
  renderSchedCalendar();
}
function schedCalGoToday() {
  OZ.schedCalYear  = new Date().getFullYear();
  OZ.schedCalMonth = new Date().getMonth();
  renderSchedCalendar();
}

/* ── Selecionar data ──────────────────────────────────────────── */
function selectSchedDate(dateStr) {
  OZ.schedSelectedDate = dateStr;
  OZ._bslIsEditing     = false;
  OZ._bslEditApiId     = null;

  const [y, mo, d] = dateStr.split('-');
  const dt       = new Date(parseInt(y), parseInt(mo)-1, parseInt(d));
  const wday     = WDAY_NAMES[dt.getDay()];
  const mon      = MONTH_NAMES[parseInt(mo)-1];
  const todayStr = localDateStr(new Date());
  const isToday  = dateStr === todayStr;

  // Formata data legível
  const readable = isToday
    ? `Hoje — ${wday}, ${parseInt(d)} de ${mon}`
    : `${wday}, ${parseInt(d)} de ${mon} de ${y}`;

  // Atualiza labels
  const lbl = document.getElementById('sched-cal-selected-label');
  if (lbl) lbl.textContent = readable;

  const sub = document.getElementById('bsl-date-sub');

  // Verifica se já existe agendamento nessa data
  const barId    = OZ.currentUser?.bar_id || 'demo';
  const existing = getSchedules(barId).find(s => s.date === dateStr);

  const panel    = document.getElementById('sched-form-panel');
  const editMode = document.getElementById('bsl-edit-mode');
  const newMode  = document.getElementById('bsl-new-mode');

  // Mostra o painel
  if (panel) {
    panel.style.display = 'block';
    setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }

  if (existing) {
    // ── Dia com benefício agendado ──────────────────────────
    const isLive   = isToday && OZ._bslActiveToday;
    if (sub) sub.textContent = isLive ? '🔴 Ativo agora' : 'Benefício agendado';

    if (editMode) editMode.style.display = 'block';
    if (newMode)  newMode.style.display  = 'none';

    // Banner "AO VIVO" só aparece se for hoje e ativo
    const liveBanner = document.getElementById('bsl-today-live-banner');
    if (liveBanner) liveBanner.style.display = isLive ? 'flex' : 'none';

    _bslFillExistingPreview(existing);
  } else {
    // ── Dia livre → formulário novo ─────────────────────────
    if (sub) sub.textContent = isToday ? '📅 Agendar para hoje' : 'Novo agendamento';

    if (editMode) editMode.style.display = 'none';
    if (newMode)  newMode.style.display  = 'block';

    const liveBanner = document.getElementById('bsl-today-live-banner');
    if (liveBanner) liveBanner.style.display = 'none';

    _bslResetForm();
  }

  renderSchedCalendar();
}

/* ── Preenche preview do agendamento existente ──────────────── */
function _bslFillExistingPreview(item) {
  const el = document.getElementById('bsl-existing-preview');
  if (!el) return;
  const limitTxt   = item.max_activations ? `${item.max_activations} ativações` : 'Sem limite';
  const catMap     = { 'Comidinha': '🍔', 'Bebida': '🍺', 'Entrada VIP': '⭐', 'Desconto': '🏷️', 'Outros': '✨' };
  const catEmoji   = catMap[item.category] || '';
  const catHtml    = item.category
    ? `<div class="bsl-preview-row"><i class="fa fa-th-large"></i><span>${catEmoji} ${item.category}</span></div>`
    : '';
  el.innerHTML = `
    <div class="bsl-preview-row">
      <i class="fa fa-tag"></i><span><strong>${item.title}</strong></span>
    </div>
    ${catHtml}
    <div class="bsl-preview-row">
      <i class="fa fa-align-left"></i><span>${item.desc}</span>
    </div>
    ${item.event ? `<div class="bsl-preview-row"><i class="fa fa-music"></i><span>${item.event}</span></div>` : ''}
    <div class="bsl-preview-row bsl-preview-limit">
      <i class="fa fa-users"></i><span>${limitTxt}</span>
    </div>
  `;
  OZ._bslSelectedItem = item;
}

/* ── Alterna para modo edição de item existente ─────────────── */
function bslToggleEdit() {
  const item     = OZ._bslSelectedItem;
  const editMode = document.getElementById('bsl-edit-mode');
  const newMode  = document.getElementById('bsl-new-mode');
  const sub      = document.getElementById('bsl-date-sub');
  if (!item) return;

  OZ._bslIsEditing = true;
  OZ._bslEditApiId = item.api_id || null;

  if (editMode) editMode.style.display = 'none';
  if (newMode)  newMode.style.display  = 'block';
  if (sub) sub.textContent = 'Editando agendamento';

  // Preenche os campos
  const titleEl  = document.getElementById('sched-title');
  const descEl   = document.getElementById('sched-desc');
  const eventEl  = document.getElementById('sched-event');
  const catInput = document.getElementById('sched-category');
  if (titleEl)  titleEl.value  = item.title || '';
  if (descEl)   descEl.value   = item.desc  || '';
  if (eventEl)  eventEl.value  = item.event || '';
  // Restaura seleção de categoria
  if (catInput) catInput.value = item.category || '';
  document.querySelectorAll('#sched-cat-grid .bsl-cat-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.cat === (item.category || ''));
  });

  const hasLimit = item.max_activations > 0;
  setSchedLimit(hasLimit);
  if (hasLimit) {
    const maxEl = document.getElementById('sched-max');
    if (maxEl) maxEl.value = item.max_activations;
  }

  // Muda label do botão
  const btnLabel = document.getElementById('bsl-btn-save-label');
  if (btnLabel) btnLabel.textContent = 'Salvar alterações';
}

/* ── Deleta agendamento selecionado ──────────────────────────── */
async function bslDeleteSelected() {
  const item = OZ._bslSelectedItem;
  if (!item) return;
  if (!confirm(`Remover o agendamento de ${formatDateBR(item.date)}?`)) return;
  await deleteSchedule(item.id);
  clearSchedDate();
}

/* ── Limpa seleção ───────────────────────────────────────────── */
function clearSchedDate() {
  OZ.schedSelectedDate = null;
  OZ._bslIsEditing     = false;
  OZ._bslEditApiId     = null;
  OZ._bslSelectedItem  = null;
  const panel = document.getElementById('sched-form-panel');
  if (panel) panel.style.display = 'none';
  renderSchedCalendar();
}

/* ── Reseta os campos do formulário ─────────────────────────── */
/* Seleciona categoria no grid de botões */
function selectSchedCat(btn) {
  document.querySelectorAll('#sched-cat-grid .bsl-cat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const catInput = document.getElementById('sched-category');
  if (catInput) catInput.value = btn.dataset.cat || '';
}

function _bslResetForm() {
  const titleEl = document.getElementById('sched-title');
  const descEl  = document.getElementById('sched-desc');
  const eventEl = document.getElementById('sched-event');
  const catInput = document.getElementById('sched-category');
  if (titleEl)  titleEl.value = '';
  if (descEl)   descEl.value  = '';
  if (eventEl)  eventEl.value = '';
  if (catInput) catInput.value = '';
  // Remove seleção ativa de categoria
  document.querySelectorAll('#sched-cat-grid .bsl-cat-btn').forEach(b => b.classList.remove('active'));
  setSchedLimit(false);
  const btnLabel = document.getElementById('bsl-btn-save-label');
  if (btnLabel) btnLabel.textContent = 'Agendar benefício';
}

/* ── Salvar / Editar agendamento ────────────────────────────── */
async function schedulePromotion() {
  // ── GUARD: bar não aprovado não pode postar benefícios ──
  const _approvalStatus = OZ.currentUser?.approval_status;
  if (_approvalStatus && _approvalStatus !== 'approved') {
    showToast('Seu cadastro ainda não foi aprovado pelo admin. Aguarde a aprovação para publicar benefícios.', 'error');
    return;
  }

  const barId    = OZ.currentUser?.bar_id || 'demo';
  const barName  = OZ.currentUser?.bar_name || OZ.currentUser?.name || '';
  const title    = (document.getElementById('sched-title')?.value    || '').trim();
  const desc     = (document.getElementById('sched-desc')?.value     || '').trim();
  const event    = (document.getElementById('sched-event')?.value    || '').trim();
  const category = (document.getElementById('sched-category')?.value || '').trim();
  const alertEl  = document.getElementById('sched-form-alert');
  if (alertEl) alertEl.style.display = 'none';

  const limitActive = document.getElementById('sched-plt-on')?.classList.contains('active');
  const maxAct      = limitActive ? (parseInt(document.getElementById('sched-max')?.value, 10) || 0) : 0;

  const selDate = OZ.schedSelectedDate;
  if (!selDate)   { showToast('Selecione uma data no calendário.', 'error'); return; }
  if (!title)     { showToast('Informe o título do benefício.', 'error'); return; }
  if (!category)  { showToast('Selecione uma categoria para o benefício.', 'error'); return; }
  if (!desc)      { showToast('Descreva o que o cliente vai ganhar.', 'error'); return; }
  if (limitActive && maxAct < 1) { showToast('O limite deve ser pelo menos 1 ativação.', 'error'); return; }

  const btn = document.getElementById('btn-schedule-promo');
  const lblEl = document.getElementById('bsl-btn-save-label');
  if (btn) { btn.disabled = true; if (lblEl) lblEl.textContent = 'Salvando...'; btn.querySelector('i').className = 'fa fa-spinner fa-spin'; }

  const isEdit   = OZ._bslIsEditing && OZ._bslEditApiId;
  const schedules = getSchedules(barId);

  try {
    if (isEdit) {
      /* ── EDIÇÃO ─────────────────────────────────────────── */
      const apiId = OZ._bslEditApiId;
      // Atualiza na API
      if (!barId.startsWith('demo') && !barId.startsWith('fb')) {
        await apiPatch(`tables/scheduled_benefits/${apiId}`, {
          title, description: desc, event, category, max_activations: maxAct,
        });
      }
      // Atualiza cache local
      const idx = schedules.findIndex(s => s.api_id === apiId);
      if (idx >= 0) {
        schedules[idx] = { ...schedules[idx], title, desc, event, category, max_activations: maxAct };
        saveSchedules(barId, schedules);
      }
      showToast('Agendamento atualizado ✅', 'success');

    } else {
      /* ── NOVO ───────────────────────────────────────────── */
      // Verifica duplicata
      if (schedules.some(s => s.date === selDate)) {
        showToast(`Já existe um agendamento para ${formatDateBR(selDate)}.`, 'error');
        return;
      }

      const localId = Date.now();
      let apiId     = null;

      if (!barId.startsWith('demo') && !barId.startsWith('fb')) {
        const created = await apiPost('tables/scheduled_benefits', {
          bar_id:             barId,
          bar_name:           barName,
          date:               selDate,
          title,
          description:        desc,
          event,
          category,
          max_activations:    maxAct,
          reservations_count: 0,
          active:             true,
          local_id:           String(localId),
        });
        apiId = created?.id;
        const map = JSON.parse(localStorage.getItem(`oz_sched_apimap_${barId}`) || '{}');
        map[localId] = apiId;
        localStorage.setItem(`oz_sched_apimap_${barId}`, JSON.stringify(map));
      }

      schedules.push({ id: localId, api_id: apiId, date: selDate, title, desc, event, category, max_activations: maxAct, created_at: new Date().toISOString() });
      saveSchedules(barId, schedules);
      showToast(`Agendado para ${formatDateBR(selDate)} 📅`, 'success');
    }

    // Feedback visual
    if (alertEl) {
      const limitMsg = maxAct ? ` · Limite: ${maxAct} ativações` : '';
      alertEl.className = 'bsl-alert bsl-alert-ok';
      alertEl.textContent = isEdit
        ? `✅ Agendamento de ${formatDateBR(selDate)} atualizado!`
        : `✅ Benefício agendado para ${formatDateBR(selDate)}!${limitMsg}`;
      alertEl.style.display = 'block';
      setTimeout(() => { if (alertEl) alertEl.style.display = 'none'; }, 4000);
    }

    // Atualiza flag de ativo hoje se agendamento era para hoje
    const todayCheck = localDateStr(new Date());
    if (selDate === todayCheck) OZ._bslActiveToday = true;

    // Fecha o painel e re-renderiza
    clearSchedDate();
    loadSchedList(barId);
    loadSchedReservations(barId);

  } catch (err) {
    console.error('[OZ] schedulePromotion:', err);
    showToast('Erro ao salvar. Tente novamente.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      if (lblEl) lblEl.textContent = isEdit ? 'Salvar alterações' : 'Agendar benefício';
      const icon = btn.querySelector('i');
      if (icon) icon.className = 'fa fa-calendar-check';
    }
  }
}

/* ── Deletar agendamento ─────────────────────────────────────── */
// Se o agendamento for de hoje (data === _todayStr()), abre modal de cancelamento
// que avisa os clientes e concede crédito grátis. Caso contrário, remove diretamente.
async function deleteSchedule(id) {
  const barId  = OZ.currentUser?.bar_id || 'demo';
  const list   = getSchedules(barId);
  const item   = list.find(s => s.id === id || s.id === String(id));
  if (!item) return;

  const apiId   = item.api_id;
  const todayS  = _todayStr();
  const isToday = item.date === todayS;

  // Agendamento de HOJE: usa o modal de cancelamento para notificar clientes
  if (isToday && !barId.startsWith('demo') && !barId.startsWith('fb')) {
    // O apiId pode ser o ID da tabela scheduled_benefits (para o PATCH de desativação)
    const cancelId = apiId || id;
    openCancelPromoModal(cancelId, item.title || 'Benefício de hoje', true /* isScheduled */);
    return; // o restante é tratado por cancelPromotion()
  }

  // Agendamento futuro: remove diretamente sem notificação
  if (!confirm(`Remover o agendamento de ${formatDateBR(item.date)}?`)) return;

  // Limpa flag ativo se era hoje
  if (isToday) OZ._bslActiveToday = false;

  // Remove do cache local
  saveSchedules(barId, list.filter(s => s.id !== id && s.id !== String(id)));

  // Remove da API
  if (apiId && !barId.startsWith('demo') && !barId.startsWith('fb')) {
    try {
      await apiDelete(`tables/scheduled_benefits/${apiId}`);
      const map = JSON.parse(localStorage.getItem(`oz_sched_apimap_${barId}`) || '{}');
      delete map[id];
      localStorage.setItem(`oz_sched_apimap_${barId}`, JSON.stringify(map));
    } catch { /* silencioso */ }
  }

  loadSchedList(barId);
  loadSchedReservations(barId);
  renderSchedCalendar();
  showToast('Agendamento removido.', 'success');
}

/* ── Cancelar benefício ativo hoje ───────────────────────────── */
async function cancelTodayBenefit() {
  if (!confirm('Encerrar o benefício ativo hoje?')) return;
  const barId = OZ.currentUser?.bar_id;
  if (!barId || barId.startsWith('demo') || barId.startsWith('fb')) {
    showToast('Modo demo — sem efeito real.', 'error'); return;
  }
  try {
    const res    = await apiGet(`tables/promotions?limit=50`);
    const active = (res.data || []).filter(p => p.bar_id === barId && isPromoActive(p));
    await Promise.all(active.map(p => apiPatch(`tables/promotions/${p.id}`, { active: false })));
    showToast('Benefício encerrado.', 'success');
    const barPanelPromos = await apiGet(`tables/promotions?limit=50`);
    const promos = (barPanelPromos.data || []).filter(p => p.bar_id === barId && isPromoActive(p));
    loadBarPromos(promos, barId);
    checkActivePromo(promos);
  } catch { showToast('Erro ao encerrar.', 'error'); }
}

/* ── Lista de próximos agendamentos ─────────────────────────── */
function loadSchedList(barId) {
  const listEl  = document.getElementById('sched-list');
  const section = document.getElementById('bsl-list-section');
  const countEl = document.getElementById('bsl-list-count');
  if (!listEl) return;

  const bid      = barId || OZ.currentUser?.bar_id || 'demo';
  const today    = localDateStr(new Date());
  const all      = getSchedules(bid);
  const upcoming = all.filter(s => s.date >= today).sort((a,b) => a.date.localeCompare(b.date));

  if (countEl) countEl.textContent = upcoming.length;
  if (section)  section.style.display = upcoming.length ? 'block' : 'none';
  if (!upcoming.length) { listEl.innerHTML = ''; return; }

  listEl.innerHTML = `<div class="bsl-list-wrap">${upcoming.map(s => {
    const dt       = new Date(s.date + 'T12:00:00');
    const dayNum   = dt.getDate();
    const monthAbb = dt.toLocaleDateString('pt-BR', { month: 'short' }).replace('.','').toUpperCase();
    const wday     = dt.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.','').toUpperCase();
    const isToday  = s.date === today;
    const isLive   = isToday && OZ._bslActiveToday;
    const limitTxt = s.max_activations ? `${s.max_activations} ativações` : 'Sem limite';

    return `
    <div class="bsl-item ${isToday ? 'bsl-item-today' : ''}" onclick="selectSchedDate('${s.date}')">
      <div class="bsl-item-date">
        <span class="bsl-item-day">${dayNum}</span>
        <span class="bsl-item-month">${monthAbb}</span>
        <span class="bsl-item-wday">${wday}</span>
        ${isToday ? '<span class="bsl-item-today-badge">HOJE</span>' : ''}
      </div>
      <div class="bsl-item-info">
        <p class="bsl-item-title">${s.title}</p>
        <p class="bsl-item-desc">${s.desc}</p>
        ${s.event ? `<p class="bsl-item-event"><i class="fa fa-music"></i> ${s.event}</p>` : ''}
        <span class="bsl-item-limit"><i class="fa fa-users"></i> ${limitTxt}</span>
      </div>
      <button class="bsl-item-del ${isToday ? 'bsl-item-del-cancel' : ''}"
        onclick="event.stopPropagation();deleteSchedule(${JSON.stringify(s.id)})"
        title="${isToday ? 'Cancelar benefício de hoje' : 'Remover'}">
        <i class="fa ${isToday ? 'fa-times-circle' : 'fa-trash'}"></i>
      </button>
    </div>`;
  }).join('')}</div>`;
}

/* ── Lista de reservas no painel do bar ── */
async function loadSchedReservations(barId) {
  const section = document.getElementById('sched-reservations-section');
  const listEl  = document.getElementById('sched-reservations-list');
  if (!section || !listEl) return;

  const bid = barId || OZ.currentUser?.bar_id;
  if (!bid || bid.startsWith('demo') || bid.startsWith('fb')) {
    section.style.display = 'none';
    return;
  }

  try {
    const res   = await apiGet(`tables/reservations?limit=200`);
    const today = new Date().toISOString().split('T')[0];
    // Allowlist de status — mesma regra da lista do dia atual:
    // pending / pending_payment / failed → excluídos (pagamento não confirmado)
    const RESVS_OK = new Set(['confirmed', 'active', 'pre_activated']);
    const items = (res.data || []).filter(r =>
      r.bar_id === bid &&
      RESVS_OK.has(r.status) &&
      (r.benefit_date ? r.benefit_date >= today : true)  // apenas datas futuras ou sem data
    );

    if (!items.length) {
      section.style.display = 'none';
      return;
    }

    section.style.display = 'block';

    // Agrupa por data do benefício
    const byDate = {};
    items.forEach(r => {
      const d = r.benefit_date || 'sem-data';
      if (!byDate[d]) byDate[d] = { title: r.benefit_title || '', list: [] };
      byDate[d].list.push(r);
    });

    const dates = Object.keys(byDate).sort();

    listEl.innerHTML = dates.map(dateKey => {
      const group  = byDate[dateKey];
      const d      = dateKey !== 'sem-data' ? new Date(dateKey + 'T12:00:00') : null;
      const isToday = dateKey === today;
      const dateLabel = d
        ? d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
        : 'Data não definida';

      // Separa pré-ativados de reservas simples
      const preActivated = group.list.filter(r => r.status === 'pre_activated');
      const reserved     = group.list.filter(r => r.status !== 'pre_activated');

      const renderPerson = (r) => {
        const avatar = r.user_photo
          ? `<div class="srd-avatar" style="background-image:url('${r.user_photo}');background-size:cover;"></div>`
          : `<div class="srd-avatar srd-avatar-init">${(r.user_name||'?')[0].toUpperCase()}</div>`;
        const roleIcon = r.user_role === 'promoter' ? '🎯' : '👤';
        const isPre = r.status === 'pre_activated';
        const typeLabel = isPre
          ? (r.activation_type === 'advance_night' ? '🌙 Noite Toda' : '⚡ Unitário')
          : '📅 Reserva';
        const paidBadge = isPre && r.paid
          ? `<span class="srd-paid-badge"><i class="fa fa-check-circle"></i> Pago</span>`
          : '';
        return `
        <div class="srd-person ${isPre ? 'srd-person-pre' : ''}">
          ${avatar}
          <div class="srd-person-info">
            <span class="srd-person-name">${r.user_name || 'Usuário'}</span>
            <span class="srd-person-role">${roleIcon} ${typeLabel}</span>
          </div>
          ${paidBadge}
        </div>`;
      };

      const preHtml = preActivated.length
        ? `<div class="srd-subgroup-label srd-label-pre"><i class="fa fa-bolt"></i> Ativações antecipadas (${preActivated.length})</div>
           <div class="srd-people-list">${preActivated.map(renderPerson).join('')}</div>`
        : '';
      const resHtml = reserved.length
        ? `<div class="srd-subgroup-label srd-label-res"><i class="fa fa-calendar-check"></i> Reservas (${reserved.length})</div>
           <div class="srd-people-list">${reserved.map(renderPerson).join('')}</div>`
        : '';

      const totalPre = preActivated.length;
      const totalRes = reserved.length;
      const countLabel = totalPre
        ? `${totalPre} ativ. antecipada${totalPre>1?'s':''} · ${totalRes} reserva${totalRes!==1?'s':''}`
        : `${totalRes} reserva${totalRes!==1?'s':''}`;

      return `
      <div class="srd-group ${isToday ? 'srd-group-today' : ''}">
        <div class="srd-group-header">
          <div class="srd-group-date-info">
            <span class="srd-group-date">${isToday ? '⭐ HOJE — ' : ''}${dateLabel}</span>
            <span class="srd-group-title">${group.title}</span>
          </div>
          <span class="srd-count-badge">${countLabel}</span>
        </div>
        ${preHtml}${resHtml}
      </div>`;
    }).join('');

  } catch {
    section.style.display = 'none';
  }
}

/* ── Inicializa a aba de benefícios ─────────────────────────── */
async function initPromoTab(promos, barId) {
  // Detecta se hoje tem algum benefício ativo (via promotions OU scheduled_benefits)
  // Usa _todayStr() para respeitar a regra das 06h (madrugada pertence à noite anterior)
  const todayStr = _todayStr();
  const hasActivePromo = (promos || []).some(p => isPromoActive(p));

  // Verifica se há um agendamento para hoje no cache local
  const schedToday = getSchedules(barId || 'demo').find(s => s.date === todayStr);
  OZ._bslActiveToday = hasActivePromo || !!schedToday;

  // Reseta estado do calendário
  OZ.schedCalYear      = new Date().getFullYear();
  OZ.schedCalMonth     = new Date().getMonth();
  OZ.schedSelectedDate = null;
  OZ._bslIsEditing     = false;
  OZ._bslEditApiId     = null;

  // Fecha o painel de formulário
  const panel = document.getElementById('sched-form-panel');
  if (panel) panel.style.display = 'none';

  // Carrega agendamentos da API → atualiza cache → re-detecta hoje
  await bslLoadFromAPI(barId);
  const schedTodayFresh = getSchedules(barId || 'demo').find(s => s.date === todayStr);
  OZ._bslActiveToday = hasActivePromo || !!schedTodayFresh;

  renderSchedCalendar();
  loadSchedList(barId);
  loadSchedReservations(barId);
}

function previewBarPhoto() {
  const url        = (document.getElementById('bar-edit-photo')?.value || '').trim();
  const logoPreview= document.getElementById('bar-edit-logo-preview');
  if (logoPreview) {
    if (url) {
      logoPreview.style.backgroundImage    = `url('${url}')`;
      logoPreview.style.backgroundSize     = 'cover';
      logoPreview.style.backgroundPosition = 'center';
      logoPreview.textContent = '';
    } else {
      logoPreview.style.backgroundImage = '';
      logoPreview.textContent = '🍺';
    }
  }
}

/* ══════════════════════════════════
   UPLOAD DE FOTO — Avatar e Bar
══════════════════════════════════ */
function triggerAvatarUpload(role) {
  document.getElementById(`avatar-upload-${role}`)?.click();
}

async function handleAvatarUpload(event, role) {
  const file = event.target.files?.[0];
  if (!file) return;
  const user = OZ.currentUser;
  if (!user) return;
  // Lê como base64 para preview local
  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target.result;
    // ── helper: aplica foto na capa do hero ──
    const _applyHeroCover = (heroId, dataUrl) => {
      const heroEl = document.getElementById(heroId);
      if (!heroEl) return;
      if (dataUrl) {
        heroEl.style.backgroundImage    = `url('${dataUrl}')`;
        heroEl.style.backgroundSize     = 'cover';
        heroEl.style.backgroundPosition = 'center center';
        heroEl.classList.add('cp-hero-bg--has-photo');
        heroEl.classList.add('pf-banner--has-photo');
      } else {
        heroEl.style.backgroundImage    = '';
        heroEl.style.backgroundSize     = '';
        heroEl.style.backgroundPosition = '';
        heroEl.classList.remove('cp-hero-bg--has-photo');
        heroEl.classList.remove('pf-banner--has-photo');
      }
    };

    // Atualiza avatar visualmente + capa do hero
    if (role === 'cliente') {
      const avatarEl = document.getElementById('profile-avatar-big');
      if (avatarEl) {
        avatarEl.style.backgroundImage    = `url('${dataUrl}')`;
        avatarEl.style.backgroundSize     = 'cover';
        avatarEl.style.backgroundPosition = 'center';
        avatarEl.textContent = '';
      }
      // Atualiza capa do hero
      _applyHeroCover('cp-hero-bg', dataUrl);
      // Atualiza também o preview dentro do modal de edição
      const previewEl = document.getElementById('cedit-avatar-preview');
      if (previewEl) {
        previewEl.style.backgroundImage    = `url('${dataUrl}')`;
        previewEl.style.backgroundSize     = 'cover';
        previewEl.style.backgroundPosition = 'center';
        previewEl.textContent = '';
      }
    } else if (role === 'promoter') {
      const avatarEl = document.getElementById('prom-avatar-big');
      if (avatarEl) {
        avatarEl.style.backgroundImage    = `url('${dataUrl}')`;
        avatarEl.style.backgroundSize     = 'cover';
        avatarEl.style.backgroundPosition = 'center';
        avatarEl.textContent = '';
      }
      // Atualiza capa do hero
      _applyHeroCover('prx-hero-bg', dataUrl);
      // Atualiza também o preview dentro do formulário de edição
      const previewEl = document.getElementById('prx-photo-preview-avatar');
      if (previewEl) {
        previewEl.style.backgroundImage    = `url('${dataUrl}')`;
        previewEl.style.backgroundSize     = 'cover';
        previewEl.style.backgroundPosition = 'center';
        previewEl.textContent = '';
      }
    } else if (role === 'bar') {
      const avatarEl = document.getElementById('bar-avatar-big');
      if (avatarEl) {
        avatarEl.style.backgroundImage    = `url('${dataUrl}')`;
        avatarEl.style.backgroundSize     = 'cover';
        avatarEl.style.backgroundPosition = 'center';
        avatarEl.textContent = '';
      }
      // Atualiza capa do hero do perfil do bar
      _applyHeroCover('bex-profile-hero-bg', dataUrl);
    }
    // Salva URL no perfil do usuário (base64) se for usuário real
    if (!user.id.startsWith('demo-')) {
      try {
        await apiPatch(`tables/users/${user.id}`, { photo_url: dataUrl });
        // Atualiza estado local
        OZ.currentUser.photo_url = dataUrl;
        localStorage.setItem('oz_user', JSON.stringify(OZ.currentUser));
        showToast('Foto atualizada! 📸', 'success');
      } catch {
        showToast('Foto salva localmente', 'info');
        OZ.currentUser.photo_url = dataUrl;
        localStorage.setItem('oz_user', JSON.stringify(OZ.currentUser));
      }
    } else {
      showToast('Foto atualizada! 📸', 'success');
    }
  };
  reader.readAsDataURL(file);
}

// ── Handler do upload de foto no formulário de cadastro do bar ──
// Lê o arquivo como base64 e exibe preview; o dataUrl fica em OZ._regBarPhotoUrl
OZ._regBarPhotoUrl = '';
function handleRegBarPhoto(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    const errEl = document.getElementById('reg-bar-error');
    if (errEl) showAlertEl(errEl, 'Foto muito grande. Use uma imagem menor que 2 MB.');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    OZ._regBarPhotoUrl = dataUrl;
    const preview = document.getElementById('b-photo-preview');
    if (preview) {
      preview.style.backgroundImage = `url('${dataUrl}')`;
      preview.classList.add('has-photo');
    }
    const wrap = document.getElementById('b-photo-wrap');
    if (wrap) wrap.style.borderColor = 'rgba(74,222,128,.6)';
  };
  reader.readAsDataURL(file);
}

async function handleBarPhotoUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (file.size > 2 * 1024 * 1024) {
    showToast('Foto muito grande. Use uma imagem menor que 2 MB.', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target.result;

    // Atualiza o círculo de preview do logo
    const logoPreview = document.getElementById('bar-edit-logo-preview');
    if (logoPreview) {
      logoPreview.style.backgroundImage    = `url('${dataUrl}')`;
      logoPreview.style.backgroundSize     = 'cover';
      logoPreview.style.backgroundPosition = 'center';
      logoPreview.textContent = '';
    }

    // Atualiza campo URL oculto
    const urlInput = document.getElementById('bar-edit-photo');
    if (urlInput) urlInput.value = dataUrl;

    // Salva já na tabela bars e no currentUser para o cliente ver
    const barId = OZ.currentUser?.bar_id;
    if (OZ.currentUser) {
      OZ.currentUser.photo_url = dataUrl;
      localStorage.setItem('oz_user', JSON.stringify(OZ.currentUser));
    }

    if (barId && !barId.startsWith('demo-') && !barId.startsWith('fb')) {
      try {
        await apiPatch(`tables/bars/${barId}`, { photo_url: dataUrl });
        allBars = allBars.map(b => b.id === barId ? { ...b, photo_url: dataUrl } : b);
        showToast('Foto de perfil salva! 📸', 'success');
      } catch {
        showToast('Foto salva localmente 📸', 'info');
      }
    } else {
      showToast('Foto salva localmente 📸', 'info');
    }
  };
  reader.readAsDataURL(file);
}

/* ── Foto de CAPA (cover_url) ── */
async function handleBarCoverUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (file.size > 5 * 1024 * 1024) {
    showToast('Foto muito grande. Use uma imagem menor que 5 MB.', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target.result;

    // Preview da capa
    const img          = document.getElementById('bar-cover-preview-img');
    const placeholder  = document.getElementById('bar-cover-placeholder');
    const changeBadge  = document.getElementById('bar-cover-change-badge');
    const urlInput     = document.getElementById('bar-edit-cover');
    if (img)         { img.src = dataUrl; img.style.display = 'block'; }
    if (placeholder) placeholder.style.display = 'none';
    if (changeBadge) changeBadge.style.display = 'flex';
    if (urlInput)    urlInput.value = dataUrl;

    // Salva na tabela bars como cover_url
    const barId = OZ.currentUser?.bar_id;
    if (barId && !barId.startsWith('demo-') && !barId.startsWith('fb')) {
      try {
        await apiPatch(`tables/bars/${barId}`, { cover_url: dataUrl });
        allBars = allBars.map(b => b.id === barId ? { ...b, cover_url: dataUrl } : b);
        showToast('Foto de capa salva! 🖼️', 'success');
      } catch {
        showToast('Foto salva localmente 🖼️', 'info');
      }
    } else {
      showToast('Foto de capa atualizada! 🖼️', 'info');
    }
  };
  reader.readAsDataURL(file);
}

/* ── Galeria: upload de múltiplas fotos da galeria do celular ── */
async function handleBarGalleryUpload(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;

  const barId = OZ.currentUser?.bar_id;

  // Pega galeria atual
  let gallery = [];
  try {
    if (barId && !barId.startsWith('demo-')) {
      const barData = await apiGet(`tables/bars/${barId}`);
      gallery = Array.isArray(barData.gallery) ? barData.gallery : [];
    }
  } catch {}

  const MAX = 6;
  const slots = MAX - gallery.length;
  if (slots <= 0) {
    showToast('Galeria cheia! Remova uma foto antes de adicionar.', 'error');
    return;
  }

  const toAdd = files.slice(0, slots);
  if (files.length > slots) {
    showToast(`Apenas ${slots} foto(s) adicionada(s) (limite de ${MAX}).`, 'info');
  }

  showToast('Enviando fotos...', 'info');

  for (const file of toAdd) {
    if (file.size > 5 * 1024 * 1024) {
      showToast(`"${file.name}" é maior que 5 MB — ignorada.`, 'error');
      continue;
    }
    const dataUrl = await new Promise(res => {
      const r = new FileReader();
      r.onload = ev => res(ev.target.result);
      r.readAsDataURL(file);
    });
    gallery.push(dataUrl);
  }

  // Salva na tabela
  if (barId && !barId.startsWith('demo-') && !barId.startsWith('fb')) {
    try {
      await apiPatch(`tables/bars/${barId}`, { gallery });
      allBars = allBars.map(b => b.id === barId ? { ...b, gallery } : b);
    } catch { /* salva só localmente */ }
  }

  // Atualiza estado local
  if (OZ.currentUser) {
    OZ.currentUser.gallery = gallery;
    localStorage.setItem('oz_user', JSON.stringify(OZ.currentUser));
  }

  // Re-renderiza o grid
  renderBarGalleryGrid(gallery);
  showToast(`${toAdd.length} foto(s) adicionada(s) à galeria! 🖼️`, 'success');

  // Reseta o input para permitir re-selecionar
  event.target.value = '';
}

/* ── Renderiza o grid de galeria no painel do bar ── */
function renderBarGalleryGrid(gallery) {
  const grid = document.getElementById('bar-gallery-grid');
  if (!grid) return;
  grid.innerHTML = '';
  if (!gallery || !gallery.length) {
    grid.innerHTML = '<p class="bex-gallery-empty">Nenhuma foto na galeria ainda.</p>';
    return;
  }
  gallery.forEach((url, idx) => {
    const item = document.createElement('div');
    item.className = 'bex-gallery-item';
    item.innerHTML = `
      <img src="${url}" alt="Foto ${idx+1}" loading="lazy" />
      <button class="bex-gallery-del-btn" onclick="removeGalleryPhoto(${idx})" title="Remover">
        <i class="fa fa-times"></i>
      </button>`;
    grid.appendChild(item);
  });
}

/* ── Remove foto da galeria pelo índice ── */
async function removeGalleryPhoto(idx) {
  const barId = OZ.currentUser?.bar_id;
  let gallery = [];
  try {
    if (barId && !barId.startsWith('demo-')) {
      const barData = await apiGet(`tables/bars/${barId}`);
      gallery = Array.isArray(barData.gallery) ? [...barData.gallery] : [];
    }
  } catch {}
  gallery.splice(idx, 1);
  if (barId && !barId.startsWith('demo-') && !barId.startsWith('fb')) {
    try { await apiPatch(`tables/bars/${barId}`, { gallery }); } catch {}
  }
  if (OZ.currentUser) {
    OZ.currentUser.gallery = gallery;
    localStorage.setItem('oz_user', JSON.stringify(OZ.currentUser));
  }
  allBars = allBars.map(b => b.id === barId ? { ...b, gallery } : b);
  renderBarGalleryGrid(gallery);
  showToast('Foto removida.', 'info');
}

/* ── Adiciona foto à galeria por URL ── */
async function addGalleryPhoto() {
  const input = document.getElementById('bar-gallery-url-input');
  const url = (input?.value || '').trim();
  if (!url) { showToast('Cole uma URL válida.', 'error'); return; }

  const barId = OZ.currentUser?.bar_id;
  let gallery = [];
  try {
    if (barId && !barId.startsWith('demo-')) {
      const barData = await apiGet(`tables/bars/${barId}`);
      gallery = Array.isArray(barData.gallery) ? [...barData.gallery] : [];
    }
  } catch {}

  if (gallery.length >= 6) { showToast('Galeria cheia (máx 6 fotos).', 'error'); return; }
  gallery.push(url);
  if (input) input.value = '';

  if (barId && !barId.startsWith('demo-') && !barId.startsWith('fb')) {
    try { await apiPatch(`tables/bars/${barId}`, { gallery }); } catch {}
  }
  if (OZ.currentUser) {
    OZ.currentUser.gallery = gallery;
    localStorage.setItem('oz_user', JSON.stringify(OZ.currentUser));
  }
  allBars = allBars.map(b => b.id === barId ? { ...b, gallery } : b);
  renderBarGalleryGrid(gallery);
  showToast('Foto adicionada à galeria! 🖼️', 'success');
}

/* ── Toggle para mostrar/ocultar campo de URL alternativo ── */
/* ══════════════════════════════════
   TIME RANGE PICKER — horário de funcionamento
══════════════════════════════════ */

(function initHoursPicker() {
  /* Popula os <select> com horários de 30 em 30 min (00:00–03:30 = madrugada incluída) */
  function buildOptions(selectEl) {
    if (!selectEl) return;
    const slots = [];
    // 00:00 → 23:30 (ordem natural) + 00:00 → 05:00 rotulados como "madrugada"
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 30) {
        const hh   = String(h).padStart(2, '0');
        const mm   = String(m).padStart(2, '0');
        const label = `${hh}:${mm}`;
        slots.push({ value: label, label });
      }
    }
    // Adiciona slots de madrugada (00:00–06:00) com label extra para facilitar
    const dawn = [];
    for (let h = 0; h <= 6; h++) {
      for (let m = 0; m < 60; m += 30) {
        if (h === 6 && m > 0) break;
        const hh = String(h).padStart(2, '0');
        const mm = String(m).padStart(2, '0');
        dawn.push({ value: `+${hh}:${mm}`, label: `${hh}:${mm} (+1 dia)` });
      }
    }
    const allSlots = [...slots, ...dawn];
    selectEl.innerHTML = '<option value="">Selecionar</option>';
    allSlots.forEach(({ value, label }) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      selectEl.appendChild(opt);
    });
  }

  function init() {
    buildOptions(document.getElementById('bar-hours-open'));
    buildOptions(document.getElementById('bar-hours-close'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/* Ativa/desativa um dia da semana */
function toggleHoursDay(btn) {
  btn.classList.toggle('active');
  updateHoursPreview();
}

/* Valida e monta o preview + o valor do campo oculto */
function updateHoursPreview() {
  const openVal  = document.getElementById('bar-hours-open')?.value  || '';
  const closeVal = document.getElementById('bar-hours-close')?.value || '';
  const errorEl  = document.getElementById('trp-error');
  const previewEl= document.getElementById('trp-preview');
  const previewTx= document.getElementById('trp-preview-text');
  const hiddenEl = document.getElementById('bar-edit-hours');

  // Coleta dias selecionados
  const days = [...document.querySelectorAll('.trp-day.active')].map(b => b.dataset.day);

  // Sem horário selecionado → limpa tudo
  if (!openVal || !closeVal) {
    if (errorEl)   errorEl.style.display  = 'none';
    if (previewEl) previewEl.style.display = 'none';
    if (hiddenEl)  hiddenEl.value = '';
    return;
  }

  // Valida: fechamento ≠ abertura
  if (openVal === closeVal) {
    if (errorEl)   errorEl.style.display  = 'flex';
    if (previewEl) previewEl.style.display = 'none';
    if (hiddenEl)  hiddenEl.value = '';
    return;
  }
  if (errorEl) errorEl.style.display = 'none';

  // Formata label de horas (remove o prefixo "+" dos slots de madrugada +1)
  const fmtTime = v => v.replace(/^\+/, '');

  // Monta texto legível
  const daysStr = days.length ? days.join('–') + ' ' : '';
  const text    = `${daysStr}${fmtTime(openVal)}–${fmtTime(closeVal)}`;

  if (previewTx)  previewTx.textContent  = text;
  if (previewEl)  previewEl.style.display = 'flex';
  if (hiddenEl)   hiddenEl.value = text;
}

/* Carrega o valor salvo de volta no picker (ao abrir o painel) */
function loadHoursIntopicker(hoursStr) {
  if (!hoursStr) return;

  // Formato esperado: "Seg–Sex 18:00–02:00" ou "18:00–02:00"
  const dayNames  = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const timeRegex = /(\d{2}:\d{2})[–-](\+?\d{2}:\d{2})/;
  const match     = hoursStr.match(timeRegex);

  if (match) {
    const openSel  = document.getElementById('bar-hours-open');
    const closeSel = document.getElementById('bar-hours-close');
    if (openSel)  openSel.value  = match[1];
    if (closeSel) closeSel.value = match[2];
  }

  // Ativa os dias mencionados
  document.querySelectorAll('.trp-day').forEach(btn => {
    const active = dayNames.some(d => hoursStr.includes(d) && hoursStr.includes(btn.dataset.day));
    btn.classList.toggle('active', active);
  });

  updateHoursPreview();
}

function toggleUrlInput(type) {
  const wrap = document.getElementById(`bex-url-wrap-${type}`);
  if (!wrap) return;
  const isHidden = wrap.style.display === 'none' || !wrap.style.display;
  wrap.style.display = isHidden ? 'block' : 'none';
}

/* ── Preview da capa via URL ── */
function previewBarCover() {
  const url = (document.getElementById('bar-edit-cover')?.value || '').trim();
  const img         = document.getElementById('bar-cover-preview-img');
  const placeholder = document.getElementById('bar-cover-placeholder');
  const changeBadge = document.getElementById('bar-cover-change-badge');
  if (url) {
    if (img)         { img.src = url; img.style.display = 'block'; }
    if (placeholder) placeholder.style.display = 'none';
    if (changeBadge) changeBadge.style.display = 'flex';
  } else {
    if (img)         img.style.display = 'none';
    if (placeholder) placeholder.style.display = 'flex';
    if (changeBadge) changeBadge.style.display = 'none';
  }
}

function loadBarProfile() {
  const user = OZ.currentUser;
  if (!user) return;

  // Textos
  const nameEl  = document.getElementById('bar-profile-name');
  const emailEl = document.getElementById('bar-profile-email');
  if (nameEl)  nameEl.textContent  = user.bar_name || user.name;
  if (emailEl) emailEl.textContent = user.email;

  // Campos base (da tabela users)
  document.getElementById('bpinfo-genre').textContent = genreMap[user.bar_genre] || '—';
  document.getElementById('bpinfo-cnpj').textContent  = user.cnpj || '—';
  document.getElementById('bpinfo-resp').textContent  = user.responsible_name || '—';
  document.getElementById('bpinfo-hood').textContent  = user.neighborhood || '—';

  // Campos detalhados — busca na tabela bars para garantir dados atualizados
  const _setField = (rowId, valId, val) => {
    const rowEl = document.getElementById(rowId);
    const valEl = document.getElementById(valId);
    if (val && val.trim()) {
      if (valEl) valEl.textContent = val.trim();
      if (rowEl) rowEl.style.display = 'flex';
    } else {
      if (rowEl) rowEl.style.display = 'none';
    }
  };

  if (user.bar_id) {
    apiGet(`tables/bars/${user.bar_id}`).then(bar => {
      if (!bar) return;
      // Estilo (atualiza com dado mais fresco da tabela bars)
      const genreEl = document.getElementById('bpinfo-genre');
      if (genreEl) genreEl.textContent = genreMap[bar.genre] || genreMap[user.bar_genre] || '—';
      // Bairro
      const hoodEl = document.getElementById('bpinfo-hood');
      if (hoodEl) hoodEl.textContent = bar.neighborhood || user.neighborhood || '—';
      // Campos opcionais
      _setField('bpinfo-row-address',   'bpinfo-address',   bar.address);
      _setField('bpinfo-row-hours',     'bpinfo-hours',     bar.hours);
      _setField('bpinfo-row-instagram', 'bpinfo-instagram', bar.instagram ? `@${bar.instagram.replace(/^@/,'')}` : '');
      _setField('bpinfo-row-whatsapp',  'bpinfo-whatsapp',  bar.whatsapp);
      // Sobre o bar
      const releaseText = bar.release || bar.description || '';
      const secEl = document.getElementById('bpinfo-section-release');
      const relEl = document.getElementById('bpinfo-release');
      if (releaseText.trim()) {
        if (relEl) relEl.textContent = releaseText.trim();
        if (secEl) secEl.style.display = 'block';
      } else {
        if (secEl) secEl.style.display = 'none';
      }
    }).catch(() => {});
  }

  // Avatar com foto (novo layout executivo)
  const avatarEl = document.getElementById('bar-avatar-big');
  if (avatarEl && user.photo_url) {
    avatarEl.style.backgroundImage    = `url('${user.photo_url}')`;
    avatarEl.style.backgroundSize     = 'cover';
    avatarEl.style.backgroundPosition = 'center';
    avatarEl.textContent = '';
  }

  // ── Foto do perfil também na capa (hero) do bar ──
  const heroEl = document.getElementById('bex-profile-hero-bg');
  if (heroEl) {
    if (user.photo_url) {
      heroEl.style.backgroundImage    = `url('${user.photo_url}')`;
      heroEl.style.backgroundSize     = 'cover';
      heroEl.style.backgroundPosition = 'center center';
      heroEl.classList.add('cp-hero-bg--has-photo');
    } else {
      heroEl.style.backgroundImage    = '';
      heroEl.style.backgroundSize     = '';
      heroEl.style.backgroundPosition = '';
      heroEl.classList.remove('cp-hero-bg--has-photo');
    }
  }

}

/* ══════════════════════════════════════════════════════════
   PROMOTER — STATS CENTRALIZADAS + POLLER TEMPO REAL
══════════════════════════════════════════════════════════ */

/*
 * calcPromoterStats()
 * Faz todas as buscas de uma vez e retorna um objeto com:
 *   { referrals[], acts[], actsPerUser{}, totalEarned, refs# }
 * Referrals  = usuários com referred_by === promoter.id
 * Acts       = ativações pagas com promoter_id === promoter.id
 * actsPerUser= mapa user_id → número de ativações (max 3 por indicado)
 * totalEarned= ganho calculado localmente (R$5 × ativações, cap 3/user)
 */
async function calcPromoterStats(userId) {
  const MAX_ACTS_USER = 3;

  // ── Helper: fetch paginado direto no PostgREST com JWT do usuário logado ──
  // Usa filtro no servidor para evitar RLS genérico (user_id = auth.uid()) que
  // truncaria os resultados. Cada tabela é filtrada pelo campo correto.
  async function sbFetchFiltered(table, filterCol, filterVal, extraQs = '') {
    const limit  = 500;
    let   offset = 0;
    let   all    = [];
    const hdrs   = await sbHeaders({ 'Prefer': 'count=exact' });
    while (true) {
      const url = `${SB_URL}/${table}?${filterCol}=eq.${encodeURIComponent(filterVal)}&limit=${limit}&offset=${offset}&order=created_at.desc${extraQs ? '&' + extraQs : ''}`;
      const r   = await fetch(url, { headers: hdrs, cache: 'no-store' });
      if (!r.ok) throw new Error(`sbFetchFiltered ${table}: ${r.status}`);
      const rows = await r.json();
      if (!Array.isArray(rows) || !rows.length) break;
      all = all.concat(rows);
      if (rows.length < limit) break;
      offset += limit;
    }
    return all;
  }

  // ── Busca em paralelo com filtros precisos no servidor ───────────────────
  // • users:       referred_by = userId     → apenas indicados deste promoter
  // • activations: promoter_id = userId     → ativações que geraram comissão
  // • activations: pick_promoter = userId   → ativações de pick (indicação de bar)
  // • earnings:    promoter_id = userId     → todos os ganhos deste promoter
  // Nenhuma das buscas depende de allUsers/allActs globais — bypassa RLS user_id.
  const [referrals, actsRef, actsPick, allEarnings] = await Promise.all([
    sbFetchFiltered('users',       'referred_by',    userId),
    sbFetchFiltered('activations', 'promoter_id',    userId),
    sbFetchFiltered('activations', 'pick_promoter',  userId),
    sbFetchFiltered('earnings',    'promoter_id',    userId),
  ]);

  const referralIds = new Set(referrals.map(u => u.id));

  // ── Nomes dos indicados para exibição ───────────────────────────────────
  // referrals já é a lista completa; monta mapa id→nome
  const userNameMap = {};
  referrals.forEach(u => { userNameMap[u.id] = u.name || u.email || u.id.slice(0, 8); });
  // adiciona nomes de quem ativou via pick (pode ser cliente não-indicado)
  // buscamos o nome a partir do user_id gravado na ativação (best-effort)
  actsRef.forEach(a => {
    if (a.user_id && !userNameMap[a.user_id] && a.user_name) {
      userNameMap[a.user_id] = a.user_name;
    }
  });
  actsPick.forEach(a => {
    if (a.user_id && !userNameMap[a.user_id] && a.user_name) {
      userNameMap[a.user_id] = a.user_name;
    }
  });

  // ── actsById: mapa activation_id → activation (ref + pick) ───────────────
  // Usado pela aba Ativações para cruzar earning → detalhes da ativação.
  const actsById = new Map();
  [...actsRef, ...actsPick].forEach(a => { if (a.id) actsById.set(a.id, a); });

  // ── commissionedEarnings: todos os earnings deste promoter ordenados ────────
  // Fonte canônica da aba Ativações. Todos os rows com promoter_id = userId
  // já são comissões reais — o campo origin guarda o nome do bar (não o tipo),
  // então não há filtro por origin. O join com actsById usa activation_id.
  const toTsE = v => typeof v === 'number' ? v : new Date(v || 0).getTime();
  const commissionedEarnings = [...allEarnings]
    .sort((a, b) => toTsE(b.created_at) - toTsE(a.created_at));

  // ── actsPerUser: contagem das ativações por indicado (fonte: earnings) ───
  // refEarnings = earnings cujo activation foi via promoter_id (indicação direta).
  // Identifica pelo activation: se actsById tem a activation e ela tem promoter_id=userId.
  // Fallback: todos os earnings com user_id preenchido (cada um = 1 ativação comissionada).
  const refEarnings = allEarnings.filter(e => {
    if (!e.user_id) return false;
    // Se temos a activation, confirma que é indicação (promoter_id), não só pick
    if (e.activation_id) {
      const act = actsById.get(e.activation_id);
      if (act) return act.promoter_id === userId;
    }
    return true; // sem activation no mapa: inclui (best-effort)
  });

  const actsPerUser  = {};
  let   totalEarnedRef = 0;
  refEarnings.forEach(e => {
    const uid = e.user_id;
    if (!uid) return;
    actsPerUser[uid] = (actsPerUser[uid] || 0) + 1;
    totalEarnedRef  += parseFloat(e.amount) || 0;
  });

  // ── acts: ativações dos indicados a exibir no histórico ─────────────────
  // Usa actsRef (promoter_id = userId) filtrado pelos tipos internos excluídos.
  const EXCLUDED_TYPES = new Set(['free_credit', 'free_credit_used', 'free_used', 'night_checkin']);
  const acts = actsRef.filter(a => !EXCLUDED_TYPES.has(a.type));

  // ── pickActs: ativações por indicação de bar ────────────────────────────
  const pickActs = actsPick.filter(a =>
    a.type !== 'free_credit' && a.type !== 'free_credit_used' && a.type !== 'free_used'
  );

  // ── Ganhos de pick (indicação de bar) ───────────────────────────────────
  // pick = earnings cuja activation tem pick_promoter = userId (não promoter_id)
  const pickEarnings = allEarnings.filter(e => {
    if (!e.activation_id) return false;
    const act = actsById.get(e.activation_id);
    if (act) return act.pick_promoter === userId && act.promoter_id !== userId;
    return false;
  });
  const totalEarnedPick = pickEarnings.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

  const totalEarned = parseFloat((totalEarnedRef + totalEarnedPick).toFixed(2));

  // ── earnedPerUser: total ganho por indicado ──────────────────────────────
  const earnedPerUser = {};
  refEarnings.forEach(e => {
    const uid = e.user_id;
    if (!uid) return;
    earnedPerUser[uid] = (earnedPerUser[uid] || 0) + (parseFloat(e.amount) || 0);
  });

  return { referrals, referralIds, acts, pickActs, actsById, commissionedEarnings, actsPerUser, earnedPerUser, totalEarned, totalEarnedRef, totalEarnedPick, pickEarnings, userNameMap };
}

/* ── Poller único — atualiza todas as telas do promoter ── */
OZ.promoterStatsPoller = null;
OZ._promoterStatsCache = null; // último resultado de calcPromoterStats

async function _refreshPromoterStats() {
  const user = OZ.currentUser;
  if (!user || user.role !== 'promoter') return;

  // Busca o saldo atualizado do banco (pode ter sido alterado por outra ativação)
  try {
    const freshUser = await apiGet(`tables/users/${user.id}`);
    if (freshUser?.balance !== undefined) {
      OZ.currentUser.balance = freshUser.balance;
    }
  } catch { /* usa saldo local se API falhar */ }

  try {
    const stats = await calcPromoterStats(user.id);
    OZ._promoterStatsCache = stats;

    // Atualiza TODAS as telas que estiverem no DOM

    /* ── HOME ── */
    const balEl = document.getElementById('promo-balance');
    if (balEl) balEl.textContent = `R$ ${(OZ.currentUser.balance||0).toFixed(2).replace('.',',')}`;

    _updateEl('promo-total-refs',   stats.referrals.length);
    const totalActsCombined = stats.acts.length + (stats.pickActs ? stats.pickActs.length : 0);
    _updateEl('promo-total-acts',   totalActsCombined);
    const detailEl = document.getElementById('promo-acts-detail');
    if (detailEl) {
      const pickLen = stats.pickActs ? stats.pickActs.length : 0;
      if (pickLen > 0 || stats.acts.length > 0) {
        detailEl.textContent = `${stats.acts.length} convidado · ${pickLen} por indicação`;
      } else {
        detailEl.textContent = '';
      }
    }
    _updateEl('promo-total-earned', `R$${stats.totalEarned.toFixed(2).replace('.',',')}`);

    // Gráficos e tabela da home
    const promoHomeScreen = document.getElementById('screen-promoter-home');
    if (promoHomeScreen?.classList.contains('active')) {
      _renderPromoHomeCharts(stats);
    }

    /* ── PERFIL (stats do hero) ── */
    _updateEl('prom-stat-refs',   stats.referrals.length);
    _updateEl('prom-stat-acts',   stats.acts.length + (stats.pickActs ? stats.pickActs.length : 0));
    _updateEl('prom-stat-earned', `R$${stats.totalEarned.toFixed(2).replace('.',',')}`);
    // Badges flutuantes do novo hero
    const pfRefs   = document.getElementById('pf-badge-refs-val');
    const pfEarned = document.getElementById('pf-badge-earned-val');
    if (pfRefs)   pfRefs.textContent   = stats.referrals.length;
    if (pfEarned) pfEarned.textContent = `R$${stats.totalEarned.toFixed(2).replace('.',',')}`;

    /* ── HISTÓRICO: re-renderiza só se a tela estiver ativa ── */
    const histScreen = document.getElementById('screen-promoter-history');
    if (histScreen?.classList.contains('active')) {
      _renderPromoterHistory(stats);
    }

  } catch { /* silencioso — tenta no próximo ciclo */ }
}

function _updateEl(id, val) {
  const el = document.getElementById(id);
  if (el && el.textContent !== String(val)) el.textContent = val;
}

function startPromoterStatsPoller() {
  stopPromoterStatsPoller();
  _refreshPromoterStats();                                    // carga imediata
  OZ.promoterStatsPoller = setInterval(_refreshPromoterStats, 10_000); // a cada 10 s
}

function stopPromoterStatsPoller() {
  if (OZ.promoterStatsPoller) {
    clearInterval(OZ.promoterStatsPoller);
    OZ.promoterStatsPoller = null;
  }
}

/* ══════════════════════════════════
   PROMOTER — HOME
══════════════════════════════════ */
async function loadPromoterHome() {
  const user = OZ.currentUser;
  if (!user) return;

  // ── Controle de aprovação ─────────────────────────────────────
  const approved = !user.approval_status || user.approval_status === 'approved';

  // Banner de pendente
  const bannerEl   = document.getElementById('promoter-approval-banner');
  if (bannerEl) bannerEl.style.display = approved ? 'none' : 'block';

  // Card de compartilhar convite: oculta se não aprovado
  const shareCard = document.getElementById('promoter-share-card');
  if (shareCard) shareCard.style.display = approved ? '' : 'none';

  // Código de convite: só exibe se aprovado
  const code   = approved ? (user.referral_code || generateReferralCode(user.name)) : '——';
  const codeEl = document.getElementById('promo-code-text');
  if (codeEl) codeEl.textContent = code;
  if (approved) updatePromoterShareUI();

  // Saudação
  const greetEl = document.getElementById('promo-greeting');
  if (greetEl) {
    const h = new Date().getHours();
    const emoji = h < 12 ? '☀️' : h < 18 ? '🌤️' : '🌙';
    const greet = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
    greetEl.textContent = `${greet}, ${(user.name||'Promoter').split(' ')[0]} ${emoji}`;
  }

  // Exibe valores do cache imediatamente enquanto carrega
  const cached = OZ._promoterStatsCache;
  if (cached) {
    _updateEl('promo-balance',      `R$ ${(OZ.currentUser.balance||0).toFixed(2).replace('.',',')}`);
    _updateEl('promo-total-refs',   cached.referrals.length);
    const cachedTotalActs = cached.acts.length + (cached.pickActs ? cached.pickActs.length : 0);
    _updateEl('promo-total-acts',   cachedTotalActs);
    const cachedDetailEl = document.getElementById('promo-acts-detail');
    if (cachedDetailEl) {
      const pickLen = cached.pickActs ? cached.pickActs.length : 0;
      if (pickLen > 0 || cached.acts.length > 0) {
        cachedDetailEl.textContent = `${cached.acts.length} convidado · ${pickLen} por indicação`;
      } else {
        cachedDetailEl.textContent = '';
      }
    }
    _updateEl('promo-total-earned', `R$${cached.totalEarned.toFixed(2).replace('.',',')}`);
    _renderPromoHomeCharts(cached);
  } else {
    const balEl = document.getElementById('promo-balance');
    if (balEl) balEl.textContent = `R$ ${(user.balance||0).toFixed(2).replace('.',',')}`;
  }

  startPromoterStatsPoller();
}

/* ─ Gráficos e tabelas da home do promoter ─ */
let _promoEarningsChart = null;
let _promoGaugeChart    = null;
function _renderPromoHomeCharts(stats) {
  // ── Ganhos últimos 7 dias — Chart.js (indicação + pick) ──
  const canvas  = document.getElementById('promo-weekly-chart');
  const totalEl = document.getElementById('promo-weekly-total');

  if (canvas) {
    const acts        = stats.acts        || [];
    const pickActs    = stats.pickActs    || [];
    const pickEarnings = stats.pickEarnings || [];
    const now = new Date();

    // Monta array dos últimos 7 dias (hoje = índice 6)
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const next = new Date(d); next.setDate(d.getDate() + 1);

      // Ganho por indicação de usuário (R$5 por ativação, cap 5/user)
      const dayActs = acts.filter(a => {
        const t = new Date(a.created_at); return t >= d && t < next;
      });
      const earnRef = dayActs.reduce((s, a) => s + (parseFloat(a.commission) || 5), 0);

      // Ganho por pick de bar (registrado em earnings)
      const dayPickEarnings = pickEarnings.filter(e => {
        const t = new Date(e.created_at); return t >= d && t < next;
      });
      const earnPick = dayPickEarnings.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

      const total = parseFloat((earnRef + earnPick).toFixed(2));

      const weekDay = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][d.getDay()];
      const isToday = i === 0;
      days.push({ label: isToday ? 'Hoje' : weekDay, earnRef, earnPick, total, isToday });
    }

    // Total do período
    const grandTotal = days.reduce((s, d) => s + d.total, 0);
    if (totalEl) totalEl.textContent = `R$ ${grandTotal.toFixed(2).replace('.', ',')}`;

    const labels   = days.map(d => d.label);
    const dataRef  = days.map(d => d.earnRef);
    const dataPick = days.map(d => d.earnPick);

    // Destrói gráfico anterior antes de recriar
    if (_promoEarningsChart) { _promoEarningsChart.destroy(); _promoEarningsChart = null; }

    const ctx = canvas.getContext('2d');

    // Gradiente dourado para barras de indicação
    const gradRef = ctx.createLinearGradient(0, 0, 0, 160);
    gradRef.addColorStop(0, 'rgba(240,200,74,0.95)');
    gradRef.addColorStop(1, 'rgba(200,146,42,0.75)');

    // Gradiente roxo para barras de pick
    const gradPick = ctx.createLinearGradient(0, 0, 0, 160);
    gradPick.addColorStop(0, 'rgba(167,139,250,0.90)');
    gradPick.addColorStop(1, 'rgba(124,58,237,0.65)');

    _promoEarningsChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Ativ. convidado',
            data: dataRef,
            backgroundColor: gradRef,
            borderRadius: 6,
            borderSkipped: false,
            order: 1,
          },
          {
            label: 'Ativ. por indicação',
            data: dataPick,
            backgroundColor: gradPick,
            borderRadius: 6,
            borderSkipped: false,
            order: 2,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            labels: {
              color: 'rgba(255,255,255,0.55)',
              font: { size: 11, weight: '600' },
              boxWidth: 10,
              boxHeight: 10,
              borderRadius: 3,
              useBorderRadius: true,
              padding: 12,
            }
          },
          tooltip: {
            backgroundColor: 'rgba(20,20,28,0.95)',
            borderColor: 'rgba(0,245,255,0.3)',
            borderWidth: 1,
            titleColor: '#3cf7ff',
            bodyColor: 'rgba(255,255,255,0.75)',
            padding: 10,
            callbacks: {
              label: ctx => {
                const v = ctx.parsed.y;
                return `  ${ctx.dataset.label}: R$ ${v.toFixed(2).replace('.', ',')}`;
              },
              footer: items => {
                const total = items.reduce((s, i) => s + i.parsed.y, 0);
                return `  Total: R$ ${total.toFixed(2).replace('.', ',')}`;
              }
            }
          }
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: {
              color: 'rgba(255,255,255,0.45)',
              font: { size: 11, weight: '700' },
            },
            border: { display: false },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            grid: {
              color: 'rgba(255,255,255,0.05)',
              drawTicks: false,
            },
            border: { display: false },
            ticks: {
              color: 'rgba(255,255,255,0.35)',
              font: { size: 10 },
              maxTicksLimit: 5,
              callback: v => v === 0 ? '' : `R$${v}`,
            }
          }
        }
      }
    });
  }

  // Gauge — barra de progresso (novo painel PDASH)
  // Usa apenas ganhos de indicação de convidado (exclui pick de bar)
  {
    const refsLen = stats.referrals.length;
    const maxPotential = refsLen * 15;
    const earned       = stats.totalEarnedRef || 0;  // só ganhos de convidados, sem pick
    const pct          = maxPotential > 0 ? Math.min(100, Math.round((earned / maxPotential) * 100)) : 0;
    const fillEl = document.getElementById('promo-gauge-fill');
    const pctEl  = document.getElementById('promo-gauge-pct');
    if (fillEl) fillEl.style.width = pct + '%';
    if (pctEl)  pctEl.textContent  = pct + '%';
    // Taxa de conversão: ativações de convidados / (convidados × 3)
    // Numerador: total de ativações comissionadas de convidados (exclui pick de bar)
    // = soma dos valores em actsPerUser (cada valor = nº de ativações daquele convidado, cap 3)
    const actsPerUser = stats.actsPerUser || {};
    const totalActsForConv = Object.values(actsPerUser).reduce((s, n) => s + n, 0);
    const convRate = refsLen > 0 ? Math.min(100, Math.round((totalActsForConv / (refsLen * 3)) * 100)) : 0;
    const convEl = document.getElementById('promo-conv-rate');
    if (convEl) convEl.textContent = convRate + '% conv.';
  }

  // Funil de conversão
  const refs       = stats.referrals.length;
  const acts       = stats.acts.length + (stats.pickActs ? stats.pickActs.length : 0);
  const maxActs    = refs * 3; // total conversível (3 ativações por convidado)
    // Completos = indicados que atingiram 3 ativações
  const actsPerUser = stats.actsPerUser || {};
  const completed   = Object.values(actsPerUser).filter(n => n >= 3).length;

  // Helper: atualiza barra e label com formato "count/max" opcional
  const setF = (barId, valId, count, max, label) => {
    const b = document.getElementById(barId), v = document.getElementById(valId);
    if (b) b.style.width = Math.round((count / (max || 1)) * 100) + '%';
    if (v) v.textContent = label !== undefined ? label : count;
  };

  const actsGuest = stats.acts.length; // só ativações de convidado (sem pick)
  setF('promo-funnel-refs-bar', 'promo-funnel-refs-val', refs,       refs || 1,    refs);
  setF('promo-funnel-acts-bar', 'promo-funnel-acts-val', actsGuest,  maxActs || 1, `${actsGuest}/${maxActs}`);
  setF('promo-funnel-comp-bar', 'promo-funnel-comp-val', completed, refs    || 1,   completed);

  // Tabela de indicados
  _renderPromoRefsTable(stats);
}

/* ─ Tabela de indicados na home do promoter ─ */
function _renderPromoRefsTable(stats) {
  const el = document.getElementById('promo-refs-table');
  if (!el) return;
  const refs = stats.referrals || [];
  if (!refs.length) { el.innerHTML = '<div class="pdash-loading"><i class="fa fa-users"></i> Sem indicados ainda</div>'; return; }
  const actsPerUser  = stats.actsPerUser  || {};
  const earnedPerUser = stats.earnedPerUser || {};
  // Ordena mais recentes primeiro e exibe apenas os 3 primeiros
  const toTs = v => typeof v === 'number' ? v : new Date(v || 0).getTime();
  const sorted = [...refs].sort((a, b) => toTs(b.created_at) - toTs(a.created_at));
  el.innerHTML = sorted.slice(0, 3).map(r => {
      const acts    = actsPerUser[r.id]  || 0;  // ativações comissionadas (1-3)
    const earned  = earnedPerUser[r.id] || 0; // ganho real registrado em earnings
    const isMax   = acts >= 3;
    const badgeClass = isMax ? 'dbd-tr-badge-gold' : acts > 0 ? 'dbd-tr-badge-cyan' : 'dbd-tr-badge-purple';
    const badgeLabel = isMax ? '✓ Max' : acts > 0 ? `${acts}/3` : 'Pendente';
    return `<div class="dbd-table-row">
      <div><div class="dbd-tr-name">${r.name || 'Cliente'}</div></div>
      <div class="dbd-tr-type">${acts}/3</div>
      <div class="dbd-tr-date" style="color:#1db954;font-weight:700">R$${earned.toFixed(2).replace('.',',')}</div>
      <div><span class="dbd-tr-badge ${badgeClass}">${badgeLabel}</span></div>
    </div>`;
  }).join('');
}

/* ══════════════════════════════════
   PROMOTER — HISTÓRICO
══════════════════════════════════ */
async function loadPromoterHistory() {
  const user = OZ.currentUser;
  if (!user) return;

  // Skeleton enquanto carrega
  const refsListEl  = document.getElementById('ph-referrals-list');
  const actsListEl  = document.getElementById('ph-acts-list');
  const earnListEl  = document.getElementById('ph-earnings-list');
  if (refsListEl) refsListEl.innerHTML = skeletonCards(2, '56px');
  if (actsListEl) actsListEl.innerHTML = skeletonCards(2, '56px');
  if (earnListEl) earnListEl.innerHTML = skeletonCards(2, '56px');

  // Se há cache recente usa imediatamente, senão busca
  if (OZ._promoterStatsCache) {
    _renderPromoterHistory(OZ._promoterStatsCache);
  } else {
    try {
      const stats = await calcPromoterStats(user.id);
      OZ._promoterStatsCache = stats;
      _renderPromoterHistory(stats);
    } catch { /* silencioso */ }
  }

  startPromoterStatsPoller();
}

/* Renderiza os 3 painéis do histórico com os dados calculados */
function _renderPromoterHistory(stats) {
  const { referrals, actsById, commissionedEarnings, actsPerUser, totalEarned, totalEarnedRef, totalEarnedPick, pickEarnings, userNameMap } = stats;

  /* ── INDICADOS ── */
  const refsListEl   = document.getElementById('ph-referrals-list');
  const refsEmptyEl  = document.getElementById('ph-referrals-empty');
  const refsHeaderEl = document.getElementById('ph-referrals-header');
  const refsCountEl  = document.getElementById('ph-refs-count');
  if (refsListEl) {
    refsListEl.innerHTML = '';
    if (!referrals.length) {
      if (refsEmptyEl)  refsEmptyEl.style.display  = 'flex';
      if (refsHeaderEl) refsHeaderEl.style.display = 'none';
    } else {
      if (refsEmptyEl)  refsEmptyEl.style.display  = 'none';
      if (refsHeaderEl) refsHeaderEl.style.display = 'flex';
      if (refsCountEl)  refsCountEl.textContent    =
        `${referrals.length} indicado${referrals.length !== 1 ? 's' : ''}`;

      // Normaliza created_at para ms (pode vir como string ISO ou number)
      const toTs = v => typeof v === 'number' ? v : new Date(v || 0).getTime();

      // Ordena mais recentes primeiro
      const sorted = [...referrals].sort((a, b) => toTs(b.created_at) - toTs(a.created_at));

      sorted.forEach(r => {
        const userActs = actsPerUser[r.id] || 0;
        const maxed    = userActs >= 3;
        const progress = Math.min(100, (userActs / 3) * 100);
        const earned   = userActs * 5;

        // Status visual: Novo (0 ativ.) | Ativo (1-2) | Completo (≥3)
        let statusLabel, statusClass;
        if (maxed) {
          statusLabel = 'Completo'; statusClass = 'ph-ref-status-done';
        } else if (userActs > 0) {
          statusLabel = 'Ativo';    statusClass = 'ph-ref-status-active';
        } else {
          statusLabel = 'Novo';     statusClass = 'ph-ref-status-new';
        }

        const dateStr = r.created_at
          ? new Date(toTs(r.created_at)).toLocaleDateString('pt-BR')
          : '—';

        const initial = (r.name || r.email || '?')[0].toUpperCase();

        const el = document.createElement('div');
        el.className = 'ph-ref-item';
        el.innerHTML = `
          <div class="ph-ref-avatar">${initial}</div>
          <div class="ph-ref-body">
            <div class="ph-ref-name-row">
              <p class="ph-ref-name">${r.name || r.email || '—'}</p>
              <span class="ph-ref-status ${statusClass}">${statusLabel}</span>
            </div>
            <p class="ph-ref-meta">Entrou em ${dateStr}</p>
            <div class="ph-ref-progress-wrap">
              <div class="ph-ref-progress-bar">
                <div class="ph-ref-progress-fill${maxed ? ' ph-ref-progress-maxed' : ''}"
                     style="width:${progress}%"></div>
              </div>
              <div class="ph-ref-progress-footer">
                <span class="ph-ref-progress-lbl">
                  ${userActs}/3 ativações
                  ${maxed ? ' · <span class="ph-ref-maxed-tag">Cap atingido</span>' : ''}
                </span>
                <span class="ph-ref-earned${maxed ? ' ph-ref-earned-maxed' : earned > 0 ? ' ph-ref-earned-active' : ''}">
                  R$${earned},00
                </span>
              </div>
            </div>
          </div>`;
        refsListEl.appendChild(el);
      });
    }
  }

  /* ── ATIVAÇÕES ── */
  // Regra: mostrar apenas ativações com status='active' que geraram earnings reais
  // para este promoter. Fonte de earnings: commissionedEarnings (origem ref/pick).
  // Cruzamento: e.activation_id → actsById para obter a activation e confirmar status.
  // O amount exibido é o e.amount do earning — valor real comissionado (R$1, R$4, R$5…).
  const actsListEl  = document.getElementById('ph-acts-list');
  const actsEmptyEl = document.getElementById('ph-acts-empty');
  if (actsListEl) {
    actsListEl.innerHTML = '';

    const TYPE_LABEL = {
      individual:         '🎯 Individual',
      advance_individual: '🎯 Antecip.',
      night:              '🌙 Noite Toda',
      night_link:         '🌙 Link da Noite',
      advance_night:      '🌙 Noite Antecip.',
      advance_free:       '🎁 Grátis Antecip.',
    };

    const toTs = v => typeof v === 'number' ? v : new Date(v || 0).getTime();

    // Filtra: apenas earnings cujo activation_id aponta para uma activation active.
    // Para pick_commission onde a activation pode não estar no actsById (activation
    // de outro promoter que indicou o bar), inclui se não houver activation no mapa
    // mas descarta se a activation existir com status diferente de 'active'.
    const activeEarnings = commissionedEarnings.filter(e => {
      if (!e.activation_id) return false;                     // sem activation_id → descarta
      const act = actsById.get(e.activation_id);
      if (!act) return false;                                  // activation fora do mapa → descarta
      return act.status === 'active';                          // apenas ativas
    });

    if (!activeEarnings.length) {
      if (actsEmptyEl) actsEmptyEl.style.display = 'flex';
    } else {
      if (actsEmptyEl) actsEmptyEl.style.display = 'none';

      activeEarnings.slice(0, 80).forEach(e => {
        // Activation confirmada (status=active)
        const act     = actsById.get(e.activation_id);
        const barName = act.bar_name || e.bar_name || '—';
        const actType = act.type     || '';

        // Data: usa created_at da activation (quando o cliente ativou),
        // com fallback para created_at do earning
        const ts      = toTs(act.created_at || e.created_at);
        const dateStr = ts ? new Date(ts).toLocaleDateString('pt-BR') : '—';

        // Nome do cliente: activation.user_name > userNameMap[act.user_id] > earning fallback
        const clientName = act.user_name
          || (act.user_id  && userNameMap[act.user_id]  ? userNameMap[act.user_id]  : null)
          || (e.user_id    && userNameMap[e.user_id]    ? userNameMap[e.user_id]    : null)
          || e.user_name
          || 'Cliente';

        const originLabel = (() => {
          // origin no banco = nome do bar, não tipo de comissão.
          // Deriva o label pelo reason do earning ou pela relação da activation.
          const reason = (e.reason || '').toLowerCase();
          if (reason.includes('ref+pick') || reason.includes('ref_and_pick')) return '⭐ Ind. + Pick';
          if (reason.includes('pick'))    return '📍 Indicação de Bar';
          if (reason.includes('ref'))     return '👤 Indicado';
          // fallback: promoter_id vs pick_promoter
          if (act.promoter_id === userId && act.pick_promoter === userId) return '⭐ Ind. + Pick';
          if (act.pick_promoter === userId) return '📍 Indicação de Bar';
          return '👤 Indicado';
        })();
        const typeLabel   = TYPE_LABEL[actType] || (actType ? actType : '');
        const metaParts   = [originLabel, typeLabel, barName, dateStr].filter(Boolean);

        // Amount: valor real comissionado gravado no earning (R$1, R$4, R$5…)
        const amt    = parseFloat(e.amount || 0);
        const amtStr = `+R$${amt.toFixed(2).replace('.', ',')}`;

        const initial = (clientName[0] || '?').toUpperCase();
        const el = document.createElement('div');
        el.className = 'ph-act-item';
        el.innerHTML = `
          <div class="ph-act-avatar">${initial}</div>
          <div class="ph-act-body">
            <p class="ph-act-name">${clientName}</p>
            <p class="ph-act-meta">${metaParts.join(' · ')}</p>
          </div>
          <span class="ph-acts-earn-tag">${amtStr}</span>`;
        actsListEl.appendChild(el);
      });
    }
  }

  /* ── GANHOS (indicação de usuário + indicação de bar) ── */
  const earnListEl  = document.getElementById('ph-earnings-list');
  const earnEmptyEl = document.getElementById('ph-earnings-empty');
  if (earnListEl) {
    earnListEl.innerHTML = '';

    // --- Ganhos por indicação de usuário (R$5, cap 3) ---
    const gainActs = [];
    const tempCount = {};
    const toTs2 = v => typeof v === 'number' ? v : new Date(v || 0).getTime();
    const sorted = [...acts].sort((a, b) => toTs2(b.created_at) - toTs2(a.created_at));
    sorted.forEach(a => {
      const uid = a.user_id;
      if (!uid) return;
      if (!tempCount[uid]) tempCount[uid] = 0;
      if (tempCount[uid] < 3) { gainActs.push(a); tempCount[uid]++; }
    });

    // --- Ganhos por indicação de bar (20%) ---
    const toTs3 = v => typeof v === 'number' ? v : new Date(v || 0).getTime();
    const pickSorted = [...(pickEarnings || [])].sort((a, b) => toTs3(b.created_at) - toTs3(a.created_at));

    // Monta lista unificada ordenada por data
    const allItems = [
      ...gainActs.slice(0, 30).map(a => ({
        ts:    toTs3(a.created_at),
        type:  'ref',
        label: `${userNameMap[a.user_id] || 'Cliente'} ativou no ${a.bar_name || 'Bar'}`,
        value: '+R$5,00',
        meta:  formatDate(a.created_at),
      })),
      ...pickSorted.slice(0, 30).map(e => ({
        ts:    toTs3(e.created_at),
        type:  'pick',
        label: e.reason || 'Ativação por indicação',
        value: `+R$${parseFloat(e.amount || 0).toFixed(2).replace('.',',')}`,
        meta:  formatDate(e.created_at),
      })),
    ].sort((a, b) => b.ts - a.ts).slice(0, 40);

    if (!allItems.length) {
      if (earnEmptyEl) earnEmptyEl.style.display = 'flex';
    } else {
      if (earnEmptyEl) earnEmptyEl.style.display = 'none';
      allItems.forEach(item => {
        const el = document.createElement('div');
        el.className = 'ph-earn-item';
        const iconClass  = item.type === 'pick' ? 'fa-star ph-earn-icon-pick' : 'fa-coins';
        const labelBadge = item.type === 'pick'
          ? '<span class="ph-earn-pick-tag">Por indicação</span>'
          : '';
        el.innerHTML = `
          <div class="ph-earn-icon"><i class="fa ${iconClass}"></i></div>
          <div class="ph-earn-body">
            <p class="ph-earn-name">${item.label} ${labelBadge}</p>
            <p class="ph-earn-meta">${item.meta}</p>
          </div>
          <span class="ph-earn-value ${item.type === 'pick' ? 'ph-earn-value-pick' : ''}">${item.value}</span>`;
        earnListEl.appendChild(el);
      });
    }
  }
}

/* ══════════════════════════════════
   PROMOTER — PERFIL
══════════════════════════════════ */
function switchPromoterHistoryTab(tab) {
  // Atualiza abas apenas dentro da tela de histórico
  const screen = document.getElementById('screen-promoter-history');
  if (!screen) return;
  screen.querySelectorAll('.inner-tab').forEach((b, i) => {
    const tabs = ['indicados', 'ativacoes', 'ganhos'];
    b.classList.toggle('active', tabs[i] === tab);
  });
  screen.querySelectorAll('.inner-tab-content').forEach(c => c.classList.remove('active'));
  const el = document.getElementById(`ph-tab-${tab}`);
  if (el) el.classList.add('active');
}

async function loadPromoterProfile() {
  const user = OZ.currentUser;
  if (!user) return;

  // Avatar
  const avatarEl = document.getElementById('prom-avatar-big');
  if (avatarEl) {
    if (user.photo_url) {
      avatarEl.style.backgroundImage    = `url('${user.photo_url}')`;
      avatarEl.style.backgroundSize     = 'cover';
      avatarEl.style.backgroundPosition = 'center';
      avatarEl.textContent = '';
    } else {
      avatarEl.style.backgroundImage = '';
      avatarEl.textContent = (user.name||'⭐')[0].toUpperCase();
    }
  }

  // ── Foto do perfil também na capa (hero) do promoter ──
  const prxHeroBg = document.getElementById('prx-hero-bg');
  if (prxHeroBg) {
    if (user.photo_url) {
      prxHeroBg.style.backgroundImage    = `url('${user.photo_url}')`;
      prxHeroBg.style.backgroundSize     = 'cover';
      prxHeroBg.style.backgroundPosition = 'center center';
      prxHeroBg.classList.add('cp-hero-bg--has-photo');
    } else {
      prxHeroBg.style.backgroundImage    = '';
      prxHeroBg.style.backgroundSize     = '';
      prxHeroBg.style.backgroundPosition = '';
      prxHeroBg.classList.remove('cp-hero-bg--has-photo');
    }
  }

  // Textos estáticos do perfil
  document.getElementById('prom-profile-name').textContent  = user.name  || '—';
  document.getElementById('prom-profile-email').textContent = user.email || '—';
  const typeMap = { produtor:'🎬 Produtor', dj:'🎧 DJ', prp:'📣 PRP', agitador_cultural:'🎭 Agitador Cultural' };
  document.getElementById('ppinfo-type').textContent      = typeMap[user.promoter_type] || user.promoter_type || '—';
  document.getElementById('ppinfo-instagram').textContent = user.promoter_instagram ? `@${user.promoter_instagram}` : '—';
  document.getElementById('ppinfo-region').textContent    = user.promoter_region || '—';
  document.getElementById('ppinfo-phone').textContent     = user.phone || '—';
  document.getElementById('ppinfo-telegram').textContent  = user.promoter_telegram ? `@${user.promoter_telegram}` : '—';
  document.getElementById('ppinfo-pix').textContent       = user.pix_key || '—';

  // Stats: exibe do cache imediatamente
  const cached = OZ._promoterStatsCache;
  if (cached) {
    _updateEl('prom-stat-refs',   cached.referrals.length);
    _updateEl('prom-stat-acts',   cached.acts.length + (cached.pickActs ? cached.pickActs.length : 0));
    _updateEl('prom-stat-earned', `R$${cached.totalEarned.toFixed(2).replace('.',',')}`);
  } else {
    _updateEl('prom-stat-refs',   '…');
    _updateEl('prom-stat-acts',   '…');
    _updateEl('prom-stat-earned', '…');
  }

  startPromoterStatsPoller();
  checkPromoterInboxBadge();
  // Pré-carrega indicação se a seção já estiver aberta
  const pickBody = document.getElementById('prx-pick-body');
  if (pickBody && pickBody.style.display !== 'none') loadPromoterPick();
}

/* ══════════════════════════════════════════════════════
   TELA DE INDICAÇÕES — visível a TODOS os usuários
   Exibe os bares indicados por promoters.
   Ao ativar via indicação, o promoter recebe comissão.
══════════════════════════════════════════════════════ */

OZ._picksData    = [];   // cache completo [{bar, promoter, promo}]
OZ._picksFilter  = 'all';

/** Carrega e renderiza a tela de indicações */
async function loadPicksScreen() {
  const listEl  = document.getElementById('picks-list');
  const emptyEl = document.getElementById('picks-empty');
  if (!listEl) return;

  // Skeleton
  listEl.innerHTML = `
    <div class="picks-loading">
      <i class="fa fa-spinner fa-spin"></i><p>Carregando indicações...</p>
    </div>`;
  if (emptyEl) emptyEl.style.display = 'none';

  try {
    // Usa localDateStr (data real) E _todayStr (regra das 06h) para cobrir ambos os casos
    const todayStr      = _todayStr();
    const todayStrLocal = localDateStr(new Date());

    const [usersRes, barsRes, promosRes, schedsRes] = await Promise.all([
      // Busca só promoters com pick ativo (não depende do limit=500)
      fetch(`${SB_URL}/users?role=eq.promoter&promoter_pick=not.is.null&promoter_pick=neq.&select=id,name,promoter_pick,promoter_pick_date`, { headers: await sbHeaders() }).then(r => r.json()),
      apiGet('tables/bars?limit=200'),
      apiGet('tables/promotions?limit=200'),
      apiGet('tables/scheduled_benefits?limit=500'),
    ]);

    const allUsers  = Array.isArray(usersRes) ? usersRes : (usersRes.data || []);
    const allBars   = barsRes.data   || [];
    const allPromos = promosRes.data || [];
    const allScheds = schedsRes.data || [];

    // Bares mapeados
    const barsMap  = {};
    allBars.forEach(b => { barsMap[b.id] = b; });

    // Promos ativas por bar
    const promoMap = {};
    allPromos.forEach(p => {
      if (isPromoActive(p) && !promoMap[p.bar_id]) promoMap[p.bar_id] = p;
    });

    // Agendamentos de hoje por bar
    const schedMap = {};
    allScheds.forEach(s => {
      if (s.active !== false && s.date === todayStr && !schedMap[s.bar_id]) {
        schedMap[s.bar_id] = s;
      }
    });

    // ★ Promoters que indicam um bar com benefício ATIVO ou AGENDADO HOJE
    // Aceita tanto localDateStr quanto _todayStr para cobrir madrugada (00h–06h)
    const promotersWithPick = allUsers.filter(u =>
      u.promoter_pick &&
      (u.promoter_pick_date === todayStr || u.promoter_pick_date === todayStrLocal) &&
      barsMap[u.promoter_pick] &&
      (promoMap[u.promoter_pick] || schedMap[u.promoter_pick])
    );

    // Monta items
    OZ._picksData = promotersWithPick
      .map(p => {
        const bar   = barsMap[p.promoter_pick];
        if (!bar || bar.active === false) return null;
        const promo = promoMap[bar.id] || null;
        const sched = schedMap[bar.id] || null;
        const isLive = !!promo;
        return { bar, promoter: p, promo, sched, isLive };
      })
      .filter(Boolean);

    // Ordena: ao vivo primeiro, depois por nome
    OZ._picksData.sort((a, b) => {
      if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
      return (a.bar.name || '').localeCompare(b.bar.name || '');
    });

    OZ._picksFilter = 'all';
    _setPicksFilterActive('all');
    _renderPicksItems(OZ._picksData);

    // Atualiza contador no header
    const liveCountEl = document.getElementById('picks-live-count');
    const liveNumEl   = document.getElementById('picks-live-num');
    if (liveCountEl && liveNumEl) {
      const count = OZ._picksData.length;
      liveNumEl.textContent  = count;
      liveCountEl.style.display = count > 0 ? '' : 'none';
    }

  } catch (err) {
    console.error('[OZ] loadPicksScreen:', err);
    if (listEl) listEl.innerHTML = `
      <div class="picks-empty" style="display:flex">
        <i class="fa fa-exclamation-circle"></i>
        <p>Erro ao carregar indicações. Tente novamente.</p>
      </div>`;
  }
}

/** Aplica filtro na lista — todos os itens já estão ao vivo */
function filterPicks(filter) {
  OZ._picksFilter = filter;
  _setPicksFilterActive(filter);
  let items = OZ._picksData;
  if (filter === 'individual') items = items.filter(i => {
    const bt = i.promo?.benefit_type || i.sched?.benefit_type || 'individual';
    return bt === 'individual' || bt === 'unitario';
  });
  if (filter === 'night') items = items.filter(i => {
    const bt = i.promo?.benefit_type || i.sched?.benefit_type || '';
    return bt === 'night' || bt === 'night_link';
  });
  _renderPicksItems(items);
}

function _setPicksFilterActive(filter) {
  document.querySelectorAll('.picks-filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
}

/** Renderiza a lista de cards de indicação */
function _renderPicksItems(items) {
  const listEl  = document.getElementById('picks-list');
  const emptyEl = document.getElementById('picks-empty');
  if (!listEl) return;

  if (!items.length) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'flex';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  listEl.innerHTML = '';

  items.forEach(({ bar, promoter, promo, sched, isLive }) => {
    const cover       = bar.cover_url || bar.photo_url || '';
    const benefitObj  = promo || sched;
    const promoTitle  = benefitObj?.title || 'Benefício exclusivo';
    const benefitType = benefitObj?.benefit_type || 'individual';
    const isNight     = benefitType === 'night' || benefitType === 'night_link';
    const price       = isNight ? 'R$10' : 'R$5';
    const commission  = isNight ? '10%' : '20%';
    const commLabel   = isNight ? '🌙 Link da Noite Toda' : '🎯 Unitário';
    const promoAvatar = promoter.photo_url
      ? `style="background-image:url('${promoter.photo_url}');background-size:cover;background-position:center"`
      : '';

    // Verifica se o benefício (live ou agendado para hoje) atingiu o limite de ativações
    // benefitObj = promo (live) ou sched (agendado hoje)
    const _maxAct  = benefitObj?.max_activations || 0;
    const _curAct  = benefitObj?.activations_count || 0;
    const isFull   = _maxAct > 0 && _curAct >= _maxAct;

    // Badge: ESGOTADO (cinza) > AO VIVO (verde) > HOJE (âmbar)
    const statusBadge = isFull
      ? '<span class="pick-card-full-badge"><i class="fa fa-ban"></i> ESGOTADO</span>'
      : isLive
        ? '<span class="pick-card-live"><span class="pick-live-dot"></span>AO VIVO</span>'
        : '<span class="pick-card-sched-badge"><i class="fa fa-calendar-day"></i> HOJE</span>';

    // Texto do chip de vagas (mostra para qualquer tipo quando há limite)
    const slotsChip = _maxAct > 0
      ? `<span class="pick-slots-chip${isFull ? ' pick-slots-chip-full' : ''}">
           <i class="fa fa-users"></i>
           ${isFull ? `Esgotado (${_maxAct}/${_maxAct})` : `${Math.max(0, _maxAct - _curAct)} de ${_maxAct} vagas`}
         </span>`
      : '';

    const card = document.createElement('div');
    card.className = `pick-card${isFull ? ' pick-card-full' : ''}`;
    card.dataset.barId      = bar.id;
    card.dataset.promoterId = promoter.id;
    card.innerHTML = `
      <!-- Cover do bar -->
      <div class="pick-card-cover" style="${cover ? `background-image:url('${cover}');background-size:cover;background-position:center` : ''}">
        ${statusBadge}
        <div class="pick-card-cover-grad"></div>
      </div>

      <!-- Corpo -->
      <div class="pick-card-body${isFull ? ' pick-card-body-full' : ''}">

        <!-- Promoter que indicou -->
        <div class="pick-promoter-row">
          <div class="pick-promoter-avatar" ${promoAvatar}>${!promoter.photo_url ? (promoter.name||'P')[0].toUpperCase() : ''}</div>
          <div class="pick-promoter-info">
            <span class="pick-promoter-label">Indicado por</span>
            <span class="pick-promoter-name">${promoter.name || 'Promoter'}</span>
          </div>
          ${isFull
            ? `<span class="pick-full-badge-inline"><i class="fa fa-ban"></i> Indisponível</span>`
            : ''
          }
        </div>

        <!-- Info do bar -->
        <div class="pick-bar-info">
          <h3 class="pick-bar-name">${bar.name || '—'}</h3>
          <span class="pick-bar-hood"><i class="fa fa-map-marker-alt"></i> ${bar.neighborhood || bar.address || '—'}</span>
          ${bar.genre ? `<span class="pick-bar-genre"><i class="fa fa-music"></i> ${bar.genre}</span>` : ''}
        </div>

        <!-- Benefício -->
        <div class="pick-promo-chip ${!isLive ? 'pick-promo-chip-sched' : ''}${isFull ? ' pick-promo-chip-full' : ''}">
          <span class="pick-promo-type">${commLabel}</span>
          <span class="pick-promo-title">${promoTitle}</span>
          ${isFull
            ? `<span class="pick-promo-price pick-promo-price-full"><i class="fa fa-ban"></i></span>`
            : `<span class="pick-promo-price">${price}</span>`
          }
        </div>

        ${slotsChip}

        ${isFull ? `<p class="pick-full-notice"><i class="fa fa-ban"></i> Todas as ${_maxAct} vaga${_maxAct !== 1 ? 's foram' : ' foi'} preenchida${_maxAct !== 1 ? 's' : ''}. Benefício indisponível.</p>` : ''}

        <!-- Ações -->
        <div class="pick-actions">
          <button class="pick-btn-detail" onclick="openPickBarDetail('${bar.id}','${promoter.id}')">
            <i class="fa fa-store"></i> Ver bar
          </button>
          ${isFull
            ? `<button class="pick-btn-activate pick-btn-activate-full" disabled>
                 <i class="fa fa-ban"></i> Vagas esgotadas
               </button>`
            : `<button class="pick-btn-activate ${!isLive ? 'pick-btn-activate-sched' : ''}" onclick="openPickActivation('${bar.id}','${promoter.id}')">
                 <i class="fa fa-bolt"></i> ${isLive ? 'Ativar via indicação' : 'Ativar'}
               </button>`
          }
        </div>
      </div>`;
    listEl.appendChild(card);
  });
}

/** Abre o detalhe do bar (navega para a home e abre o bar) */
async function openPickBarDetail(barId, promoterId) {
  // Vincula o pick ao bar específico antes de abrir qualquer tela
  OZ._activePickPromoter = promoterId;
  OZ._pickBarId          = barId; // pick válido SOMENTE para este bar
  try {
    const bar = await apiGet(`tables/bars/${barId}`);
    switchTab('home');
    await new Promise(r => setTimeout(r, 150));
    await openBarDetail(bar);
  } catch { showToast('Erro ao abrir o bar.', 'error'); }
}

/** Abre o modal de ativação já com o promoter da indicação marcado */
async function openPickActivation(barId, promoterId) {
  // Vincula o pick ao bar específico antes de abrir qualquer tela
  OZ._activePickPromoter  = promoterId;
  OZ._pickBarId           = barId;
  // Flag que sobrevive ao openBarDetail (não é zerado por ele)
  OZ._forceActivateToday  = true;

  // Verifica se o pick é de benefício ao vivo ou agendado
  const pickItem = (OZ._picksData || []).find(p => p.bar?.id === barId);
  const isLive   = pickItem ? pickItem.isLive : true;
  const sched    = pickItem?.sched || null;

  try {
    const bar = await apiGet(`tables/bars/${barId}`);
    OZ.currentBar = bar;
    switchTab('home');
    await new Promise(r => setTimeout(r, 150));
    await openBarDetail(bar);
    await new Promise(r => setTimeout(r, 400));

    if (isLive) {
      openActivateModal();
    } else if (sched) {
      openAdvanceActivateModal(sched);
    } else {
      openActivateModal();
    }
  } catch { showToast('Erro ao abrir benefício.', 'error'); }
  finally  { OZ._forceActivateToday = false; }
}

/* ══════════════════════════════════════════════════════
   PROMOTER — INDICAÇÃO DE BAR
══════════════════════════════════════════════════════ */

OZ._pickBarsCache = []; // cache de todos os bares para o modal

/** Carrega e renderiza a indicação atual do promoter na seção do perfil */
async function loadPromoterPick() {
  const user = OZ.currentUser;
  if (!user) return;

  const emptyEl  = document.getElementById('prx-pick-empty');
  const cardEl   = document.getElementById('prx-pick-card');
  const earnEl   = document.getElementById('prx-pick-earnings');
  const todayStr = _todayStr(); // respeita regra das 06h

  // Helper para resetar para estado vazio
  function _resetPickUI(msg) {
    if (emptyEl) {
      emptyEl.style.display = 'flex';
      const p = emptyEl.querySelector('p');
      if (p) p.textContent = msg || 'Você ainda não indicou nenhum bar hoje.';
    }
    if (cardEl) cardEl.style.display = 'none';
    if (earnEl) earnEl.style.display = 'none';
    _updatePickChooseBtn();
  }

  // Atualiza estado do botão logo ao carregar
  _updatePickChooseBtn();

  // Lê do campo promoter_pick do próprio usuário
  const pickId   = user.promoter_pick      || null;
  const pickDate = user.promoter_pick_date || '';

  // Se a indicação é de um dia anterior, reseta imediatamente antes de renderizar
  if (pickId && pickDate && pickDate !== todayStr) {
    user.promoter_pick      = '';
    user.promoter_pick_date = '';
    localStorage.setItem('oz_user', JSON.stringify(user));
    apiPatch(`tables/users/${user.id}`, {
      promoter_pick:      '',
      promoter_pick_date: '',
    }).catch(() => {});
    _resetPickUI();
    return;
  }

  if (!pickId) { _resetPickUI(); return; }

  // Tem indicação — busca dados do bar + promo/agendamento ativo + ganhos
  try {
    const [bar, promosRes, schedsRes, earningsRes] = await Promise.all([
      apiGet(`tables/bars/${pickId}`),
      apiGet(`tables/promotions?limit=200`),
      apiGet(`tables/scheduled_benefits?limit=500`),
      apiGet(`tables/earnings?limit=500`),
    ]);

    // Verifica benefício ativo agora OU agendado para hoje
    const promoAtiva = (promosRes.data || []).find(
      p => p.bar_id === pickId && isPromoActive(p)
    );
    const schedHoje = (schedsRes.data || []).find(
      s => s.bar_id === pickId && s.date === todayStr && s.active !== false
    );

    const temBeneficioHoje = promoAtiva || schedHoje;

    if (!temBeneficioHoje) {
      // Sem benefício hoje — mantém o pick mas avisa
      _renderPromoterPickCard({ ...bar, _promo: null, _schedToday: null });
      if (emptyEl) emptyEl.style.display = 'none';
      if (cardEl)  cardEl.style.display  = '';
      // Mostra badge "Sem benefício hoje" no card
      const promoEl = document.getElementById('prx-pick-bar-promo');
      if (promoEl) promoEl.innerHTML = '<span class="pbm-no-benefit-today">Sem benefício hoje</span>';
      _updatePickChooseBtn();
      if (earnEl) earnEl.style.display = 'none';
      return;
    }

    // Renderiza card com o benefício disponível
    _renderPromoterPickCard({ ...bar, _promo: promoAtiva, _schedToday: schedHoje, _isLive: !!promoAtiva });
    if (emptyEl) emptyEl.style.display = 'none';
    if (cardEl)  cardEl.style.display  = '';
    _updatePickChooseBtn();

    // Calcula ganhos gerados por este bar
    const myPickEarns = (earningsRes.data || []).filter(e =>
      e.promoter_id === user.id && e.origin === 'pick_commission' &&
      (e.reason || '').includes(bar.name || pickId)
    );
    const pickTotal   = myPickEarns.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    const earnTotalEl = document.getElementById('prx-pick-earn-total');
    const earnCountEl = document.getElementById('prx-pick-earn-count');
    if (earnEl)      earnEl.style.display    = '';
    if (earnTotalEl) earnTotalEl.textContent = `R$${pickTotal.toFixed(2).replace('.',',')}`;
    if (earnCountEl) earnCountEl.textContent = myPickEarns.length;
  } catch {
    // Bar não encontrado ou erro
    _resetPickUI();
  }
}

/** Renderiza o card do bar indicado no perfil do promoter */
function _renderPromoterPickCard(bar) {
  const nameEl   = document.getElementById('prx-pick-bar-name');
  const hoodEl   = document.getElementById('prx-pick-bar-hood');
  const promoEl  = document.getElementById('prx-pick-bar-promo');
  const coverEl  = document.getElementById('prx-pick-cover');
  const statusEl = document.getElementById('prx-pick-bar-status');

  if (nameEl) nameEl.textContent = bar.name        || '—';
  if (hoodEl) hoodEl.textContent = bar.neighborhood || bar.address || '—';

  // Promo ativa ou agendada hoje
  const promo      = bar._promo      || (OZ.allPromos || {})[bar.id]?.[0];
  const schedToday = bar._schedToday || null;
  const isLive     = bar._isLive !== undefined ? bar._isLive : !!promo;
  const benefit    = promo ? promo.title : (schedToday ? schedToday.title : (bar.benefit || ''));

  // Verifica se o limite de ativações foi atingido (vale para live e agendado de hoje)
  const _benefitRef = promo || schedToday;
  const _maxAct = _benefitRef?.max_activations || 0;
  const _curAct = _benefitRef?.activations_count || 0;
  const isPromoFull = _maxAct > 0 && _curAct >= _maxAct;

  if (promoEl) {
    if (isPromoFull) {
      promoEl.innerHTML = `<span style="color:rgba(248,113,113,.75);"><i class="fa fa-ban" style="margin-right:4px;opacity:.7"></i>Vagas esgotadas — ${benefit}</span>`;
    } else if (benefit) {
      promoEl.innerHTML = `🎯 ${benefit}`;
    } else {
      promoEl.innerHTML = '';
    }
  }

  // Badge de status: Esgotado | Ativo agora | Agendado hoje
  if (statusEl) {
    if (isPromoFull) {
      statusEl.innerHTML = '<span class="prx-pick-full-badge"><i class="fa fa-ban"></i> ESGOTADO</span>';
    } else if (isLive) {
      statusEl.innerHTML = '<span class="prx-pick-live-badge"><i class="fa fa-bolt"></i> AO VIVO</span>';
    } else if (schedToday) {
      statusEl.innerHTML = '<span class="prx-pick-sched-badge"><i class="fa fa-calendar-check"></i> AGENDADO HOJE</span>';
    } else {
      statusEl.innerHTML = '';
    }
  }

  if (coverEl) {
    const img = bar.cover_url || bar.photo_url || '';
    if (img) {
      coverEl.style.backgroundImage    = `url('${img}')`;
      coverEl.style.backgroundSize     = 'cover';
      coverEl.style.backgroundPosition = 'center';
    } else {
      coverEl.style.backgroundImage = '';
      coverEl.style.background      = 'linear-gradient(135deg,#1e1e30,#2a2a40)';
    }
  }
}

/** Abre o modal de escolha de bar — exibe bares com benefício ativo OU agendado para hoje */
/** Guard: bloqueia indicação de bar se promoter não aprovado */
function openPickBarModalGuarded() {
  const user = OZ.currentUser;
  const approved = !user?.approval_status || user.approval_status === 'approved';
  if (!approved) {
    showToast('Seu cadastro ainda não foi aprovado. A indicação de bar ficará disponível após a aprovação.', 'error');
    return;
  }
  openPickBarModal();
}

async function openPickBarModal() {
  const user = OZ.currentUser;
  if (!user) return;

  // ── Verifica regra: 1 indicação por dia ──────────────────────
  const todayStr  = localDateStr(new Date());
  const pickDate  = user.promoter_pick_date || '';
  const alreadyToday = pickDate === todayStr && !!user.promoter_pick;

  const listEl   = document.getElementById('pbm-list');
  const searchEl = document.getElementById('pbm-search');
  const lockEl   = document.getElementById('pbm-day-lock');

  if (searchEl) searchEl.value = '';

  // Se já indicou hoje, mostra aviso e bloqueia nova escolha
  if (alreadyToday) {
    openModal('modal-pick-bar');
    if (lockEl) lockEl.style.display = 'flex';
    if (listEl) listEl.style.display = 'none';
    if (searchEl?.closest('.pbm-search-wrap')) searchEl.closest('.pbm-search-wrap').style.display = 'none';
    return;
  }

  // Esconde o lock e mostra lista normalmente
  if (lockEl) lockEl.style.display = 'none';
  if (listEl) { listEl.style.display = ''; listEl.innerHTML = '<div class="pbm-loading"><i class="fa fa-spinner fa-spin"></i> Carregando bares disponíveis...</div>'; }
  if (searchEl?.closest('.pbm-search-wrap')) searchEl.closest('.pbm-search-wrap').style.display = '';
  openModal('modal-pick-bar');

  try {
    const [barsRes, promosRes, schedsRes] = await Promise.all([
      apiGet('tables/bars?limit=200'),
      apiGet('tables/promotions?limit=200'),
      apiGet(`tables/scheduled_benefits?limit=500`),
    ]);

    const rawBars   = (barsRes.data  || []).filter(b => b.active !== false);
    const rawPromos = promosRes.data || [];
    const rawScheds = schedsRes.data || [];

    // Mapa bar_id → promoção ativa agora
    const promoMap = {};
    rawPromos.forEach(p => {
      if (isPromoActive(p) && !promoMap[p.bar_id]) promoMap[p.bar_id] = p;
    });

    // Mapa bar_id → agendamento de hoje
    const schedTodayMap = {};
    rawScheds.forEach(s => {
      if (s.date === todayStr && s.active !== false && !schedTodayMap[s.bar_id]) {
        schedTodayMap[s.bar_id] = s;
      }
    });

    // Une bares com promo ativa OU agendamento para hoje
    const eligibleBars = rawBars.filter(b => promoMap[b.id] || schedTodayMap[b.id]);
    eligibleBars.sort((a, b) => {
      // Bares ativos agora primeiro, depois agendados
      const aLive = !!promoMap[a.id];
      const bLive = !!promoMap[b.id];
      if (aLive !== bLive) return bLive ? 1 : -1;
      return (a.name || '').localeCompare(b.name || '');
    });

    OZ._pickBarsCache = eligibleBars.map(b => ({
      ...b,
      _promo:      promoMap[b.id]      || null,
      _schedToday: schedTodayMap[b.id] || null,
      _isLive:     !!promoMap[b.id],
    }));

    if (!OZ._pickBarsCache.length) {
      if (listEl) listEl.innerHTML = `
        <div class="pbm-empty">
          <i class="fa fa-moon"></i>
          <p>Nenhum bar com benefício disponível hoje.<br><small>Quando um bar publicar ou agendar um benefício para hoje, ele aparece aqui.</small></p>
        </div>`;
      return;
    }

    _renderPickBarList(OZ._pickBarsCache);
  } catch {
    if (listEl) listEl.innerHTML = '<div class="pbm-loading"><i class="fa fa-exclamation-circle"></i> Erro ao carregar bares.</div>';
  }
}

/** Filtra a lista de bares no modal pelo texto digitado */
function filterPickBars(q) {
  const term = (q || '').trim().toLowerCase();
  if (!term) { _renderPickBarList(OZ._pickBarsCache); return; }
  _renderPickBarList(OZ._pickBarsCache.filter(b =>
    (b.name        || '').toLowerCase().includes(term) ||
    (b.neighborhood || '').toLowerCase().includes(term)
  ));
}

/** Renderiza a lista de bares dentro do modal */
function _renderPickBarList(bars) {
  const listEl = document.getElementById('pbm-list');
  if (!listEl) return;

  if (!bars.length) {
    listEl.innerHTML = '<div class="pbm-empty"><i class="fa fa-search"></i><p>Nenhum bar encontrado.</p></div>';
    return;
  }

  listEl.innerHTML = '';
  bars.forEach(bar => {
    const cover      = bar.cover_url || bar.photo_url || '';
    const promo      = bar._promo;
    const schedToday = bar._schedToday;
    const isLive     = bar._isLive;
    const benefitText = promo
      ? promo.title
      : (schedToday ? schedToday.title : (bar.benefit || ''));

    const item = document.createElement('div');
    item.className = 'pbm-item';
    item.onclick   = () => selectPickBar(bar);
    item.innerHTML = `
      <div class="pbm-item-cover" style="${cover ? `background-image:url('${cover}');background-size:cover;background-position:center` : ''}">
        ${!cover ? `<i class="fa fa-store" style="color:rgba(255,255,255,0.3);font-size:20px"></i>` : ''}
      </div>
      <div class="pbm-item-info">
        <span class="pbm-item-name">${bar.name || '—'}</span>
        <span class="pbm-item-hood">${bar.neighborhood || bar.address || '—'}</span>
        ${benefitText ? `<span class="pbm-item-promo">🎯 ${benefitText}</span>` : ''}
      </div>
      <span class="pbm-item-live ${isLive ? 'pbm-item-live-green' : 'pbm-item-live-amber'}">
        ${isLive ? '<i class="fa fa-bolt"></i> AO VIVO' : '<i class="fa fa-calendar-check"></i> HOJE'}
      </span>`;
    listEl.appendChild(item);
  });
}

/** Salva a indicação do bar escolhido (1 indicação por dia) */
async function selectPickBar(bar) {
  const user = OZ.currentUser;
  if (!user) return;

  // Dupla verificação da regra de 1 por dia
  const todayStr = localDateStr(new Date());
  if (user.promoter_pick_date === todayStr && user.promoter_pick) {
    showToast('Você já indicou um bar hoje. A indicação pode ser trocada amanhã.', 'error');
    closeModal('modal-pick-bar');
    return;
  }

  try {
    await apiPatch(`tables/users/${user.id}`, {
      promoter_pick:      bar.id,
      promoter_pick_date: todayStr,   // registra a data da indicação
    });
    OZ.currentUser.promoter_pick      = bar.id;
    OZ.currentUser.promoter_pick_date = todayStr;
    localStorage.setItem('oz_user', JSON.stringify(OZ.currentUser));

    closeModal('modal-pick-bar');

    // Atualiza a seção
    const emptyEl  = document.getElementById('prx-pick-empty');
    const cardEl   = document.getElementById('prx-pick-card');
    const labelEl  = document.getElementById('prx-pick-choose-label');
    _renderPromoterPickCard({ ...bar, _promo: bar._promo || null, _schedToday: bar._schedToday || null, _isLive: bar._isLive || false });
    if (emptyEl) emptyEl.style.display = 'none';
    if (cardEl)  cardEl.style.display  = '';

    // Atualiza o label e o estado do botão (já indicou hoje — botão desabilitado)
    _updatePickChooseBtn();

    showToast(`✅ ${bar.name} é sua indicação de hoje!`, 'success');
  } catch {
    showToast('Erro ao salvar indicação. Tente novamente.', 'error');
  }
}

/** Atualiza o label/estado do botão "Escolher bar" com base na regra de 1/dia */
function _updatePickChooseBtn() {
  const user     = OZ.currentUser;
  const labelEl  = document.getElementById('prx-pick-choose-label');
  const btn      = document.getElementById('prx-pick-choose-btn');
  const dateHint = document.getElementById('prx-pick-date-hint');
  if (!user || !btn) return;

  const todayStr     = localDateStr(new Date());
  const alreadyToday = user.promoter_pick_date === todayStr && !!user.promoter_pick;

  if (alreadyToday) {
    if (labelEl) labelEl.textContent = 'Indicação feita hoje';
    btn.disabled = true;
    btn.style.opacity = '0.5';
    btn.style.cursor  = 'not-allowed';
    if (dateHint) {
      dateHint.style.display = 'flex';
      dateHint.innerHTML = `<i class="fa fa-lock"></i> Indicação travada até amanhã`;
    }
  } else if (user.promoter_pick) {
    if (labelEl) labelEl.textContent = 'Trocar indicação';
    btn.disabled = false;
    btn.style.opacity = '';
    btn.style.cursor  = '';
    if (dateHint) dateHint.style.display = 'none';
  } else {
    if (labelEl) labelEl.textContent = 'Escolher bar para indicar';
    btn.disabled = false;
    btn.style.opacity = '';
    btn.style.cursor  = '';
    if (dateHint) dateHint.style.display = 'none';
  }
}

/** Remove a indicação atual */
async function clearPromoterPick() {
  const user = OZ.currentUser;
  if (!user) return;

  // Se indicou hoje, avisa que não pode trocar até amanhã
  const todayStr = localDateStr(new Date());
  if (user.promoter_pick_date === todayStr && user.promoter_pick) {
    showToast('Você já indicou hoje. A indicação pode ser trocada amanhã.', 'error');
    return;
  }

  try {
    await apiPatch(`tables/users/${user.id}`, { promoter_pick: '' });
    OZ.currentUser.promoter_pick = '';
    localStorage.setItem('oz_user', JSON.stringify(OZ.currentUser));

    const emptyEl = document.getElementById('prx-pick-empty');
    const cardEl  = document.getElementById('prx-pick-card');
    const earnEl  = document.getElementById('prx-pick-earnings');
    if (emptyEl) emptyEl.style.display = 'flex';
    if (cardEl)  cardEl.style.display  = 'none';
    if (earnEl)  earnEl.style.display  = 'none';

    _updatePickChooseBtn();
    showToast('Indicação removida.', '');
  } catch {
    showToast('Erro ao remover indicação.', 'error');
  }
}

/* ══════════════════════════════════════════════════════
   CLIENTE — INDICAÇÃO DO PROMOTER (perfil do cliente)
══════════════════════════════════════════════════════ */

OZ._clientPickBarData = null; // { bar, promoterName }

/** Carrega e exibe a indicação do promoter no perfil do cliente */
async function loadClientPromoterPick() {
  const user = OZ.currentUser;
  if (!user || user.role !== 'cliente') return;

  const card = document.getElementById('client-pick-card');
  if (!card) return;
  card.style.display = 'none';

  // O promoter é quem tem referred_by
  const promoterId = user.referred_by;
  if (!promoterId) return;

  try {
    const promoter = await apiGet(`tables/users/${promoterId}`);
    const pickId   = promoter.promoter_pick;
    if (!pickId) return;

    // A indicação só vale no dia em que foi feita
    const todayStr  = _todayStr();
    const pickDate  = promoter.promoter_pick_date || '';
    if (pickDate !== todayStr) return;  // indicação expirada — não exibe o card

    // Busca bar + promoções ativas + agendamentos de hoje em paralelo
    const [bar, promosRes, schedRes] = await Promise.all([
      apiGet(`tables/bars/${pickId}`),
      apiGet(`tables/promotions?limit=200`),
      apiGet(`tables/scheduled_benefits?limit=500`),
    ]);

    if (!bar || bar.active === false) return;

    // 1) Verifica promoção ativa agora
    const promos = (promosRes.data || []).filter(p => p.bar_id === pickId && isPromoActive(p));
    const promo  = promos[0] || null;

    // 2) Verifica agendamento para hoje
    const todayScheds = (schedRes.data || []).filter(s =>
      s.bar_id === pickId &&
      s.active !== false &&
      s.date === todayStr
    );
    const sched = todayScheds[0] || null;

    // Exibe se há promoção ativa OU agendamento para hoje
    if (!promo && !sched) return;

    // Monta o texto do benefício
    const benefitTitle = promo
      ? promo.title
      : (sched.title || 'Benefício agendado');

    const isLive = !!promo;

    // Salva para uso ao clicar
    OZ._clientPickBarData = { bar, promoterName: promoter.name || 'Promoter', promo, sched, isLive };

    // Preenche o card
    const promNameEl = document.getElementById('cpk-promoter-name');
    const barNameEl  = document.getElementById('cpk-bar-name');
    const barHoodEl  = document.getElementById('cpk-bar-hood');
    const barPromoEl = document.getElementById('cpk-bar-promo');
    const coverEl    = document.getElementById('cpk-bar-cover');
    const statusEl   = document.getElementById('cpk-status-badge');

    if (promNameEl) promNameEl.textContent = promoter.name || 'Promoter';
    if (barNameEl)  barNameEl.textContent  = bar.name        || '—';
    if (barHoodEl)  barHoodEl.textContent  = bar.neighborhood || bar.address || '—';
    if (barPromoEl) barPromoEl.textContent = `🎯 ${benefitTitle}`;

    // Badge de status: AO VIVO ou HOJE
    if (statusEl) {
      if (isLive) {
        statusEl.textContent = '🔴 AO VIVO';
        statusEl.style.background = 'rgba(34,197,94,0.18)';
        statusEl.style.color      = '#22c55e';
        statusEl.style.border     = '1px solid rgba(34,197,94,0.35)';
      } else {
        statusEl.textContent = '📅 HOJE';
        statusEl.style.background = 'rgba(0,245,255,0.15)';
        statusEl.style.color      = '#00F5FF';
        statusEl.style.border     = '1px solid rgba(0,245,255,0.35)';
      }
      statusEl.style.display = 'inline-block';
    }

    const img = bar.cover_url || bar.photo_url || '';
    if (coverEl) {
      if (img) {
        coverEl.style.backgroundImage    = `url('${img}')`;
        coverEl.style.backgroundSize     = 'cover';
        coverEl.style.backgroundPosition = 'center';
      } else {
        coverEl.style.backgroundImage = '';
        coverEl.style.background      = 'linear-gradient(135deg,#1a1a2e,#2a1a3e)';
      }
    }

    card.style.display = '';
  } catch (e) {
    console.warn('[loadClientPromoterPick] erro:', e);
    /* silencia — card fica oculto */
  }
}

/** Navega para o bar indicado ao clicar no card */
async function goToPickedBar() {
  const data = OZ._clientPickBarData;
  if (!data?.bar) return;

  // Navega para a home e abre o detalhe do bar
  switchTab('home');
  await new Promise(r => setTimeout(r, 200));
  openBarDetail(data.bar);
}

/* ══════════════════════════════════════════════════════
   PROMOTER — INBOX DE NOTIFICAÇÕES
══════════════════════════════════════════════════════ */

function togglePromoterSection(bodyId) {
  const body  = document.getElementById(bodyId);
  const arrow = document.getElementById(`${bodyId}-arrow`);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  if (arrow) arrow.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
  if (bodyId === 'prx-inbox-body' && !isOpen) loadPromoterInbox();
  if (bodyId === 'prx-chat-body'  && !isOpen) loadPromoterChatContacts();
  if (bodyId === 'prx-pick-body'  && !isOpen) loadPromoterPick();
}

async function checkPromoterInboxBadge() {
  const user = OZ.currentUser;
  if (!user || user.role !== 'promoter') return;
  try {
    const res   = await apiGet(`tables/chat_messages?limit=200`);
    const count = (res.data || []).filter(m => m.receiver_id === user.id && !m.read).length;
    const ids   = ['prx-inbox-badge',
                   'pin-promoter-badge', 'pin-promoter-badge-home',
                   'pin-promoter-badge-explore', 'pin-promoter-badge-hist'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent   = count > 9 ? '9+' : String(count);
      el.style.display = count > 0 ? 'inline-flex' : 'none';
    });
  } catch { /* silencia */ }
}

async function loadPromoterInbox() {
  const user   = OZ.currentUser;
  const listEl = document.getElementById('prx-inbox-list');
  if (!user || !listEl) return;

  listEl.innerHTML = '<div class="prx-inbox-loading"><i class="fa fa-spinner fa-spin"></i> Carregando…</div>';
  try {
    const res  = await apiGet(`tables/chat_messages?limit=200`);
    const msgs = (res.data || [])
      .filter(m => m.receiver_id === user.id)
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    if (!msgs.length) {
      listEl.innerHTML = '<div class="prx-inbox-empty"><i class="fa fa-bell-slash"></i><p>Nenhuma notificação ainda.</p></div>';
      return;
    }
    listEl.innerHTML = '';

    // Marca todas como lidas
    msgs.filter(m => !m.read).forEach(m => {
      apiPatch(`tables/chat_messages/${m.id}`, { read: true }).catch(() => {});
    });
    // Zera badges
    ['prx-inbox-badge','pin-promoter-badge','pin-promoter-badge-home',
     'pin-promoter-badge-explore','pin-promoter-badge-hist'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });

    msgs.forEach(msg => {
      const isNew      = !msg.read;
      const senderName = msg.sender_name || 'Bar';
      const dateStr    = msg.created_at
        ? new Date(msg.created_at).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})
        : '';
      const safeContent = (msg.content || '').replace(/</g,'&lt;').replace(/\n/g,'<br>');
      const item = document.createElement('div');
      item.className = `prx-inbox-item${isNew ? ' prx-inbox-item-new' : ''}`;
      item.innerHTML = `
        <div class="prx-inbox-item-header">
          <div class="prx-inbox-sender-avatar"><i class="fa fa-store"></i></div>
          <div class="prx-inbox-sender-info">
            <span class="prx-inbox-sender-name">${senderName}</span>
            <span class="prx-inbox-date">${dateStr}</span>
          </div>
          ${isNew ? '<span class="prx-inbox-new-tag">Nova</span>' : ''}
        </div>
        <div class="prx-inbox-item-body">${safeContent}</div>`;
      listEl.appendChild(item);
    });
  } catch {
    listEl.innerHTML = '<div class="prx-inbox-empty"><i class="fa fa-exclamation-circle"></i><p>Erro ao carregar.</p></div>';
  }
}

/* ══════════════════════════════════════════════════════
   PROMOTER — CHAT COM CLIENTES ATIVADOS
══════════════════════════════════════════════════════ */

OZ._promoChatCurrentClient = null; // { id, name }
OZ._promoChatPollInterval  = null;

async function loadPromoterChatContacts() {
  const user      = OZ.currentUser;
  const container = document.getElementById('prx-chat-contacts');
  const convo     = document.getElementById('prx-chat-convo');
  if (!user || !container) return;

  // Esconde conversa aberta ao recarregar contatos
  if (convo) convo.style.display = 'none';
  OZ._promoChatCurrentClient = null;

  container.innerHTML = '<div class="prx-chat-loading"><i class="fa fa-spinner fa-spin"></i></div>';
  try {
    const actsRes = await apiGet(`tables/activations?limit=500`);
    const allActs = actsRes.data || [];

    // Filtra ativações geradas pelo código deste promoter (promoter_id ou promoter_code === user.id)
    const myActs = allActs.filter(a =>
      (a.promoter_id === user.id || a.promoter_code === user.id) &&
      a.user_id &&
      !a.user_id.startsWith('demo-') &&
      a.type !== 'free_credit' &&
      a.type !== 'free_credit_used'
    );

    // Uniquifica por user_id
    const clientMap = new Map();
    myActs.forEach(a => {
      if (!clientMap.has(a.user_id)) {
        clientMap.set(a.user_id, { id: a.user_id, name: a.user_name || `#${a.user_id.slice(0,6)}` });
      }
    });

    // Enriquece com nomes da tabela users
    await Promise.all([...clientMap.values()].map(async c => {
      try {
        const u = await apiGet(`tables/users/${c.id}`);
        if (u.name) { c.name = u.name; c.photo = u.photo_url || ''; }
      } catch {}
    }));

    container.innerHTML = '';

    if (!clientMap.size) {
      container.innerHTML = '<div class="prx-chat-empty"><i class="fa fa-user-slash"></i><p>Nenhum cliente ativado ainda.</p></div>';
      return;
    }

    // Verifica mensagens não lidas por cliente
    const msgsRes  = await apiGet(`tables/chat_messages?limit=500`);
    const allMsgs  = msgsRes.data || [];
    const unreadBy = new Map();
    allMsgs.filter(m => m.receiver_id === user.id && !m.read).forEach(m => {
      unreadBy.set(m.sender_id, (unreadBy.get(m.sender_id) || 0) + 1);
    });

    [...clientMap.values()].forEach(client => {
      const initials = (client.name||'?')[0].toUpperCase();
      const unread   = unreadBy.get(client.id) || 0;
      const card = document.createElement('div');
      card.className = 'prx-contact-card';
      card.onclick = () => openPromoterConvo(client);
      card.innerHTML = `
        <div class="prx-contact-avatar" style="${client.photo ? `background-image:url('${client.photo}');background-size:cover;background-position:center` : ''}">${client.photo ? '' : initials}</div>
        <div class="prx-contact-info">
          <span class="prx-contact-name">${client.name}</span>
          <span class="prx-contact-sub">Cliente ativado</span>
        </div>
        ${unread > 0 ? `<span class="prx-contact-unread">${unread}</span>` : ''}`;
      container.appendChild(card);
    });

    // Atualiza badge do chat
    const totalUnread = allMsgs.filter(m => m.receiver_id === user.id && !m.read).length;
    const chatBadge   = document.getElementById('prx-chat-badge');
    if (chatBadge) {
      chatBadge.textContent   = totalUnread > 9 ? '9+' : String(totalUnread);
      chatBadge.style.display = totalUnread > 0 ? 'inline-flex' : 'none';
    }
  } catch {
    container.innerHTML = '<div class="prx-chat-empty"><i class="fa fa-exclamation-circle"></i><p>Erro ao carregar.</p></div>';
  }
}

async function openPromoterConvo(client) {
  OZ._promoChatCurrentClient = client;
  const convo     = document.getElementById('prx-chat-convo');
  const contacts  = document.getElementById('prx-chat-contacts');
  const nameEl    = document.getElementById('prx-convo-name');
  const avatarEl  = document.getElementById('prx-convo-avatar');
  if (!convo) return;

  contacts.style.display = 'none';
  convo.style.display    = 'flex';
  if (nameEl) nameEl.textContent = client.name;
  if (avatarEl) {
    if (client.photo) {
      avatarEl.style.backgroundImage    = `url('${client.photo}')`;
      avatarEl.style.backgroundSize     = 'cover';
      avatarEl.style.backgroundPosition = 'center';
      avatarEl.textContent = '';
    } else {
      avatarEl.style.backgroundImage = '';
      avatarEl.textContent = (client.name||'?')[0].toUpperCase();
    }
  }

  await loadPromoterMessages();

  // Poll a cada 5s
  if (OZ._promoChatPollInterval) clearInterval(OZ._promoChatPollInterval);
  OZ._promoChatPollInterval = setInterval(loadPromoterMessages, 5000);
}

function closePromoterConvo() {
  if (OZ._promoChatPollInterval) { clearInterval(OZ._promoChatPollInterval); OZ._promoChatPollInterval = null; }
  OZ._promoChatCurrentClient = null;
  const convo    = document.getElementById('prx-chat-convo');
  const contacts = document.getElementById('prx-chat-contacts');
  if (convo)    convo.style.display    = 'none';
  if (contacts) contacts.style.display = 'block';
}

async function loadPromoterMessages() {
  const user   = OZ.currentUser;
  const client = OZ._promoChatCurrentClient;
  const msgsEl = document.getElementById('prx-chat-messages');
  if (!user || !client || !msgsEl) return;

  try {
    const res  = await apiGet(`tables/chat_messages?limit=300`);
    const msgs = (res.data || [])
      .filter(m =>
        (m.sender_id === user.id   && m.receiver_id === client.id) ||
        (m.sender_id === client.id && m.receiver_id === user.id)
      )
      .sort((a, b) => (a.created_at || 0) - (b.created_at || 0));

    // Marca mensagens do cliente como lidas
    msgs.filter(m => m.sender_id === client.id && !m.read).forEach(m => {
      apiPatch(`tables/chat_messages/${m.id}`, { read: true }).catch(() => {});
    });

    const wasAtBottom = msgsEl.scrollHeight - msgsEl.scrollTop <= msgsEl.clientHeight + 60;
    msgsEl.innerHTML = '';

    msgs.forEach(msg => {
      const isMe   = msg.sender_id === user.id;
      const time   = msg.created_at ? new Date(msg.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '';
      const safe   = (msg.content||'').replace(/</g,'&lt;').replace(/\n/g,'<br>');
      const bubble = document.createElement('div');
      bubble.className = `prx-bubble ${isMe ? 'prx-bubble-me' : 'prx-bubble-them'}`;
      bubble.innerHTML = `<span class="prx-bubble-text">${safe}</span><span class="prx-bubble-time">${time}</span>`;
      msgsEl.appendChild(bubble);
    });

    if (wasAtBottom || msgs.length <= 20) msgsEl.scrollTop = msgsEl.scrollHeight;
  } catch { /* silencia */ }
}

async function sendPromoterMessage() {
  const user   = OZ.currentUser;
  const client = OZ._promoChatCurrentClient;
  const input  = document.getElementById('prx-chat-input');
  if (!user || !client || !input) return;
  const text = (input.value || '').trim();
  if (!text) return;
  input.value = '';
  try {
    await apiPost('tables/chat_messages', {
      sender_id:     user.id,
      sender_name:   user.name || 'Promoter',
      receiver_id:   client.id,
      receiver_name: client.name,
      content:       text,
      read:          false,
      created_at:    Date.now(),
    });
    await loadPromoterMessages();
  } catch { showToast('Erro ao enviar mensagem.', 'error'); }
}

/* ══════════════════════════════════════════════════════
   CLIENTE — CHAT COM PROMOTER
   Só aparece no perfil do cliente APÓS uma ativação
   com código de promoter
══════════════════════════════════════════════════════ */

OZ._clientPromoChatPoll = null;
OZ._clientPromoterInfo  = null; // { id, name, photo }

/** Chamado ao carregar perfil do cliente — verifica se tem promoter e se está "online" */
async function checkClientPromoterChat() {
  const user = OZ.currentUser;
  if (!user || user.role !== 'cliente') return;

  const card = document.getElementById('client-promoter-chat-card');
  if (!card) return;

  // Verifica se o cliente já ativou com código de promoter
  try {
    const actsRes = await apiGet(`tables/activations?limit=500`);
    const myActs  = (actsRes.data || []).filter(a =>
      a.user_id === user.id &&
      (a.promoter_id || a.promoter_code) &&
      !(a.promoter_id || '').startsWith('demo-') &&
      a.type !== 'free_credit' &&
      a.type !== 'free_credit_used'
    );

    if (!myActs.length) { _showChatHeroEmpty(); card.style.display = 'none'; return; }

    // Pega o promoter mais recente
    const promoterId = myActs.sort((a,b)=>(b.created_at||0)-(a.created_at||0))[0].promoter_id || myActs[0].promoter_code;
    if (!promoterId) { _showChatHeroEmpty(); card.style.display = 'none'; return; }

    // Busca dados do promoter
    const promoter = await apiGet(`tables/users/${promoterId}`);
    OZ._clientPromoterInfo = { id: promoterId, name: promoter.name || 'Promoter', photo: promoter.photo_url || '' };

    card.style.display = '';

    // Esconde widget online, mostra chat hero
    const onlineWidget = document.getElementById('pf-online-widget');
    const hero = document.getElementById('client-promoter-chat-hero');
    if (onlineWidget) onlineWidget.style.display = 'none';
    if (hero) hero.style.display = 'block';

    // Preenche nome e avatar no card
    const cardNameEl   = document.getElementById('client-promo-name');
    const cardAvatarEl = document.getElementById('client-promo-avatar');
    const cardSubEl    = document.getElementById('client-promo-sub');
    if (cardNameEl) cardNameEl.textContent = OZ._clientPromoterInfo.name;
    if (cardAvatarEl) {
      if (OZ._clientPromoterInfo.photo) {
        cardAvatarEl.style.backgroundImage    = `url('${OZ._clientPromoterInfo.photo}')`;
        cardAvatarEl.style.backgroundSize     = 'cover';
        cardAvatarEl.style.backgroundPosition = 'center';
        // mantém o dot dentro do avatar, limpa texto
        const dot = document.getElementById('client-promo-online-dot');
        if (dot) { cardAvatarEl.textContent = ''; cardAvatarEl.appendChild(dot); }
      } else {
        cardAvatarEl.style.backgroundImage = '';
        cardAvatarEl.textContent = (OZ._clientPromoterInfo.name||'⭐')[0].toUpperCase();
      }
    }

    // Verifica presença online do promoter
    const presRes  = await apiGet(`tables/user_presence?limit=200`);
    const presRec  = (presRes.data || []).find(p => p.user_id === promoterId);
    const isOnline = presRec?.is_online;
    const onlineDot = document.getElementById('client-promo-online-dot');
    if (onlineDot) onlineDot.style.display = isOnline ? 'inline-block' : 'none';
    if (cardSubEl) cardSubEl.textContent = isOnline ? '🟢 Online agora' : 'Toque para conversar';

    // Preenche hero de destaque (estado linked)
    const heroName = document.getElementById('client-promo-name-hero');
    const heroSub  = document.getElementById('client-promo-sub-hero');
    const heroDot  = document.getElementById('client-promo-online-dot-hero');
    const heroAv   = document.getElementById('client-promo-avatar-hero');
    if (heroName) heroName.textContent = OZ._clientPromoterInfo.name;
    if (heroSub)  heroSub.textContent  = isOnline ? '🟢 Online agora · seu promoter' : 'Toque para conversar · seu promoter';
    if (heroDot)  heroDot.style.display = isOnline ? 'block' : 'none';
    if (heroAv) {
      if (OZ._clientPromoterInfo.photo) {
        heroAv.style.backgroundImage    = `url('${OZ._clientPromoterInfo.photo}')`;
        heroAv.style.backgroundSize     = 'cover';
        heroAv.style.backgroundPosition = 'center';
        heroAv.textContent = '';
      } else {
        heroAv.style.backgroundImage = '';
        heroAv.textContent = (OZ._clientPromoterInfo.name||'⭐')[0].toUpperCase();
      }
    }

  } catch {
    _showOnlineWidget();
    card.style.display = 'none';
  }
}

/* Sem promoter: mostra widget online, esconde chat hero */
function _showChatHeroEmpty() { _showOnlineWidget(); }
function _showOnlineWidget() {
  const onlineWidget = document.getElementById('pf-online-widget');
  const hero = document.getElementById('client-promoter-chat-hero');
  if (onlineWidget) onlineWidget.style.display = 'block';
  if (hero) hero.style.display = 'none';
}

async function openClientPromoterChat() {
  const info = OZ._clientPromoterInfo;
  if (!info) return;

  // Preenche modal
  const nameEl   = document.getElementById('cpc-promoter-name');
  const avatarEl = document.getElementById('cpc-promoter-avatar');
  if (nameEl) nameEl.textContent = info.name;
  if (avatarEl) {
    if (info.photo) {
      avatarEl.style.backgroundImage    = `url('${info.photo}')`;
      avatarEl.style.backgroundSize     = 'cover';
      avatarEl.style.backgroundPosition = 'center';
      avatarEl.textContent = '';
    } else {
      avatarEl.style.backgroundImage = '';
      avatarEl.textContent = (info.name||'⭐')[0].toUpperCase();
    }
  }

  // Verifica online
  try {
    const presRes  = await apiGet(`tables/user_presence?limit=200`);
    const presRec  = (presRes.data || []).find(p => p.user_id === info.id);
    const statusEl = document.getElementById('cpc-online-status');
    if (statusEl) statusEl.textContent = presRec?.is_online ? '🟢 online' : '⚫ offline';
  } catch {}

  openModal('modal-client-promo-chat');
  await loadClientPromoterMessages();

  if (OZ._clientPromoChatPoll) clearInterval(OZ._clientPromoChatPoll);
  OZ._clientPromoChatPoll = setInterval(loadClientPromoterMessages, 5000);
}

async function loadClientPromoterMessages() {
  const user = OZ.currentUser;
  const info = OZ._clientPromoterInfo;
  const msgsEl = document.getElementById('cpc-messages');
  if (!user || !info || !msgsEl) return;

  try {
    const res  = await apiGet(`tables/chat_messages?limit=300`);
    const msgs = (res.data || [])
      .filter(m =>
        (m.sender_id === user.id   && m.receiver_id === info.id) ||
        (m.sender_id === info.id   && m.receiver_id === user.id)
      )
      .sort((a, b) => (a.created_at || 0) - (b.created_at || 0));

    // Marca mensagens do promoter como lidas
    msgs.filter(m => m.sender_id === info.id && !m.read).forEach(m => {
      apiPatch(`tables/chat_messages/${m.id}`, { read: true }).catch(() => {});
    });

    const wasAtBottom = msgsEl.scrollHeight - msgsEl.scrollTop <= msgsEl.clientHeight + 60;
    msgsEl.innerHTML = '';

    msgs.forEach(msg => {
      const isMe = msg.sender_id === user.id;
      const time = msg.created_at ? new Date(msg.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '';
      const safe = (msg.content||'').replace(/</g,'&lt;').replace(/\n/g,'<br>');
      const bubble = document.createElement('div');
      bubble.className = `prx-bubble ${isMe ? 'prx-bubble-me' : 'prx-bubble-them'}`;
      bubble.innerHTML = `<span class="prx-bubble-text">${safe}</span><span class="prx-bubble-time">${time}</span>`;
      msgsEl.appendChild(bubble);
    });

    if (wasAtBottom || msgs.length <= 20) msgsEl.scrollTop = msgsEl.scrollHeight;
  } catch { /* silencia */ }
}

async function sendClientPromoterMessage() {
  const user = OZ.currentUser;
  const info = OZ._clientPromoterInfo;
  const input = document.getElementById('cpc-input');
  if (!user || !info || !input) return;
  const text = (input.value || '').trim();
  if (!text) return;
  input.value = '';
  try {
    await apiPost('tables/chat_messages', {
      sender_id:     user.id,
      sender_name:   user.name || 'Cliente',
      receiver_id:   info.id,
      receiver_name: info.name,
      content:       text,
      read:          false,
      created_at:    Date.now(),
    });
    await loadClientPromoterMessages();
  } catch { showToast('Erro ao enviar mensagem.', 'error'); }
}

async function countReferrals(userId) {
  try {
    const res = await apiGet(`tables/users?limit=500`);
    return (res.data||[]).filter(u => u.referred_by === userId).length;
  } catch { return 0; }
}

/* ══════════════════════════════════
   PROMOTER PROFILE EDIT
══════════════════════════════════ */

/* Preenche os campos do formulário de edição com os dados do usuário atual */
function _fillPromoterEditForm() {
  const user = OZ.currentUser;
  if (!user) return;
  const nameEl      = document.getElementById('prx-edit-name');
  const typeEl      = document.getElementById('prx-edit-type');
  const igEl        = document.getElementById('prx-edit-instagram');
  const regionEl    = document.getElementById('prx-edit-region');
  const phoneEl     = document.getElementById('prx-edit-phone');
  const telegramEl  = document.getElementById('prx-edit-telegram');
  const pixEl       = document.getElementById('prx-edit-pix');
  if (nameEl)     nameEl.value     = user.name               || '';
  if (typeEl)     typeEl.value     = user.promoter_type      || 'prp';
  if (igEl)       igEl.value       = user.promoter_instagram || '';
  if (regionEl)   regionEl.value   = user.promoter_region    || '';
  if (phoneEl)    phoneEl.value    = user.phone              || '';
  if (telegramEl) telegramEl.value = user.promoter_telegram  || '';
  if (pixEl)      pixEl.value      = user.pix_key            || '';

  // Atualiza preview da foto
  const previewAvatar = document.getElementById('prx-photo-preview-avatar');
  if (previewAvatar) {
    if (user.photo_url) {
      previewAvatar.style.backgroundImage    = `url('${user.photo_url}')`;
      previewAvatar.style.backgroundSize     = 'cover';
      previewAvatar.style.backgroundPosition = 'center';
      previewAvatar.textContent = '';
    } else {
      previewAvatar.style.backgroundImage = '';
      previewAvatar.textContent = (user.name || '⭐')[0].toUpperCase();
    }
  }

  // Esconde alerta anterior
  const alertEl = document.getElementById('prx-edit-alert');
  if (alertEl) alertEl.style.display = 'none';
}

function togglePromoterEdit(show) {
  // Navega para a aba Config e preenche o formulário (sempre visível nessa aba)
  _fillPromoterEditForm();
  const configBtn = document.querySelector(".pf-named-tab[onclick*=\"'config'\"]");
  pfPromoterSwitchTab('config', configBtn);
  // Rola até o formulário
  const editSection = document.getElementById('prx-edit-section');
  if (editSection) setTimeout(() => editSection.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
}

async function savePromoterProfile() {
  const user = OZ.currentUser;
  if (!user) return;

  const name      = (document.getElementById('prx-edit-name')?.value      || '').trim();
  const type      = document.getElementById('prx-edit-type')?.value        || user.promoter_type;
  const instagram = (document.getElementById('prx-edit-instagram')?.value || '').trim().replace(/^@/, '');
  const region    = (document.getElementById('prx-edit-region')?.value    || '').trim();
  const phone     = (document.getElementById('prx-edit-phone')?.value     || '').trim();
  const telegram  = (document.getElementById('prx-edit-telegram')?.value  || '').trim().replace(/^@/, '');
  const pix       = (document.getElementById('prx-edit-pix')?.value       || '').trim();

  const alertEl = document.getElementById('prx-edit-alert');

  if (!name) {
    if (alertEl) {
      alertEl.textContent   = 'O nome é obrigatório.';
      alertEl.className     = 'prx-alert prx-alert-error';
      alertEl.style.display = 'block';
    }
    showToast('Informe seu nome!', 'error');
    return;
  }

  const payload = {
    name,
    promoter_type:      type,
    promoter_instagram: instagram,
    promoter_region:    region,
    phone,
    promoter_telegram:  telegram,
    pix_key:            pix,
  };

  // Botão de salvamento: estado de carregamento
  const saveBtn = document.querySelector('.prx-btn-save');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Salvando…'; }

  try {
    // Salva na tabela users (se existir registro com ID real)
    if (user.id && !String(user.id).startsWith('demo')) {
      await apiPatch(`tables/users/${user.id}`, payload);
    }

    // Atualiza o estado local
    Object.assign(OZ.currentUser, payload);
    localStorage.setItem('oz_user', JSON.stringify(OZ.currentUser));

    // Atualiza a visualização
    const typeMap = { produtor:'🎬 Produtor', dj:'🎧 DJ', prp:'📣 PRP', agitador_cultural:'🎭 Agitador Cultural' };
    document.getElementById('prom-profile-name').textContent   = name;
    document.getElementById('ppinfo-type').textContent         = typeMap[type] || type || '—';
    document.getElementById('ppinfo-instagram').textContent    = instagram ? `@${instagram}` : '—';
    document.getElementById('ppinfo-region').textContent       = region || '—';
    document.getElementById('ppinfo-phone').textContent        = phone  || '—';
    document.getElementById('ppinfo-pix').textContent          = pix    || '—';

    // Feedback de sucesso
    if (alertEl) {
      alertEl.textContent   = '✅ Perfil atualizado com sucesso!';
      alertEl.className     = 'prx-alert prx-alert-success';
      alertEl.style.display = 'block';
    }
    showToast('Perfil atualizado! ✨', 'success');

    // Oculta o alerta de sucesso após 3s (formulário permanece visível na aba Config)
    setTimeout(() => { if (alertEl) alertEl.style.display = 'none'; }, 3000);

  } catch (err) {
    console.error('savePromoterProfile:', err);
    if (alertEl) {
      alertEl.textContent   = 'Erro ao salvar. Tente novamente.';
      alertEl.className     = 'prx-alert prx-alert-error';
      alertEl.style.display = 'block';
    }
    showToast('Erro ao salvar 😕', 'error');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fa fa-check"></i> Salvar alterações'; }
  }
}

/* ══════════════════════════════════
   COPY / SHARE — PROMOTER
══════════════════════════════════ */

/**
 * Monta a mensagem padrão de convite para o promoter.
 * Inclui o código de indicação no texto para que o novo
 * usuário possa digitar ao se cadastrar.
 */
function _buildPromoterMsg() {
  const user = OZ.currentUser;
  const code = user?.referral_code || document.getElementById('promo-code-text')?.textContent?.trim() || '';
  const name = user?.name || 'Promoter';
  return (
    `🌙 *Oz — Sua noite, suas regras!*\n\n` +
    `Oi! Sou o(a) *${name}* e quero te apresentar a *Oz*, a plataforma para curtir bares com benefícios exclusivos! 🍺🎉\n\n` +
    `Ao se cadastrar use meu código de indicação:\n` +
    `👉 *${code}*\n\n` +
    `Você ganha acesso a descontos e benefícios nos melhores bares da cidade. Bora? 🚀`
  );
}

/** Atualiza a pré-visualização da mensagem e o estado dos botões */
function updatePromoterShareUI() {
  const user     = OZ.currentUser;
  const phone    = user?.phone || '';
  const telegram = user?.promoter_telegram || '';
  const alertEl  = document.getElementById('promo-contact-alert');
  const waBtn    = document.getElementById('btn-share-whatsapp');
  const tgBtn    = document.getElementById('btn-share-telegram');
  const msgEl    = document.getElementById('promo-msg-text');
  const previewEl = document.getElementById('promo-msg-preview');

  const hasContact = phone || telegram;
  if (alertEl)   alertEl.style.display   = hasContact ? 'none' : 'flex';
  if (previewEl) previewEl.style.display  = hasContact ? 'block' : 'none';

  if (waBtn)  waBtn.disabled  = !phone;
  if (tgBtn)  tgBtn.disabled  = !telegram;

  if (msgEl && hasContact) msgEl.textContent = _buildPromoterMsg();
}

/** WhatsApp — abre conversa com o número do promoter já com a mensagem */
function shareViaWhatsApp() {
  const user  = OZ.currentUser;
  const phone = (user?.phone || '').replace(/\D/g, '');
  if (!phone) {
    showToast('Cadastre seu WhatsApp no Perfil primeiro 📱', 'error');
    return;
  }
  const text = encodeURIComponent(_buildPromoterMsg());
  // Abre conversa do próprio número (número de destino = número do promoter,
  // assim ele pode encaminhar ou copiar para enviar a quem quiser)
  window.open(`https://wa.me/${phone}?text=${text}`, '_blank');
}

/** Telegram — abre o perfil do promoter com mensagem pré-preenchida */
function shareViaTelegram() {
  const user     = OZ.currentUser;
  const username = (user?.promoter_telegram || '').replace(/^@/, '').trim();
  if (!username) {
    showToast('Cadastre seu Telegram no Perfil primeiro ✈️', 'error');
    return;
  }
  const text = encodeURIComponent(_buildPromoterMsg());
  window.open(`https://t.me/${username}?text=${text}`, '_blank');
}

/** Copia o número de WhatsApp do promoter para a área de transferência */
function copyPromoterContact() {
  const user     = OZ.currentUser;
  const approved = !user?.approval_status || user.approval_status === 'approved';
  if (!approved) {
    showToast('Seu cadastro ainda não foi aprovado. O código de convite fica disponível após a aprovação.', 'error');
    return;
  }
  const phone = user?.phone || '';
  if (!phone) {
    showToast('Nenhum WhatsApp cadastrado 😕', 'error');
    return;
  }
  copyToClipboard(phone);
  showToast('Número copiado! 📋', 'success');
}

/* Mantidos por compatibilidade com chamadas legadas */
function copyReferralCode()  { copyPromoterContact(); }
function copyReferralLink()  { copyPromoterContact(); }
function shareReferralLink() { shareViaWhatsApp(); }
function shareViaSMS()       {}   // removido
function shareViaEmail()     {}   // removido

function copyToClipboard(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta); ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

/* ══════════════════════════════════
   MODAL RESGATE
══════════════════════════════════ */

// Retorna true se o promoter já fez um saque no mês corrente
async function _hasWithdrawThisMonth() {
  const uid = OZ.currentUser?.id;
  if (!uid) return false;
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth();           // 0-11
  const res   = await apiGet(`tables/withdrawals?limit=50&sort=created_at`);
  const rows  = res?.data || [];
  return rows.some(w => {
    if (w.promoter_id !== uid) return false;
    const d = new Date(w.created_at);
    return d.getFullYear() === year && d.getMonth() === month;
  });
}

async function openWithdrawModal() {
  const bal = OZ.currentUser?.balance || 0;
  document.getElementById('modal-withdraw-balance').textContent =
    `R$ ${bal.toFixed(2).replace('.',',')}`;
  document.getElementById('withdraw-alert').style.display = 'none';
  const pixEl = document.getElementById('withdraw-pix');
  if (OZ.currentUser?.pix_key) pixEl.value = OZ.currentUser.pix_key;

  // Verifica limite mensal antes de abrir
  try {
    if (await _hasWithdrawThisMonth()) {
      showToast('Você já realizou um resgate este mês. Aguarde o próximo mês.', 'error');
      return;
    }
  } catch { /* se falhar a consulta, deixa abrir */ }

  openModal('modal-withdraw');
}

async function requestWithdraw() {
  const alertEl = document.getElementById('withdraw-alert');
  alertEl.style.display = 'none';
  const amount = parseFloat(document.getElementById('withdraw-amount').value);
  const pix    = document.getElementById('withdraw-pix').value.trim();
  const notes  = document.getElementById('withdraw-notes').value.trim();
  const bal    = OZ.currentUser?.balance || 0;

  if (!amount || amount <= 0) { showWithdrawAlert('Informe um valor válido.'); return; }
  if (amount > bal)            { showWithdrawAlert(`Saldo insuficiente. Disponível: R$${bal.toFixed(2).replace('.',',')}`); return; }
  if (!pix)                    { showWithdrawAlert('Informe sua chave Pix.'); return; }

  // Dupla verificação no momento do envio
  try {
    if (await _hasWithdrawThisMonth()) {
      showWithdrawAlert('Você já realizou um resgate este mês. Aguarde o próximo mês.');
      return;
    }
  } catch { /* prossegue se a consulta falhar */ }

  try {
    // ── EDGE FUNCTION: solicitar-saque (valida saldo e debita no servidor) ──
    const result = await edgeFn('bright-endpoint', { amount, pix_key: pix, notes });
    // Atualiza cache local com o saldo retornado pelo servidor
    if (!OZ.currentUser.id.startsWith('demo-')) {
      OZ.currentUser.balance = result?.novo_saldo ?? (bal - amount);
    }
    closeModal('modal-withdraw');
    showToast(`Resgate de R$${amount.toFixed(2).replace('.',',')} solicitado! Depósito em até 7 dias úteis. ✅`, 'success');
    loadPromoterHome();
  } catch (err) {
    showWithdrawAlert(err?.message || 'Erro ao solicitar resgate. Tente novamente.');
  }
}

function showWithdrawAlert(msg) {
  const el = document.getElementById('withdraw-alert');
  el.textContent = msg; el.className = 'alert alert-error'; el.style.display = 'block';
}

/* ══════════════════════════════════
   MODAIS UTILS
══════════════════════════════════ */
function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  document.body.style.overflow = '';
  // Para o poll do chat se fechar o modal de chat
  if (id === 'modal-chat' && OZ.chatPollInterval) {
    clearInterval(OZ.chatPollInterval);
    OZ.chatPollInterval = null;
  }
  // Limpa estado do modal de cancelamento de benefício
  if (id === 'modal-cancel-promo') {
    OZ.cancelPromoId          = null;
    OZ.cancelPromoTitle       = null;
    OZ.cancelPromoIsScheduled = false;
  }
  // Para o poll do chat cliente-promoter
  if (id === 'modal-client-promo-chat' && OZ._clientPromoChatPoll) {
    clearInterval(OZ._clientPromoChatPoll);
    OZ._clientPromoChatPoll = null;
  }
}
function closeModalOnOverlay(e) {
  if (e.target === e.currentTarget) closeModal(e.currentTarget.id);
}

/* ══════════════════════════════════
   TOAST
══════════════════════════════════ */
let toastT = null;
function showToast(msg, type='', duration=3200) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className   = `toast ${type} show`;
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), duration);
  // Log no console para debug
  const prefix = type === 'error' ? '\u274c' : type === 'success' ? '\u2705' : 'ℹ️';
  console.log(`[toast] ${prefix} ${msg}`);
}

/* ══════════════════════════════════
   HELPERS
══════════════════════════════════ */
function showAlertEl(el, msg, type='error') {
  el.textContent = msg;
  el.className   = `alert alert-${type}`;
  el.style.display = 'block';
}

function setLoading(textId, spinnerId, text, loading=true) {
  const btn = document.getElementById(textId);
  const spin= document.getElementById(spinnerId);
  if (btn)  btn.innerHTML  = loading ? text : text;
  if (spin) spin.style.display = loading ? 'inline' : 'none';
}

function generateReferralCode(name) {
  const clean = (name||'USER').toUpperCase().replace(/[^A-Z]/g,'').slice(0,5);
  return `${clean}${Math.floor(1000+Math.random()*9000)}`;
}

function generateQRData(userId, barId, type) {
  const ts   = Date.now();
  const rand = Math.random().toString(36).slice(2,7).toUpperCase();
  return `OZ|${type.toUpperCase()}|BAR:${barId}|USR:${userId}|${ts}|${rand}`;
}

function getExpiryTime() {
  const now = new Date(), exp = new Date(now);
  if (now.getHours() >= 6) exp.setDate(exp.getDate()+1);
  exp.setHours(6,0,0,0);
  return exp.toISOString();
}

function getGreeting() {
  const h = new Date().getHours();
  if (h>=5  && h<12) return 'Bom dia ☀️';
  if (h>=12 && h<18) return 'Boa tarde 🌤️';
  return 'Boa noite 🌙';
}

function formatDate(ts) {
  if (!ts) return 'Hoje';
  return new Date(ts).toLocaleDateString('pt-BR');
}

function formatDateBR(dateStr) {
  if (!dateStr) return '—';
  const [y,m,d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function skeletonCards(n=3, h='200px') {
  return Array(n).fill('')
    .map(() => `<div class="skeleton" style="height:${h};border-radius:16px;margin-bottom:12px;background:linear-gradient(90deg,#1a1a24 25%,#22222e 50%,#1a1a24 75%);background-size:200% 100%;animation:shimmer 1.5s infinite"></div>`)
    .join('');
}

function checkEmailDuplicate(email) {
  return apiGet(`tables/users?search=${encodeURIComponent(email)}&limit=20`)
    .then(res => {
      const dup = (res.data||[]).find(u => u.email === email);
      if (dup) throw new Error('Este e-mail já está cadastrado. Faça login ou use outro e-mail.');
    });
}

function checkCPFDuplicate(cpf) {
  const cpfClean = cpf.replace(/\D/g, '');
  return apiGet(`tables/users?search=${encodeURIComponent(cpfClean)}&limit=20`)
    .then(res => {
      const dup = (res.data||[]).find(u => u.cpf && u.cpf.replace(/\D/g, '') === cpfClean);
      if (dup) throw new Error('Este CPF já está cadastrado. Cada pessoa pode ter apenas uma conta.');
    });
}

/* ══════════════════════════════════
   MAPAS
══════════════════════════════════ */
const genreMap = {
  balada:'🎵 Balada', boteco:'🍺 Boteco', pub:'🎸 Pub',
  rooftop:'🌆 Rooftop', lounge:'🛋️ Lounge', sertanejo:'🤠 Sertanejo',
  pagode:'🥁 Pagode', rock:'🎸 Rock', eletronica:'🎧 Eletrônica',
  mpb:'🎶 MPB/Jazz', diversificado:'🎼 Diversificado',
};
const genderMap = {
  masculino:'Masculino', feminino:'Feminino', nao_binario:'Não-binário',
  outro:'Outro', prefiro_nao_dizer:'Prefiro não dizer',
};
const promoTypeMap = {
  drink:'🍹 Drink', desconto:'💰 Desconto', entrada:'🎟️ Entrada',
  petisco:'🍟 Petisco', especial:'⭐ Especial',
};

/* ══════════════════════════════════
   FALLBACKS
══════════════════════════════════ */
const DEF_IMG = 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=600&q=80';
const FALLBACK_BARS = [
  { id:'fb1', name:'Bar da Laje',     neighborhood:'Pinheiros',    genre:'rooftop',   benefit:'1 drink grátis na chegada',         photo_url:'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=600&q=80', description:'O melhor bar de Pinheiros com drinks autorais e uma vista incrível do terraço.', event_tonight:'DJ Set com Marcos Viana — a partir das 22h' },
  { id:'fb2', name:'Neon District',   neighborhood:'Vila Madalena', genre:'eletronica',benefit:'Entrada sem fila + shot grátis',     photo_url:'https://images.unsplash.com/photo-1574096079513-d8259312b785?w=600&q=80', description:'Ambiente neon e underground com DJs locais toda semana.', event_tonight:'Festa Eletrônica Neon Night — a partir das 23h' },
  { id:'fb3', name:'The Purple Room', neighborhood:'Consolação',   genre:'lounge',    benefit:'2x1 em caipirinhas até meia-noite', photo_url:'https://images.unsplash.com/photo-1572116469696-31de0f17cc34?w=600&q=80', description:'Bar com conceito exclusivo, drinques criativos e ambiente intimista.', event_tonight:'Acústico ao vivo — Clássicos do Rock 21h' },
  { id:'fb4', name:'Rooftop 360',     neighborhood:'Jardins',      genre:'rooftop',   benefit:'Mesa VIP reservada + petisco',       photo_url:'https://images.unsplash.com/photo-1545670723-196ed0954986?w=600&q=80', description:'Bar no topo com vista 360° para a cidade. Drinks premium e petiscos gourmet.', event_tonight:'Happy Hour Executivo — drinks 30% off até 21h' },
  { id:'fb5', name:'Boteco Noise',    neighborhood:'Santa Cecília', genre:'rock',     benefit:'Chope grátis no primeiro pedido',    photo_url:'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&q=80', description:'Boteco moderno com chope gelado, tira-gostos e muito rock.', event_tonight:'Karaokê Rock Night — toda quarta a partir das 20h' },
];
const DEMO_BAR_DATA = {
  name:'Bar da Laje', neighborhood:'Pinheiros', description:'O melhor bar de Pinheiros.',
  benefit:'1 drink grátis na chegada', photo_url: DEF_IMG, active: true, event_tonight:'DJ Set — 22h', peak_hour:'23h–01h',
};

/* ══════════════════════════════════
   SHIMMER CSS INJECT
══════════════════════════════════ */
(function() {
  const s = document.createElement('style');
  s.textContent = '@keyframes shimmer{from{background-position:200% 0}to{background-position:-200% 0}}';
  document.head.appendChild(s);
})();

/* ══════════════════════════════════════════════════════════
   OZ FEED — Layout estilo Instagram
   Usado em: home do cliente · Explorar do bar · Explorar do promoter
══════════════════════════════════════════════════════════ */

window.OZFeed = (function() {
  'use strict';

  /* ─── Estado interno ─── */
  let _activeFeed   = null;   // elemento DOM do feed ativo
  let _currentBars  = [];
  let _currentPromos= {};
  let _mode         = 'client'; // 'client' | 'bar' | 'promoter'
  let _onOpenBar    = null;     // callback ao clicar no botão de CTA
  let _topbarEl     = null;
  let _dotsEl       = null;
  let _hintShown    = false;
  let _scrollTimer  = null;
  let _currentIndex = 0;

  /* ─── Helpers ─── */
  const DEF_BG = 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=800&q=80';

  function _genreLabel(bar) {
    const gm = window.genreMap || {};
    return gm[bar.genre || bar.bar_genre] || '';
  }

  function _ratingHtml(bar) {
    const cache = (OZ._ratingsCache || {})[bar.id];
    if (!cache || !cache.total) return '';
    const avg = cache.avg;
    const f   = Math.floor(avg);
    const h   = avg - f >= 0.5;
    const stars = Array.from({length:5},(_,i) =>
      `<i class="${i<f?'fa fa-star':i===f&&h?'fa fa-star-half-alt':'far fa-star'}"></i>`
    ).join('');
    return `<div class="oz-slide-rating">
      <div class="oz-stars">${stars}</div>
      <span class="oz-rating-avg">${avg.toFixed(1)}</span>
      <span class="oz-rating-count">(${cache.total})</span>
    </div>`;
  }

  function _isFav(barId) {
    return (OZ.favoriteBars || []).includes(barId);
  }

  /* ─── Criar slide ─── */
  function _makeSlide(bar, promoMap, index) {
    const promos      = promoMap[bar.id] || [];
    const promo       = promos[0];
    const isScheduled = promo?._source === 'scheduled';
    const benefitText = promo?.title || bar.benefit || 'Benefício exclusivo';
    const benefitDesc = promo?.description || bar.description || '';
    const imgSrc      = bar.cover_url || bar.photo_url || DEF_BG;
    const fav         = _isFav(bar.id);

    const badgeClass  = isScheduled ? 'oz-badge-sched' : 'oz-badge-live';
    const badgeIcon   = isScheduled ? 'fa-calendar-check' : 'fa-bolt';
    const badgeLabel  = isScheduled ? 'HOJE' : 'ATIVO';

    let ctaHtml = '';
    if (_mode === 'promoter') {
      ctaHtml = `<button class="oz-cta-btn oz-cta-btn-promoter oz-cta" data-idx="${index}">
        <i class="fa fa-bolt"></i> Ativar com cliente
      </button>`;
    } else {
      ctaHtml = `<button class="oz-cta-btn oz-cta" data-idx="${index}">
        <i class="fa fa-ticket-alt"></i> Ver benefício
      </button>`;
    }

    const slide = document.createElement('div');
    slide.className = 'oz-slide';
    slide.dataset.idx = index;

    slide.innerHTML = `
      <div class="oz-slide-bg" style="background-image:url('${imgSrc}')"></div>
      <div class="oz-slide-overlay"></div>

      <!-- Badge topo esquerdo -->
      <div class="oz-slide-badge ${badgeClass}">
        <i class="fa ${badgeIcon}"></i> ${badgeLabel}
      </div>

      <!-- Ações laterais direita -->
      <div class="oz-slide-actions">
        <div class="oz-action-wrap">
          <button class="oz-action-btn oz-fav-btn${fav?' oz-liked':''}" data-bar-id="${bar.id}" aria-label="Favoritar">
            <i class="fa fa-heart"></i>
          </button>
          <span class="oz-action-lbl">${fav?'Salvo':'Salvar'}</span>
        </div>
        <div class="oz-action-wrap">
          <button class="oz-action-btn oz-share-btn" data-bar-id="${bar.id}" aria-label="Compartilhar">
            <i class="fa fa-share-alt"></i>
          </button>
          <span class="oz-action-lbl">Enviar</span>
        </div>
        ${_ratingHtml(bar) ? `<div class="oz-action-wrap">
          <button class="oz-action-btn oz-info-btn" data-idx="${index}" aria-label="Info">
            <i class="fa fa-info"></i>
          </button>
          <span class="oz-action-lbl">Info</span>
        </div>` : ''}
      </div>

      <!-- Conteúdo inferior -->
      <div class="oz-slide-content">
        <div class="oz-bar-label">
          <i class="fa fa-store"></i>
          ${_genreLabel(bar) || 'Bar'}
        </div>
        <h2 class="oz-bar-name">${bar.name}</h2>
        ${_ratingHtml(bar)}
        <p class="oz-bar-hood">
          <i class="fa fa-map-marker-alt"></i>
          ${bar.neighborhood || '—'}
          ${bar.total_activations ? `&nbsp;·&nbsp;<i class="fa fa-bolt"></i> ${bar.total_activations} ativações` : ''}
        </p>
        <div class="oz-benefit-card">
          <div class="oz-benefit-icon"><i class="fa fa-gift"></i></div>
          <div class="oz-benefit-text">
            <p class="oz-benefit-title">${benefitText}</p>
            ${benefitDesc ? `<p class="oz-benefit-desc">${benefitDesc}</p>` : ''}
          </div>
        </div>
        ${ctaHtml}
      </div>

      ${index === 0 && !_hintShown ? `
      <div class="oz-swipe-hint">
        <i class="fa fa-chevron-up"></i>
        <span>Deslize para cima</span>
      </div>` : ''}
    `;

    /* Eventos do slide */
    slide.querySelector('.oz-cta')?.addEventListener('click', (e) => {
      e.stopPropagation();
      _handleCTA(bar);
    });

    slide.querySelector('.oz-fav-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      _toggleFav(bar, e.currentTarget);
    });

    slide.querySelector('.oz-share-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      _shareBenefit(bar, benefitText);
    });

    slide.querySelector('.oz-info-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      _handleCTA(bar);
    });

    return slide;
  }

  /* ─── Abrir feed ─── */
  let _feedOriginalParent = null;
  let _feedOriginalNextSibling = null;

  function open(feedId, bars, promoMap, mode, onOpen) {
    _currentBars   = bars;
    _currentPromos = promoMap;
    _mode          = mode || 'client';
    _onOpenBar     = onOpen || null;
    _currentIndex  = 0;

    const feedEl = document.getElementById(feedId);
    if (!feedEl) return;
    _activeFeed = feedEl;

    /* Limpa e constrói slides */
    feedEl.innerHTML = '';
    if (!bars.length) { feedEl.style.display = 'none'; return; }

    bars.forEach((bar, i) => {
      feedEl.appendChild(_makeSlide(bar, promoMap, i));
    });

    /* Move o feed para o body para escapar de contextos de overflow/stacking */
    _feedOriginalParent = feedEl.parentNode;
    _feedOriginalNextSibling = feedEl.nextSibling;
    document.body.appendChild(feedEl);

    /* Top bar flutuante */
    _buildTopbar(bars.length);

    /* Dots indicadores */
    _buildDots(bars.length);

    /* Mostra feed */
    feedEl.style.display = 'block';

    /* Marca slide ativo inicial */
    _markActive(0);

    /* Scroll listener */
    feedEl.addEventListener('scroll', _onFeedScroll, { passive: true });

    /* Flag hint mostrado */
    if (!_hintShown) _hintShown = true;

    /* Previne scroll do body */
    document.body.style.overflow = 'hidden';
  }

  /* ─── Fechar feed ─── */
  function close() {
    if (_activeFeed) {
      _activeFeed.removeEventListener('scroll', _onFeedScroll);
      _activeFeed.style.display = 'none';
      /* Devolve o elemento ao lugar original no DOM */
      if (_feedOriginalParent) {
        _feedOriginalParent.insertBefore(_activeFeed, _feedOriginalNextSibling || null);
        _feedOriginalParent = null;
        _feedOriginalNextSibling = null;
      }
      _activeFeed = null;
    }
    if (_topbarEl) { _topbarEl.remove(); _topbarEl = null; }
    if (_dotsEl)   { _dotsEl.remove();   _dotsEl   = null; }
    document.body.style.overflow = '';
    _currentIndex = 0;
  }

  /* ─── Top bar ─── */
  function _buildTopbar(total) {
    if (_topbarEl) _topbarEl.remove();
    const tb = document.createElement('div');
    tb.className = 'oz-feed-topbar';
    tb.id = 'oz-feed-topbar';
    tb.innerHTML = `
      <div class="oz-feed-topbar-left">
        <button class="oz-feed-close-btn" id="oz-feed-close-btn" aria-label="Fechar feed">
          <i class="fa fa-chevron-down"></i>
        </button>
        <span class="oz-feed-topbar-logo">OZ</span>
      </div>
      <div class="oz-feed-topbar-right">
        <span class="oz-feed-counter" id="oz-feed-counter">1 / ${total}</span>
      </div>
    `;
    document.body.appendChild(tb);
    _topbarEl = tb;
    tb.querySelector('#oz-feed-close-btn').addEventListener('click', () => {
      close();
    });
  }

  /* ─── Progress dots ─── */
  function _buildDots(total) {
    if (_dotsEl) _dotsEl.remove();
    if (total > 20) return; // muitos bares: oculta dots
    const wrap = document.createElement('div');
    wrap.className = 'oz-feed-dots';
    wrap.id = 'oz-feed-dots';
    for (let i = 0; i < total; i++) {
      const d = document.createElement('div');
      d.className = 'oz-feed-dot' + (i === 0 ? ' oz-dot-active' : '');
      d.dataset.i = i;
      wrap.appendChild(d);
    }
    document.body.appendChild(wrap);
    _dotsEl = wrap;
  }

  /* ─── Marca slide ativo e atualiza UI ─── */
  function _markActive(idx) {
    if (!_activeFeed) return;
    _currentIndex = idx;

    /* Slides */
    _activeFeed.querySelectorAll('.oz-slide').forEach((s, i) => {
      s.classList.toggle('oz-active', i === idx);
    });

    /* Counter */
    const counter = document.getElementById('oz-feed-counter');
    if (counter) counter.textContent = `${idx+1} / ${_currentBars.length}`;

    /* Dots */
    if (_dotsEl) {
      _dotsEl.querySelectorAll('.oz-feed-dot').forEach((d, i) => {
        d.classList.toggle('oz-dot-active', i === idx);
      });
    }
  }

  /* ─── Scroll handler ─── */
  function _onFeedScroll() {
    if (!_activeFeed) return;
    clearTimeout(_scrollTimer);
    _scrollTimer = setTimeout(() => {
      const h   = _activeFeed.clientHeight;
      const top = _activeFeed.scrollTop;
      const idx = Math.round(top / h);
      if (idx !== _currentIndex) _markActive(idx);
    }, 80);
  }

  /* ─── CTA ─── */
  function _handleCTA(bar) {
    if (_onOpenBar) { _onOpenBar(bar); return; }
    if (_mode === 'client')   { if (window.openBarDetail)         openBarDetail(bar); }
    if (_mode === 'bar')      { if (window.openBarDetailReadOnly) openBarDetailReadOnly(bar); }
    if (_mode === 'promoter') { if (window.openPromoterBarDetail) openPromoterBarDetail(bar);
                                else if (window.openBarDetailReadOnly) openBarDetailReadOnly(bar); }
  }

  /* ─── Favoritar ─── */
  function _toggleFav(bar, btn) {
    const favs = OZ.favoriteBars || [];
    const idx  = favs.indexOf(bar.id);
    if (idx >= 0) {
      favs.splice(idx, 1);
      btn.classList.remove('oz-liked');
      const lbl = btn.closest('.oz-action-wrap')?.querySelector('.oz-action-lbl');
      if (lbl) lbl.textContent = 'Salvar';
    } else {
      favs.push(bar.id);
      btn.classList.add('oz-liked');
      const lbl = btn.closest('.oz-action-wrap')?.querySelector('.oz-action-lbl');
      if (lbl) lbl.textContent = 'Salvo';
      /* Mini haptic via vibration API */
      if (navigator.vibrate) navigator.vibrate(30);
    }
    OZ.favoriteBars = favs;
    localStorage.setItem('oz_fav_bars', JSON.stringify(favs));
    /* Salva no backend se disponível */
    if (window._saveFavBarToServer) _saveFavBarToServer(bar.id, idx < 0);
  }

  /* ─── Compartilhar ─── */
  function _shareBenefit(bar, benefitText) {
    const text = `🍺 *${bar.name}* — ${bar.neighborhood}\n🎁 ${benefitText}\n\nVeja na OZ: oz.app`;
    if (navigator.share) {
      navigator.share({ title: bar.name, text });
    } else {
      /* Fallback: WhatsApp */
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    }
  }

  /* ─── Público ─── */
  return { open, close };

})(); // OZFeed

/* OZFeed integrations removidas — listas clássicas reativadas */


/* ══════════════════════════════════
   INIT
══════════════════════════════════ */
/* ─────────────────────────────────────────────────────────────
   PICKER DE LIMITE DE ATIVAÇÕES — "Publicar benefício"
───────────────────────────────────────────────────────────── */
function setPromoLimit(active) {
  const btnOff  = document.getElementById('plt-off');
  const btnOn   = document.getElementById('plt-on');
  const wrap    = document.getElementById('promo-limit-input-wrap');
  const note    = document.getElementById('promo-limit-note');
  if (!btnOff || !btnOn || !wrap) return;
  if (active) {
    btnOn.classList.add('active');
    btnOff.classList.remove('active');
    wrap.style.display = 'flex';
    if (note) note.textContent = 'O benefício será desativado automaticamente ao atingir o limite.';
  } else {
    btnOff.classList.add('active');
    btnOn.classList.remove('active');
    wrap.style.display = 'none';
    if (note) note.textContent = 'O benefício ficará visível para todos sem restrição de vagas.';
  }
}
function stepPromoLimit(delta) {
  const input = document.getElementById('new-promo-max');
  if (!input) return;
  let val = (parseInt(input.value, 10) || 50) + delta;
  if (val < 1) val = 1;
  if (val > 9999) val = 9999;
  input.value = val;
}
function clampPromoLimit(el) {
  let val = parseInt(el.value, 10);
  if (isNaN(val) || val < 1) el.value = 1;
  else if (val > 9999) el.value = 9999;
}

/* PICKER DE LIMITE DE ATIVAÇÕES — "Agendar benefício" */
function setSchedLimit(active) {
  const btnOff  = document.getElementById('sched-plt-off');
  const btnOn   = document.getElementById('sched-plt-on');
  const wrap    = document.getElementById('sched-limit-input-wrap');
  const note    = document.getElementById('sched-limit-note');
  if (!btnOff || !btnOn || !wrap) return;
  if (active) {
    btnOn.classList.add('active');
    btnOff.classList.remove('active');
    wrap.style.display = 'flex';
    if (note) note.textContent = 'O benefício será desativado ao atingir o número definido.';
  } else {
    btnOff.classList.add('active');
    btnOn.classList.remove('active');
    wrap.style.display = 'none';
    if (note) note.textContent = 'Sem limite: qualquer número de clientes pode ativar.';
  }
}
function stepSchedLimit(delta) {
  const input = document.getElementById('sched-max');
  if (!input) return;
  let val = (parseInt(input.value, 10) || 50) + delta;
  if (val < 1) val = 1;
  if (val > 9999) val = 9999;
  input.value = val;
}
function clampSchedLimit(el) {
  let val = parseInt(el.value, 10);
  if (isNaN(val) || val < 1) el.value = 1;
  else if (val > 9999) el.value = 9999;
}

document.addEventListener('DOMContentLoaded', () => {
  // Definir data máxima para nascimento (18 anos atrás)
  const maxDate = document.getElementById('c-birthdate');
  if (maxDate) {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 18);
    maxDate.max = d.toISOString().split('T')[0];
  }

  (async () => {
    try {
      /* ── 1) Detecta link de recovery do Supabase Auth ─────────────────
         O Supabase redireciona com tokens no hash (#) ou código PKCE (?code=)
         Prioridade: verificar ANTES de qualquer auto-login                  */
      if (typeof SupaAuth !== 'undefined') {

        // Formato implícito: #access_token=...&type=recovery
        const hashResult = SupaAuth.setSessionFromHash();
        if (hashResult?.type === 'recovery') {
          _showResetScreen();
          return;
        }

        // Formato PKCE: ?code=...
        const urlParams = new URLSearchParams(window.location.search);
        const code      = urlParams.get('code');
        if (code) {
          try {
            const pkceResult = await SupaAuth.exchangeCodeForSession(code);
            if (pkceResult?.type === 'recovery') {
              _showResetScreen();
              return;
            }
          } catch (e) {
            console.warn('[Reset] Falha ao trocar código PKCE:', e.message);
            _showResetInvalid();
            return;
          }
        }
      }

      /* ── 2) Restaurar sessão normal: Supabase Auth + cache local ───── */
      let authValid = false;
      if (typeof SupaAuth !== 'undefined') {
        const sess = await SupaAuth.getSession();
        authValid  = !!sess?.access_token;
      }

      const saved = localStorage.getItem('oz_user');
      if (saved && authValid) {
        const user = JSON.parse(saved);
        OZ.currentUser = user;
        routeToHome(user);
        // Re-busca em segundo plano para dados atualizados
        if (user.id && !user.id.startsWith('demo-')) {
          apiGet(`tables/users/${user.id}`).then(fresh => {
            if (fresh && fresh.id) {
              OZ.currentUser = fresh;
              localStorage.setItem('oz_user', JSON.stringify(fresh));
            }
          }).catch(() => {});
        }
        return;
      }

      /* ── 3) Sessão expirada: limpa cache ──────────────────────────── */
      if (saved && !authValid) {
        localStorage.removeItem('oz_user');
      }
    } catch { /* ignorar */ }

    // Sem sessão válida: mostra a tela de boas-vindas
    showScreen('screen-welcome');
  })();
});

/* Exibe a tela de redefinição com formulário ativo */
function _showResetScreen() {
  document.getElementById('rp-state-form').style.display    = 'block';
  document.getElementById('rp-state-invalid').style.display = 'none';
  document.getElementById('rp-state-done').style.display    = 'none';
  showScreen('screen-reset-password');
}

/* Exibe a tela de redefinição com estado de link inválido */
function _showResetInvalid() {
  document.getElementById('rp-state-form').style.display    = 'none';
  document.getElementById('rp-state-invalid').style.display = 'block';
  document.getElementById('rp-state-done').style.display    = 'none';
  showScreen('screen-reset-password');
}
