/* ═══════════════════════════════════════════════════════════
   OZ ADMIN — Lógica de aprovação de promoters e bares
═══════════════════════════════════════════════════════════ */

'use strict';

/* ── Allowlist de status de ativação com pagamento confirmado ──────────────
   Todos os renders do admin usam esta constante como fonte única da verdade.
   Apenas 'active' representa pagamento confirmado.
   'pending', 'pending_payment', 'failed', 'cancelled' → excluídos em todos os filtros.
─────────────────────────────────────────────────────────────────────────── */
const ACT_PAID_STATUS = new Set(['active']);

/* Tipos internos que nunca devem aparecer em métricas de ativação */
const ACT_INTERNAL_TYPES = new Set(['free_credit', 'free_credit_used', 'night_checkin']);

/**
 * Filtro canônico de ativação com pagamento confirmado.
 * Use em TODOS os renders do admin para garantir consistência.
 * @param {object} a - registro de ativação
 * @returns {boolean}
 */
function isConfirmedAct(a) {
  return ACT_PAID_STATUS.has(a.status) && !ACT_INTERNAL_TYPES.has(a.type);
}

/**
 * Variante que inclui ativações gratuitas confirmadas (amount = 0, status = 'active').
 * Usada nos rankings de contagem total de ativações por cliente/bar.
 */
function isConfirmedActAny(a) {
  return ACT_PAID_STATUS.has(a.status) && !ACT_INTERNAL_TYPES.has(a.type);
}

/* ── Credenciais do admin (iguais ao login do app) ── */
const ADMIN_CREDENTIALS = {
  email: 'admin@oz.com',
  pass:  'oz@admin2025',
};

/* ── Estado global ── */
const ADM = {
  loggedIn:      false,
  currentTab:    'pending',
  typeFilter:    'all',
  allUsers:      [],       // todos os users com role bar | promoter
  currentItemId: null,     // ID do item sendo aprovado/rejeitado
  currentType:   null,     // 'promoter' | 'bar'
  pendingAction: null,     // 'approve' | 'reject' | 'revert'
};

/* ── Supabase config ── */
const SB_URL   = 'https://qyxefytxyrmvotjnhoir.supabase.co/rest/v1';
const SB_ANON  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5eGVmeXR4eXJtdm90am5ob2lyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3Mjk4NzQsImV4cCI6MjA5MjMwNTg3NH0.6TSq1HjRyS9D2lBGvrjLT0oTPT-QT752DgdBbHrltq8';

/* Gera headers REST com o JWT da sessão admin (ativa a policy admin_full_access no RLS) */
async function sbAdminHeaders(extra = {}) {
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

/*
 * Traduz path legado "tabela?param=val" ou "tabela/id"
 * para URL Supabase.
 */
function _sbUrl(path) {
  const [base, qs] = path.split('?');
  const parts      = base.split('/');
  const table      = parts[0];
  const recordId   = parts[1] || null;

  const params = new URLSearchParams();

  if (recordId) {
    params.set('id', `eq.${recordId}`);
  } else if (qs) {
    const legacy = new URLSearchParams(qs);

    const limit  = parseInt(legacy.get('limit')  || '100', 10);
    const page   = parseInt(legacy.get('page')   || '1',   10);
    params.set('limit',  String(limit));
    params.set('offset', String((page - 1) * limit));

    const sort = legacy.get('sort');
    if (sort) params.set('order', `${sort}.desc`);

    const search = legacy.get('search');
    if (search) {
      const s = search.replace(/'/g, "''");
      const searchCols = {
        users:              ['email', 'name', 'cpf', 'referral_code'],
        bars:               ['name', 'neighborhood'],
        activations:        ['user_name', 'bar_name', 'user_id'],
        scheduled_benefits: ['bar_id', 'title', 'date'],
        earnings:           ['promoter_id', 'reason'],
        withdrawals:        ['promoter_id'],
        reviews:            ['bar_id', 'user_name'],
      };
      const cols = searchCols[table] || ['id'];
      params.set('or', `(${cols.map(c => `${c}.ilike.*${s}*`).join(',')})`);
    }
  } else {
    params.set('limit', '500');
  }

  return `${SB_URL}/${table}?${params.toString()}`;
}

async function apiFetch(path, opts = {}) {
  const url  = _sbUrl(path);
  const hdrs = await sbAdminHeaders(opts.headers || {});
  // cache: 'no-store' garante que todos os GETs sempre buscam do banco,
  // nunca do cache HTTP do browser
  const fetchOpts = { ...opts, headers: hdrs };
  if (!opts.method || opts.method === 'GET') fetchOpts.cache = 'no-store';
  const res  = await fetch(url, fetchOpts);
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  if (res.status === 204) return null;
  const data = await res.json();
  // Compatibilidade: path com /id retorna objeto, sem /id retorna {data:[]}
  if (path.split('?')[0].split('/').length === 2) {
    return Array.isArray(data) ? (data[0] || null) : data;
  }
  return { data: Array.isArray(data) ? data : [], total: data.length };
}

const apiGet = (path) => apiFetch(path);

const apiPatch = (path, body) => {
  const now = Date.now();
  return apiFetch(path, {
    method:  'PATCH',
    headers: { 'Prefer': 'return=representation' },
    body:    JSON.stringify({ ...body, updated_at: now }),
  }).then(r => Array.isArray(r) ? r[0] : r);
};

/* ══════════════════════════════════════════════════
   LOGIN
══════════════════════════════════════════════════ */
async function doAdminLogin() {
  const u      = document.getElementById('admin-user').value.trim();
  const p      = document.getElementById('admin-pass').value;
  const errEl  = document.getElementById('login-error');
  const btnEl  = document.getElementById('admin-login-btn');

  // Valida credenciais localmente primeiro (evita chamada desnecessária)
  if (u !== ADMIN_CREDENTIALS.email || p !== ADMIN_CREDENTIALS.pass) {
    errEl.textContent    = '❌ E-mail ou senha incorretos.';
    errEl.style.display  = 'block';
    document.getElementById('admin-pass').value = '';
    return;
  }

  errEl.style.display = 'none';
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Entrando...'; }

  try {
    // Autentica via Supabase Auth — gera JWT com email admin@oz.com
    // Esse JWT ativa a policy admin_full_access em todas as tabelas
    await SupaAuth.signIn(ADMIN_CREDENTIALS.email, ADMIN_CREDENTIALS.pass);
  } catch (err) {
    // Se o usuário admin ainda não existir no Supabase Auth, alerta mas não bloqueia
    console.warn('[Admin] Supabase Auth signIn falhou:', err.message,
      '— verifique se admin@oz.com existe em Authentication > Users no Supabase.');
  }

  ADM.loggedIn = true;
  sessionStorage.setItem('oz_admin', '1');

  if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Entrar'; }
  document.getElementById('admin-login').style.display = 'none';
  document.getElementById('admin-panel').style.display = 'flex';
  loadBalanco();
}

function doAdminLogout() {
  ADM.loggedIn = false;
  sessionStorage.removeItem('oz_admin');
  // Invalida cache do JWT admin para forçar novo login na próxima sessão
  _adminJwtCache = null;
  // Encerra sessão no Supabase Auth (não-bloqueante)
  if (typeof SupaAuth !== 'undefined') SupaAuth.signOut().catch(() => {});
  document.getElementById('admin-panel').style.display = 'none';
  document.getElementById('admin-login').style.display = 'flex';
  document.getElementById('admin-user').value = '';
  document.getElementById('admin-pass').value = '';
}

/* Auto-login se sessão ativa */
window.addEventListener('DOMContentLoaded', async () => {
  if (sessionStorage.getItem('oz_admin') !== '1') return;

  // Verifica/renova sessão do Supabase Auth silenciosamente
  if (typeof SupaAuth !== 'undefined') {
    try {
      const sess = await SupaAuth.getSession();
      if (!sess) {
        // Sessão expirada e não renovável: re-autentica com credenciais fixas
        await SupaAuth.signIn(ADMIN_CREDENTIALS.email, ADMIN_CREDENTIALS.pass);
      }
    } catch (err) {
      console.warn('[Admin] Auto-renovação de sessão falhou:', err.message);
    }
  }

  ADM.loggedIn = true;
  document.getElementById('admin-login').style.display = 'none';
  document.getElementById('admin-panel').style.display = 'flex';
  loadBalanco();
});

/* ══════════════════════════════════════════════════
   CARREGAMENTO DE DADOS
══════════════════════════════════════════════════ */
async function loadAdminData() {
  const btn = document.querySelector('.btn-refresh');
  if (btn) btn.classList.add('spinning');

  try {
    /* Busca todos os usuários com role bar ou promoter — direto do banco */
    const [usersRes] = await Promise.all([
      apiGet('users?limit=1000'),
    ]);

    const all = (usersRes.data || []).filter(u =>
      u.role === 'bar' || u.role === 'promoter'
    );

    ADM.allUsers = all;
    updateStats(all);
    renderCards();
  } catch (e) {
    console.error('[Admin]', e);
    showAdminToast('Erro ao carregar dados. Verifique a conexão.', 'error');
  } finally {
    if (btn) btn.classList.remove('spinning');
  }
}

function updateStats(users) {
  const pending  = users.filter(u => !u.approval_status || u.approval_status === 'pending');
  const approved = users.filter(u => u.approval_status === 'approved');
  const rejected = users.filter(u => u.approval_status === 'rejected');
  const promoters = users.filter(u => u.role === 'promoter');
  const bars      = users.filter(u => u.role === 'bar');

  setText('stat-pending',   pending.length);
  setText('stat-approved',  approved.length);
  setText('stat-rejected',  rejected.length);
  setText('stat-promoters', promoters.length);
  setText('stat-bars',      bars.length);

  /* Badge no nav */
  const badge = document.getElementById('badge-pending');
  if (badge) {
    badge.textContent   = pending.length;
    badge.style.display = pending.length > 0 ? 'inline-flex' : 'none';
  }
}

/* ══════════════════════════════════════════════════
   TABS E FILTROS
══════════════════════════════════════════════════ */
const TAB_CONFIG = {
  pending:  { title: 'Pendentes de Aprovação', sub: 'Novos promoters e bares aguardando análise' },
  approved: { title: 'Aprovados',              sub: 'Cadastros aprovados e liberados na plataforma' },
  rejected: { title: 'Rejeitados',             sub: 'Cadastros reprovados' },
  all:      { title: 'Todos os Cadastros',     sub: 'Todos os promoters e bares registrados' },
};

function switchAdminTab(tab, el) {
  ADM.currentTab = tab;
  // Só remove active se o elemento foi passado diretamente (evita conflito com switchSection)
  if (el) {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
  }

  const cfg = TAB_CONFIG[tab] || TAB_CONFIG.all;
  setText('tab-title', cfg.title);
  setText('tab-sub',   cfg.sub);

  renderCards();
}

function setTypeFilter(type, el) {
  ADM.typeFilter = type;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  renderCards();
}

/* ══════════════════════════════════════════════════
   RENDERIZAÇÃO DOS CARDS
══════════════════════════════════════════════════ */
function getFilteredUsers() {
  let list = [...ADM.allUsers];

  /* Filtro de tab */
  if (ADM.currentTab === 'pending') {
    list = list.filter(u => !u.approval_status || u.approval_status === 'pending');
  } else if (ADM.currentTab === 'approved') {
    list = list.filter(u => u.approval_status === 'approved');
  } else if (ADM.currentTab === 'rejected') {
    list = list.filter(u => u.approval_status === 'rejected');
  }

  /* Filtro de tipo */
  if (ADM.typeFilter === 'promoter') list = list.filter(u => u.role === 'promoter');
  if (ADM.typeFilter === 'bar')      list = list.filter(u => u.role === 'bar');

  /* Ordena: pendentes primeiro, depois por data desc */
  list.sort((a, b) => {
    const aPend = !a.approval_status || a.approval_status === 'pending';
    const bPend = !b.approval_status || b.approval_status === 'pending';
    if (aPend && !bPend) return -1;
    if (!aPend && bPend) return 1;
    return (b.created_at || 0) - (a.created_at || 0);
  });

  return list;
}

function renderCards() {
  const grid = document.getElementById('cards-grid');
  const list = getFilteredUsers();

  if (list.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <i class="fa fa-inbox"></i>
        <p>Nenhum cadastro encontrado nesta categoria.</p>
      </div>`;
    return;
  }

  grid.innerHTML = list.map(u => buildCard(u)).join('');
}

function buildCard(u) {
  const isPromoter = u.role === 'promoter';
  const status     = u.approval_status || 'pending';
  const initials   = (u.name || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const avatarCls  = isPromoter ? 'avatar-promoter' : 'avatar-bar';
  const avatarHTML = u.photo_url
    ? `<img src="${escHtml(u.photo_url)}" alt="foto" />`
    : initials;

  const roleBadge    = isPromoter
    ? `<span class="badge badge-promoter"><i class="fa fa-star"></i> Promoter</span>`
    : `<span class="badge badge-bar"><i class="fa fa-glass-cheers"></i> Bar</span>`;

  const statusBadge  = {
    pending:  `<span class="badge badge-pending"><i class="fa fa-clock"></i> Pendente</span>`,
    approved: `<span class="badge badge-approved"><i class="fa fa-check"></i> Aprovado</span>`,
    rejected: `<span class="badge badge-rejected"><i class="fa fa-times"></i> Rejeitado</span>`,
  }[status] || '';

  /* Detalhes resumidos no card */
  let details = '';
  if (isPromoter) {
    details = `
      ${u.promoter_region ? `<div class="card-detail-item"><i class="fa fa-map-marker-alt"></i><span>${escHtml(u.promoter_region)}</span></div>` : ''}
      ${u.promoter_type   ? `<div class="card-detail-item"><i class="fa fa-tag"></i><span>${escHtml(u.promoter_type)}</span></div>` : ''}
      ${u.promoter_instagram ? `<div class="card-detail-item"><i class="fab fa-instagram"></i><span>@${escHtml(u.promoter_instagram)}</span></div>` : ''}
    `;
  } else {
    details = `
      ${u.bar_genre        ? `<div class="card-detail-item"><i class="fa fa-music"></i><span>${escHtml(u.bar_genre)}</span></div>` : ''}
      ${u.bar_name         ? `<div class="card-detail-item"><i class="fa fa-store"></i><span>${escHtml(u.bar_name)}</span></div>` : ''}
      ${u.bar_instagram    ? `<div class="card-detail-item"><i class="fab fa-instagram"></i><span>@${escHtml(u.bar_instagram)}</span></div>` : ''}
    `;
  }

  /* Botões de ação por status */
  let actions = '';
  if (status === 'pending') {
    actions = `
      <button class="btn-approve" onclick="event.stopPropagation(); approveUser('${u.id}', '${u.role}')">
        <i class="fa fa-check"></i> Aprovar
      </button>
      <button class="btn-reject" onclick="event.stopPropagation(); openRejectModal('${u.id}', '${u.role}')">
        <i class="fa fa-times"></i> Rejeitar
      </button>
      <button class="btn-view" onclick="event.stopPropagation(); openDetailModal('${u.id}')">
        <i class="fa fa-eye"></i>
      </button>`;
  } else if (status === 'approved') {
    actions = `
      <button class="btn-view" onclick="event.stopPropagation(); openDetailModal('${u.id}')">
        <i class="fa fa-eye"></i> Ver detalhes
      </button>
      <button class="btn-revert" onclick="event.stopPropagation(); revertUser('${u.id}', '${u.role}')">
        <i class="fa fa-undo"></i> Reverter
      </button>`;
  } else if (status === 'rejected') {
    actions = `
      <button class="btn-view" onclick="event.stopPropagation(); openDetailModal('${u.id}')">
        <i class="fa fa-eye"></i> Ver detalhes
      </button>
      <button class="btn-approve" onclick="event.stopPropagation(); approveUser('${u.id}', '${u.role}')">
        <i class="fa fa-check"></i> Aprovar
      </button>`;
  }

  const dateStr = u.created_at
    ? new Date(u.created_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
    : '—';

  return `
    <div class="approval-card ${status}" onclick="openDetailModal('${u.id}')">
      <div class="card-top">
        <div class="card-avatar ${avatarCls}">${avatarHTML}</div>
        <div class="card-info">
          <div class="card-name">${escHtml(u.name || '—')}</div>
          <div class="card-meta">
            <span>${escHtml(u.email || '—')}</span>
          </div>
        </div>
      </div>
      <div class="card-badges">${roleBadge}${statusBadge}</div>
      <div class="card-detail-row">${details}</div>
      <div class="card-date">Cadastro: ${dateStr}</div>
      <div class="card-actions">${actions}</div>
    </div>`;
}

/* ══════════════════════════════════════════════════
   MODAL DE DETALHES
══════════════════════════════════════════════════ */
async function openDetailModal(userId) {
  // Busca dados frescos do banco — não usa cache em memória
  let u;
  try {
    u = await apiGet(`users/${userId}`);
  } catch (_) {}
  // Fallback para memória apenas se o banco falhar
  if (!u) u = ADM.allUsers.find(x => x.id === userId);
  if (!u) return;

  const isPromoter = u.role === 'promoter';
  const status     = u.approval_status || 'pending';
  const initials   = (u.name || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const avatarCls  = isPromoter ? 'avatar-promoter' : 'avatar-bar';

  /* Avatar */
  const avatarEl = document.getElementById('modal-avatar');
  avatarEl.className = `modal-avatar ${avatarCls}`;
  avatarEl.innerHTML = u.photo_url
    ? `<img src="${escHtml(u.photo_url)}" alt="foto" />`
    : initials;

  /* Cabeçalho */
  document.getElementById('modal-name').textContent = u.name || '—';
  document.getElementById('modal-role-badge').outerHTML = `<span class="modal-role-badge badge ${isPromoter ? 'badge-promoter' : 'badge-bar'}">${isPromoter ? '⭐ Promoter' : '🍻 Bar'}</span>`;
  document.getElementById('modal-status-badge').outerHTML = `<span class="modal-status-badge badge ${{pending:'badge-pending',approved:'badge-approved',rejected:'badge-rejected'}[status]||'badge-pending'}">${{pending:'⏳ Pendente',approved:'✅ Aprovado',rejected:'❌ Rejeitado'}[status]||'Pendente'}</span>`;

  /* Corpo */
  const body = document.getElementById('modal-body');
  const dateStr = u.created_at
    ? new Date(u.created_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
    : '—';

  let content = `
    <p class="modal-section-title">Dados gerais</p>
    <div class="modal-info-grid">
      <div class="modal-info-item">
        <span class="modal-info-label">E-mail</span>
        <span class="modal-info-value">${escHtml(u.email || '—')}</span>
      </div>
      <div class="modal-info-item">
        <span class="modal-info-label">Telefone</span>
        <span class="modal-info-value">${escHtml(u.phone || '—')}</span>
      </div>
      <div class="modal-info-item">
        <span class="modal-info-label">Cadastro em</span>
        <span class="modal-info-value">${dateStr}</span>
      </div>
    </div>`;

  if (isPromoter) {
    content += `
      <p class="modal-section-title" style="margin-top:4px">Dados do Promoter</p>
      <div class="modal-info-grid">
        <div class="modal-info-item">
          <span class="modal-info-label">CPF</span>
          <span class="modal-info-value">${escHtml(u.cpf || '—')}</span>
        </div>
        <div class="modal-info-item">
          <span class="modal-info-label">Tipo de atuação</span>
          <span class="modal-info-value">${escHtml(u.promoter_type || '—')}</span>
        </div>
        <div class="modal-info-item">
          <span class="modal-info-label">Região</span>
          <span class="modal-info-value">${escHtml(u.promoter_region || '—')}</span>
        </div>
        <div class="modal-info-item">
          <span class="modal-info-label">Instagram</span>
          <span class="modal-info-value">${u.promoter_instagram ? `@${escHtml(u.promoter_instagram)}` : '—'}</span>
        </div>
        <div class="modal-info-item">
          <span class="modal-info-label">Chave Pix</span>
          <span class="modal-info-value">${escHtml(u.pix_key || '—')}</span>
        </div>
        <div class="modal-info-item">
          <span class="modal-info-label">Código de indicação</span>
          <span class="modal-info-value">${escHtml(u.referral_code || '—')}</span>
        </div>
        <div class="modal-info-item modal-info-full">
          <span class="modal-info-label">Release / Bio profissional</span>
          <span class="modal-info-value release-text">${escHtml(u.promoter_release || '—')}</span>
        </div>
      </div>`;
  } else {
    content += `
      <p class="modal-section-title" style="margin-top:4px">Dados do Bar</p>
      <div class="modal-info-grid">
        <div class="modal-info-item">
          <span class="modal-info-label">Nome do bar</span>
          <span class="modal-info-value">${escHtml(u.bar_name || '—')}</span>
        </div>
        <div class="modal-info-item">
          <span class="modal-info-label">Gênero / Estilo</span>
          <span class="modal-info-value">${escHtml(u.bar_genre || '—')}</span>
        </div>
        <div class="modal-info-item">
          <span class="modal-info-label">CNPJ</span>
          <span class="modal-info-value">${escHtml(u.cnpj || '—')}</span>
        </div>
        <div class="modal-info-item">
          <span class="modal-info-label">Responsável</span>
          <span class="modal-info-value">${escHtml(u.responsible_name || '—')}</span>
        </div>
        <div class="modal-info-item">
          <span class="modal-info-label">Instagram</span>
          <span class="modal-info-value">${u.bar_instagram ? `@${escHtml(u.bar_instagram)}` : '—'}</span>
        </div>
        <div class="modal-info-item modal-info-full">
          <span class="modal-info-label">Release / Descrição</span>
          <span class="modal-info-value release-text">${escHtml(u.bar_release || '—')}</span>
        </div>
      </div>`;
  }

  /* Nota de rejeição (se houver) */
  if (status === 'rejected' && u.approval_note) {
    content += `
      <div class="rejection-note">
        <strong>Motivo da rejeição:</strong> ${escHtml(u.approval_note)}
      </div>`;
  }

  body.innerHTML = content;

  /* Ações no modal */
  const actEl = document.getElementById('modal-actions');
  if (status === 'pending') {
    actEl.innerHTML = `
      <button class="btn-approve" onclick="approveUser('${u.id}','${u.role}'); closeDetailModal()">
        <i class="fa fa-check"></i> Aprovar
      </button>
      <button class="btn-reject" onclick="closeDetailModal(); openRejectModal('${u.id}','${u.role}')">
        <i class="fa fa-times"></i> Rejeitar
      </button>`;
  } else if (status === 'approved') {
    actEl.innerHTML = `
      <button class="btn-revert" onclick="revertUser('${u.id}','${u.role}'); closeDetailModal()">
        <i class="fa fa-undo"></i> Reverter para Pendente
      </button>`;
  } else if (status === 'rejected') {
    actEl.innerHTML = `
      <button class="btn-approve" onclick="approveUser('${u.id}','${u.role}'); closeDetailModal()">
        <i class="fa fa-check"></i> Aprovar mesmo assim
      </button>`;
  } else {
    actEl.innerHTML = '';
  }

  document.getElementById('detail-modal').style.display = 'flex';
}

function closeDetailModal(e) {
  if (e && e.target !== document.getElementById('detail-modal')) return;
  document.getElementById('detail-modal').style.display = 'none';
}

/* ══════════════════════════════════════════════════
   AÇÕES — APROVAR / REJEITAR / REVERTER
══════════════════════════════════════════════════ */
async function approveUser(userId, role) {
  // Busca dados frescos do banco antes de agir
  let u;
  try {
    u = await apiGet(`users/${userId}`);
  } catch (_) {}
  if (!u) u = ADM.allUsers.find(x => x.id === userId);
  if (!u) return;

  try {
    /* Atualiza o usuário */
    await apiPatch(`users/${userId}`, { approval_status: 'approved', approval_note: '' });

    /* Se for bar, também atualiza a tabela bars */
    if (role === 'bar' && u.bar_id) {
      await apiPatch(`bars/${u.bar_id}`, { approval_status: 'approved', active: true });
    }

    showAdminToast(`✅ ${u.name} aprovado com sucesso!`, 'success');
    // Recarrega todos os dados do banco — nunca usa estado em memória
    await loadAdminData();
  } catch (e) {
    console.error(e);
    showAdminToast('Erro ao aprovar. Tente novamente.', 'error');
  }
}

function openRejectModal(userId, role) {
  ADM.currentItemId = userId;
  ADM.currentType   = role;
  document.getElementById('reject-note').value = '';
  document.getElementById('reject-modal').style.display = 'flex';
}

function closeRejectModal(e) {
  if (e && e.target !== document.getElementById('reject-modal')) return;
  document.getElementById('reject-modal').style.display = 'none';
  ADM.currentItemId = null;
  ADM.currentType   = null;
}

async function confirmReject() {
  const note   = document.getElementById('reject-note').value.trim();
  const userId = ADM.currentItemId;
  const role   = ADM.currentType;
  if (!userId) return;

  // Busca dados frescos do banco antes de agir
  let u;
  try {
    u = await apiGet(`users/${userId}`);
  } catch (_) {}
  if (!u) u = ADM.allUsers.find(x => x.id === userId);
  if (!u) return;

  const btn = document.querySelector('.btn-reject-confirm');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Rejeitando…'; }

  try {
    await apiPatch(`users/${userId}`, { approval_status: 'rejected', approval_note: note });

    /* Se for bar, desativa o bar também */
    if (role === 'bar' && u.bar_id) {
      await apiPatch(`bars/${u.bar_id}`, { approval_status: 'rejected', active: false });
    }

    closeRejectModal();
    showAdminToast(`❌ ${u.name} rejeitado.`, 'error');
    // Recarrega todos os dados do banco — nunca usa estado em memória
    await loadAdminData();
  } catch (e) {
    console.error(e);
    showAdminToast('Erro ao rejeitar. Tente novamente.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa fa-times-circle"></i> Confirmar rejeição'; }
  }
}

async function revertUser(userId, role) {
  // Busca dados frescos do banco antes de agir
  let u;
  try {
    u = await apiGet(`users/${userId}`);
  } catch (_) {}
  if (!u) u = ADM.allUsers.find(x => x.id === userId);
  if (!u) return;

  try {
    await apiPatch(`users/${userId}`, { approval_status: 'pending', approval_note: '' });

    if (role === 'bar' && u.bar_id) {
      await apiPatch(`bars/${u.bar_id}`, { approval_status: 'pending' });
    }

    showAdminToast(`↩️ ${u.name} voltou para Pendente.`, 'success');
    // Recarrega todos os dados do banco — nunca usa estado em memória
    await loadAdminData();
  } catch (e) {
    console.error(e);
    showAdminToast('Erro ao reverter. Tente novamente.', 'error');
  }
}

/* ══════════════════════════════════════════════════
   NAVEGAÇÃO ENTRE SEÇÕES
══════════════════════════════════════════════════ */
function switchSection(section, el) {
  // Atualiza nav
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');

  // Mostra/esconde seções
  document.querySelectorAll('.content-section').forEach(s => s.style.display = 'none');
  const target = document.getElementById(`section-${section}`);
  if (target) target.style.display = 'flex';

  // Carrega dados conforme seção — ativacoes usa rAF para garantir layout antes de ler offsetWidth
  if (section === 'balanco')    loadBalanco();
  if (section === 'reviews')    loadBadReviews();
  if (section === 'beneficios') loadBeneficios();
  if (section === 'clientes')   loadClientes();
  if (section === 'bares')         loadBares();
  if (section === 'patrocinados') loadSponsored();
  if (section === 'promoters')  loadPromoters();
  if (section === 'ativacoes')   loadAtivacoes();
  if (section === 'approvals')  loadAdminData();
}

/* ══════════════════════════════════════════════════
   PATROCINADOS — bar no topo da home
   Persistido em bars.featured_promo:
   { "sponsored_until": ISO, "sponsored_at": ISO }
══════════════════════════════════════════════════ */
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

function onSponsorDurationChange() {
  const custom = document.getElementById('sponsor-duration')?.value === 'custom';
  const wrap = document.getElementById('sponsor-until-wrap');
  if (wrap) wrap.style.display = custom ? 'block' : 'none';
}

function _formatSponsorUntil(date) {
  return date.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function _formatSponsorLeft(date) {
  const hours = Math.max(1, Math.ceil((date.getTime() - Date.now()) / 3600000));
  if (hours < 48) return `${hours} h restantes`;
  const days = Math.ceil(hours / 24);
  return `${days} dias restantes`;
}

async function _patchBarSponsor(barId, featuredPromo) {
  const token = await _getAdminJwt();
  const res = await fetch(`${SB_URL}/bars?id=eq.${encodeURIComponent(barId)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SB_ANON,
      'Authorization': `Bearer ${token}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ featured_promo: featuredPromo }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Erro ${res.status}`);
  }
}

async function loadSponsored() {
  const listEl = document.getElementById('sponsor-list');
  const select = document.getElementById('sponsor-bar');
  if (!listEl || !select) return;

  try {
    const bars = await sbAdminFetchAll('bars');
    const options = bars
      .filter(b => b.active !== false)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt'));
    const current = select.value;
    select.innerHTML = '<option value="">Escolher bar</option>' + options.map(b => {
      const hood = b.neighborhood ? ` · ${escHtml(b.neighborhood)}` : '';
      return `<option value="${escHtml(b.id)}">${escHtml(b.name || 'Bar')}${hood}</option>`;
    }).join('');
    if (current) select.value = current;

    const active = bars
      .map(bar => ({ bar, sponsor: parseBarSponsor(bar.featured_promo) }))
      .filter(item => item.sponsor?.active)
      .sort((a, b) => b.sponsor.at - a.sponsor.at);

    if (!active.length) {
      listEl.innerHTML = '<p class="sponsor-empty">Nenhum bar no topo agora.</p>';
      return;
    }

    listEl.innerHTML = active.map(({ bar, sponsor }) => `
      <article class="sponsor-row">
        <div class="sponsor-row-info">
          <strong>${escHtml(bar.name || 'Bar')}</strong>
          <span>${escHtml(bar.neighborhood || 'Sem bairro')}</span>
          <em>No topo até ${_formatSponsorUntil(sponsor.until)} · ${_formatSponsorLeft(sponsor.until)}</em>
        </div>
        <button type="button" class="btn-reject" onclick="removeBarSponsor('${bar.id}')">Tirar do topo</button>
      </article>
    `).join('');
  } catch (err) {
    listEl.innerHTML = `<p class="sponsor-empty">Não foi possível carregar os bares.</p>`;
    showAdminToast(err?.message || 'Erro ao carregar patrocinados.', 'error');
  }
}

async function saveBarSponsor() {
  const barId = document.getElementById('sponsor-bar')?.value || '';
  const duration = document.getElementById('sponsor-duration')?.value || '';
  const btn = document.getElementById('sponsor-save-btn');
  if (!barId) { showAdminToast('Escolha um bar.', 'error'); return; }

  let until;
  if (duration === 'custom') {
    const raw = document.getElementById('sponsor-until')?.value || '';
    if (!raw) { showAdminToast('Escolha a data e a hora.', 'error'); return; }
    until = new Date(raw);
  } else {
    const hours = { h24: 24, d3: 72, d7: 168, d15: 360, d30: 720 }[duration];
    if (!hours) { showAdminToast('Escolha por quanto tempo o bar fica no topo.', 'error'); return; }
    until = new Date(Date.now() + hours * 3600000);
  }
  if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) {
    showAdminToast('A data precisa ser no futuro.', 'error');
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }
  try {
    await _patchBarSponsor(barId, JSON.stringify({
      sponsored_until: until.toISOString(),
      sponsored_at: new Date().toISOString(),
    }));
    showAdminToast('Bar colocado no topo da home.', 'success');
    await loadSponsored();
  } catch (err) {
    showAdminToast(err?.message || 'Não foi possível patrocinar o bar.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa fa-bullhorn"></i> Colocar no topo';
    }
  }
}

async function removeBarSponsor(barId) {
  if (!barId) return;
  if (!confirm('Tirar este bar do topo da home?')) return;
  try {
    await _patchBarSponsor(barId, '');
    showAdminToast('Bar removido do topo.', 'success');
    await loadSponsored();
  } catch (err) {
    showAdminToast(err?.message || 'Não foi possível remover.', 'error');
  }
}

/* ══════════════════════════════════════════════════
   BALANÇO GERAL
══════════════════════════════════════════════════ */
let _charts = {};

/**
 * Obtém um JWT fresco do admin@oz.com diretamente via Supabase Auth.
 * Necessário porque SupaAuth.getAccessToken() pode retornar o token
 * de um promoter que estava logado no app (sessão contaminada),
 * fazendo a RLS filtrar por promoter_id = auth.uid() em vez de dar
 * acesso total ao admin.
 */
let _adminJwtCache = null; // { token, expiresAt }
async function _getAdminJwt() {
  const now = Date.now();
  // Reutiliza o token se ainda válido por mais de 60 s
  if (_adminJwtCache && _adminJwtCache.expiresAt > now + 60_000) {
    return _adminJwtCache.token;
  }
  const AUTH_URL = 'https://qyxefytxyrmvotjnhoir.supabase.co/auth/v1';
  const res = await fetch(`${AUTH_URL}/token?grant_type=password`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SB_ANON },
    body:    JSON.stringify({ email: ADMIN_CREDENTIALS.email, password: ADMIN_CREDENTIALS.pass }),
  });
  if (!res.ok) throw new Error(`[Admin JWT] Login falhou: ${res.status}`);
  const data = await res.json();
  _adminJwtCache = {
    token:     data.access_token,
    expiresAt: now + (data.expires_in || 3600) * 1000,
  };
  return _adminJwtCache.token;
}

/**
 * Busca TODOS os registros de uma tabela direto no PostgREST com paginação,
 * usando JWT fresco do admin — garante acesso total independente de qual
 * usuário estava logado no app.
 */
async function sbAdminFetchAll(table) {
  const token = await _getAdminJwt();
  const limit = 500;
  let offset  = 0;
  let all     = [];
  const hdrs  = {
    'apikey':        SB_ANON,
    'Authorization': `Bearer ${token}`,
  };
  while (true) {
    const url  = `${SB_URL}/${table}?limit=${limit}&offset=${offset}&order=created_at.desc`;
    const res  = await fetch(url, { headers: hdrs, cache: 'no-store' });
    if (!res.ok) throw new Error(`sbAdminFetchAll ${table}: ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) break;
    all = all.concat(rows);
    if (rows.length < limit) break;
    offset += limit;
  }
  return all;
}

async function loadBalanco() {
  const btn = document.querySelector('#section-balanco .btn-refresh');
  if (btn) btn.classList.add('spinning');

  try {
    // activations, earnings e withdrawals usam sbAdminFetchAll (fetch direto, paginado,
    // JWT admin limpo — garante acesso total independente de RLS por uid)
    const [usersRes, barsRes, acts, earnings, withdrawals] = await Promise.all([
      apiGet('users?limit=1000'),
      apiGet('bars?limit=500'),
      sbAdminFetchAll('activations'),
      sbAdminFetchAll('earnings'),
      sbAdminFetchAll('withdrawals'),
    ]);

    const users = usersRes.data || [];
    const bars  = barsRes.data  || [];

    // ── Usuários
    const clientes   = users.filter(u => u.role === 'cliente');
    const promoters  = users.filter(u => u.role === 'promoter');
    const barUsers   = users.filter(u => u.role === 'bar');

    setText('bk-total-users', users.length.toLocaleString('pt-BR'));
    setText('bk-users-sub',   `${clientes.length} clientes · ${promoters.length} promoters · ${barUsers.length} bares`);
    setText('bk-promoters',   promoters.length);
    setText('bk-promoters-sub', `${promoters.filter(p => p.approval_status === 'approved').length} aprovados`);
    setText('bk-bars',        bars.length);
    setText('bk-bars-sub',    `${bars.filter(b => b.active).length} ativos · ${barUsers.length} com conta`);

    // ── Ativações — allowlist: apenas status='active' (pagamento confirmado)
    const activeActs  = acts.filter(isConfirmedAct);
    const paidActs    = activeActs.filter(a => (a.amount || 0) > 0);
    const freeActs    = activeActs.filter(a => (a.amount || 0) === 0);

    setText('bk-total-acts', activeActs.length.toLocaleString('pt-BR'));
    setText('bk-acts-sub',   `${paidActs.length} pagas · ${freeActs.length} grátis`);

    // ── Financeiro
    // Volume financeiro = todas as ativações que geraram cobrança real:
    //   status 'active'    → ativação confirmada e em uso
    //   status 'cancelled' → cliente pagou, bar cancelou; OZ recebeu o dinheiro
    //                        (o free_credit de compensação é passivo interno, não devolução)
    // Tipos internos (free_credit, free_credit_used, night_checkin) sempre excluídos.
    const billedActs = acts.filter(a =>
      (a.status === 'active' || a.status === 'cancelled') &&
      !ACT_INTERNAL_TYPES.has(a.type) &&
      (a.amount || 0) > 0
    );
    const revenue    = billedActs.reduce((s, a) => s + (a.amount || 0), 0);
    const cancelledBilledActs = billedActs.filter(a => a.status === 'cancelled');
    const commTotal    = earnings.reduce((s, e) => s + (e.amount || 0), 0);
    const commPaid     = earnings.filter(e => e.status === 'pago').reduce((s, e) => s + (e.amount || 0), 0);
    const commPending  = earnings.filter(e => e.status !== 'pago').reduce((s, e) => s + (e.amount || 0), 0);
    const wdTotal        = withdrawals.reduce((s, w) => s + (w.amount || 0), 0);
    const wdPaid         = withdrawals.filter(w => w.status === 'pago').reduce((s, w) => s + (w.amount || 0), 0);
    const wdSolicitado   = withdrawals.filter(w => w.status !== 'pago').reduce((s, w) => s + (w.amount || 0), 0);
    // Saldo acumulado nos wallets dos promoters (campo balance nos users)
    const totalBalance   = users.filter(u => u.role === 'promoter').reduce((s, u) => s + (u.balance || 0), 0);
    // Pendente = saldo em carteira que ainda não foi sequer solicitado
    const wdPendente     = Math.max(0, totalBalance - wdSolicitado);

    // ── Ganho líquido da plataforma
    // Receita bruta − total de repasses a promoters = ganho bruto da OZ
    const netProfit    = revenue - commTotal;
    // Hero card
    setText('bk-net-profit',       fmtBRL(netProfit));
    setText('bk-net-sub',          `Receita ${fmtBRL(revenue)} − Repasses ${fmtBRL(commTotal)}`);
    setText('bk-hero-revenue',     fmtBRL(revenue));
    setText('bk-hero-commissions', fmtBRL(commTotal));

    // Painel financeiro
    setText('bk-volume',           fmtBRL(revenue));
    setText('bk-volume-sub',       `de ${billedActs.length} ativações (${cancelledBilledActs.length} canceladas incluídas)`);
    setText('bk-commissions',      fmtBRL(commTotal));
    setText('bk-commissions-sub',  `${earnings.length} registros de comissão`);

    setText('bk-revenue',          fmtBRL(revenue));
    setText('bk-comm-total',       fmtBRL(commTotal));      // total repasses (earnings)
    setText('bk-paid-out',         fmtBRL(wdPaid));         // withdrawals status='pago'
    setText('bk-solicited-out',    fmtBRL(wdSolicitado));   // withdrawals solicitados/processando
    setText('bk-pending-out',      fmtBRL(wdPendente));     // balance em carteira não solicitado
    setText('bk-net-fin',          fmtBRL(netProfit));

    // Saques de promoters
    setText('bk-withdrawals',      fmtBRL(wdTotal));
    setText('bk-withdrawals-paid', fmtBRL(wdPaid));

    // ── ARPU — receita média mensal por cliente ativo (mês anterior)
    const nowTs       = Date.now();
    const prevMonthEnd   = new Date();
    prevMonthEnd.setDate(1);
    prevMonthEnd.setHours(0, 0, 0, 0);                   // 1º dia deste mês 00:00
    const prevMonthStart = new Date(prevMonthEnd);
    prevMonthStart.setMonth(prevMonthStart.getMonth() - 1); // 1º dia do mês anterior
    const pmStart = prevMonthStart.getTime();
    const pmEnd   = prevMonthEnd.getTime();

    // Ativações do mês anterior (não canceladas, sem free_credit / night_checkin)
    const prevMonthActs = activeActs.filter(a => {
      const ts = a.created_at || 0;
      return ts >= pmStart && ts < pmEnd;
    });
    const prevMonthRevenue     = prevMonthActs.filter(a => (a.amount || 0) > 0)
                                              .reduce((s, a) => s + (a.amount || 0), 0);
    const prevMonthActiveUsers = new Set(prevMonthActs.map(a => a.user_id)).size;
    const arpu = prevMonthActiveUsers > 0 ? prevMonthRevenue / prevMonthActiveUsers : 0;

    const prevMonthLabel = prevMonthStart.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    setText('bk-arpu',     arpu > 0 ? fmtBRL(arpu) : '—');
    setText('bk-arpu-sub', prevMonthActiveUsers > 0
      ? `${prevMonthActiveUsers} clientes ativos em ${prevMonthLabel}`
      : `Sem ativações em ${prevMonthLabel}`);

    // ── Timestamp
    const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setText('balanco-updated', now);

    // ── Gráficos
    renderChartUsers(clientes.length, promoters.length, barUsers.length);

    // ── Rankings

    // ── Tabela de saques de promoters
    renderWithdrawals(withdrawals);

  } catch (e) {
    console.error('[Balanço]', e);
    showAdminToast('Erro ao carregar balanço.', 'error');
  } finally {
    if (btn) btn.classList.remove('spinning');
  }
}

/* ── Gráfico: Usuários por tipo ── */
function renderChartUsers(clientes, promoters, bars) {
  const ctx = document.getElementById('chart-users');
  if (!ctx) return;
  if (_charts.users) _charts.users.destroy();

  _charts.users = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Clientes', 'Promoters', 'Bares'],
      datasets: [{
        data: [clientes, promoters, bars],
        backgroundColor: ['rgba(96,165,250,.8)', 'rgba(192,132,252,.8)', 'rgba(251,191,36,.8)'],
        borderColor: ['#60a5fa', '#c084fc', '#fbbf24'],
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#8888aa', font: { size: 12 }, padding: 16 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed}` } },
      },
    },
  });
}

/* ── Ranking de bares ── */
/* ══════════════════════════════════════════════════
   RANKING DE BARES (paginado: 5 inicial, +15)
══════════════════════════════════════════════════ */
let _barRankRows  = [];   // todas as linhas ordenadas
let _barRankShown = 0;    // quantas estão visíveis

function renderRankingBars(acts) {
  const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  // Agrega por bar: total e último mês
  const stats = {};
  acts.forEach(a => {
    if (!a.bar_id) return;
    if (!stats[a.bar_id]) stats[a.bar_id] = { name: a.bar_name || a.bar_id, total: 0, lastMonth: 0 };
    stats[a.bar_id].total++;
    if ((a.created_at || 0) >= monthAgo) stats[a.bar_id].lastMonth++;
  });

  // Ordena por total decrescente
  _barRankRows = Object.entries(stats)
    .map(([id, s]) => ({ id, ...s }))
    .sort((a, b) => b.total - a.total);

  // Reseta exibição
  _barRankShown = 0;
  const tbody = document.getElementById('tbody-bar-rank');
  if (tbody) tbody.innerHTML = '';
  _barRankAppend(5);
}

function _barRankAppend(count) {
  const tbody   = document.getElementById('tbody-bar-rank');
  const footer  = document.getElementById('bar-rank-footer');
  const countEl = document.getElementById('bar-rank-count');
  const subEl   = document.getElementById('bar-rank-sub');
  const btnMore = document.getElementById('btn-bar-rank-more');
  if (!tbody) return;

  if (!_barRankRows.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="bk-td-empty">Nenhuma ativação registrada.</td></tr>';
    if (footer) footer.style.display = 'none';
    return;
  }

  const posCls = ['gold', 'silver', 'bronze'];
  const slice  = _barRankRows.slice(_barRankShown, _barRankShown + count);

  slice.forEach((row, idx) => {
    const pos    = _barRankShown + idx + 1;
    const cls    = posCls[pos - 1] || '';
    const tr     = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="bk-rank-pos ${cls}" style="display:inline-flex;width:26px;height:26px;font-size:11px">${pos}</span></td>
      <td style="font-weight:600">${escHtml(row.name)}</td>
      <td style="text-align:center;font-weight:700;color:#60a5fa">${row.total}</td>
      <td style="text-align:center;color:#4ade80;font-weight:600">${row.lastMonth}</td>`;
    tbody.appendChild(tr);
  });

  _barRankShown += slice.length;

  // Atualiza rodapé
  const total     = _barRankRows.length;
  const remaining = total - _barRankShown;
  if (footer) {
    footer.style.display = 'flex';
    if (countEl) countEl.textContent = `Exibindo ${_barRankShown} de ${total} bares`;
    if (subEl)   subEl.textContent   = `${total} bares com ativações`;
    if (btnMore) {
      if (remaining > 0) {
        btnMore.style.display = 'inline-flex';
        btnMore.innerHTML = `<i class="fa fa-plus" style="margin-right:5px"></i> Mostrar mais ${Math.min(remaining, 15)}`;
      } else {
        btnMore.style.display = 'none';
      }
    }
  }
}

function barRankLoadMore() {
  _barRankAppend(15);
}


/* ── Ranking de promoters ── */
function renderRankingPromoters(earnings) {
  const el = document.getElementById('ranking-promoters');
  if (!el) return;

  const totals = {};
  earnings.forEach(e => {
    if (!e.promoter_id) return;
    totals[e.promoter_id] = (totals[e.promoter_id] || 0) + (e.amount || 0);
  });

  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!sorted.length) { el.innerHTML = '<div class="bk-loading">Nenhuma comissão registrada.</div>'; return; }

  // Tenta buscar nomes no cache de usuários
  // Resolve nomes dos promoters via ADM.allUsers (já carregado do banco na seção)
  const userMap = {};
  (ADM.allUsers || []).forEach(u => { userMap[u.id] = u.name; });

  const posCls = ['gold', 'silver', 'bronze', '', ''];
  el.innerHTML = sorted.map(([id, total], i) => `
    <div class="bk-rank-item">
      <div class="bk-rank-pos ${posCls[i]}">${i + 1}</div>
      <span class="bk-rank-name">${escHtml(userMap[id] || id.slice(0, 8) + '…')}</span>
      <span class="bk-rank-val">${fmtBRL(total)}</span>
    </div>`).join('');
}

/* ── Lista de clientes por número de ativações ── */
/* ══════════════════════════════════════════════════
   RANKING DE ATIVAÇÕES — CLIENTES (com paginação)
══════════════════════════════════════════════════ */
let _cliRankRows   = [];   // todas as linhas ordenadas
let _cliRankShown  = 0;    // quantas estão visíveis agora

function renderClientsActsTable(clientes, activeActs, earnings) {
  const tbody = document.getElementById('tbody-clients-acts');
  if (!tbody) return;

  // Conjunto de activation_ids que geraram comissão a algum promoter
  const commissionedActIds = new Set(
    (earnings || []).map(e => e.activation_id).filter(Boolean)
  );

  // Monta mapa: user_id → { total, paid, free, spent, commActIds }
  const statsMap = {};

  // 1) Conta todas as ativações reais
  activeActs.forEach(a => {
    if (!a.user_id) return;
    if (!statsMap[a.user_id]) statsMap[a.user_id] = { total: 0, paid: 0, free: 0, spent: 0, commActIds: new Set() };
    statsMap[a.user_id].total++;
    if ((a.amount || 0) > 0) {
      statsMap[a.user_id].paid++;
      statsMap[a.user_id].spent += (a.amount || 0);
    } else {
      statsMap[a.user_id].free++;
    }
    if (commissionedActIds.has(a.id)) {
      statsMap[a.user_id].commActIds.add(a.id);
    }
  });

  // 2) Garante ativações comissionadas que saíram do filtro principal
  const actsById = {};
  activeActs.forEach(a => { if (a.id) actsById[a.id] = a; });
  (earnings || []).forEach(e => {
    const uid = e.user_id;
    const aid = e.activation_id;
    if (!uid || !aid) return;
    if (actsById[aid]) return;
    if (!statsMap[uid]) statsMap[uid] = { total: 0, paid: 0, free: 0, spent: 0, commActIds: new Set() };
    statsMap[uid].commActIds.add(aid);
    statsMap[uid].total++;
    statsMap[uid].paid++;
  });

  // Ordena por total de ativações (maior primeiro), ignora quem nunca ativou
  _cliRankRows = clientes
    .map(u => ({ user: u, stats: statsMap[u.id] || { total: 0, paid: 0, free: 0, spent: 0, commActIds: new Set() } }))
    .filter(r => r.stats.total > 0)
    .sort((a, b) => b.stats.total - a.stats.total);

  // Começa exibindo as primeiras 15
  _cliRankShown = 0;
  tbody.innerHTML = '';
  _cliRankAppend(15);
}

/* Adiciona `count` linhas a partir do índice atual */
function _cliRankAppend(count) {
  const tbody    = document.getElementById('tbody-clients-acts');
  const footer   = document.getElementById('cli-rank-footer');
  const countEl  = document.getElementById('cli-rank-count');
  const subEl    = document.getElementById('cli-rank-sub');
  const btnMore  = document.getElementById('btn-cli-rank-more');
  if (!tbody) return;

  if (!_cliRankRows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="bk-td-empty">Nenhuma ativação de cliente registrada.</td></tr>';
    if (footer) footer.style.display = 'none';
    return;
  }

  const slice = _cliRankRows.slice(_cliRankShown, _cliRankShown + count);
  slice.forEach(({ user: u, stats: s }, idx) => {
    const pos    = _cliRankShown + idx + 1;
    const posCls = pos === 1 ? 'gold' : pos === 2 ? 'silver' : pos === 3 ? 'bronze' : '';
    const commCount = s.commActIds ? s.commActIds.size : 0;
    const commBadge = commCount > 0
      ? ` <span title="${commCount} ativação(ões) remuneraram promoter" style="display:inline-block;margin-left:4px;padding:1px 5px;border-radius:8px;font-size:10px;font-weight:700;background:rgba(250,204,21,.15);color:#fbbf24;border:1px solid rgba(250,204,21,.3);">⭐ ${commCount}</span>`
      : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="bk-rank-pos ${posCls}" style="display:inline-flex;width:28px;height:28px;font-size:12px">${pos}</span></td>
      <td><strong>${escHtml(u.name || '—')}</strong></td>
      <td style="color:rgba(255,255,255,.5);font-size:12px">${escHtml(u.email || '—')}</td>
      <td style="text-align:center;font-weight:700;color:#60a5fa">${s.total}${commBadge}</td>
      <td style="text-align:center;color:rgba(255,255,255,.7)">${s.paid}</td>
      <td style="text-align:center;color:rgba(255,255,255,.5)">${s.free}</td>
      <td style="text-align:right;font-weight:700;color:#1db954">${fmtBRL(s.spent)}</td>`;
    tbody.appendChild(tr);
  });

  _cliRankShown += slice.length;

  // Atualiza rodapé
  const total    = _cliRankRows.length;
  const remaining = total - _cliRankShown;
  if (footer) {
    footer.style.display = 'flex';
    if (countEl) countEl.textContent = `Exibindo ${_cliRankShown} de ${total} clientes`;
    if (subEl)   subEl.textContent   = `${total} mais ativos`;
    if (btnMore) {
      if (remaining > 0) {
        btnMore.style.display = 'inline-flex';
        btnMore.textContent   = '';
        btnMore.innerHTML     = `<i class="fa fa-plus" style="margin-right:5px"></i> Mostrar mais ${Math.min(remaining, 30)}`;
      } else {
        btnMore.style.display = 'none';
      }
    }
  }
}

/* Chamado pelo botão "Mostrar mais 30" */
function cliRankLoadMore() {
  _cliRankAppend(30);
}


/* ── Tabela de saques ── */
function renderWithdrawals(withdrawals) {
  const tbody = document.getElementById('tbody-withdrawals');
  if (!tbody) return;

  // Exibe apenas os saques ainda não pagos (solicitado / processando)
  const recent = [...withdrawals]
    .filter(w => w.status !== 'pago' && w.status !== 'negado')
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    .slice(0, 50);

  if (!recent.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="bk-td-empty">Nenhum saque pendente.</td></tr>';
    return;
  }

  const statusBadge = {
    solicitado:  '<span class="wd-badge wd-solicitado">⏳ Solicitado</span>',
    processando: '<span class="wd-badge wd-processando">🔄 Processando</span>',
    pago:        '<span class="wd-badge wd-pago">✅ Pago</span>',
    negado:      '<span class="wd-badge wd-negado">❌ Negado</span>',
  };

  // Resolve nomes dos promoters via ADM.allUsers (já carregado do banco na seção)
  const userMap = {};
  (ADM.allUsers || []).forEach(u => { userMap[u.id] = u.name; });

  tbody.innerHTML = recent.map(w => {
    const isPaid    = w.status === 'pago';
    const isNegado  = w.status === 'negado';
    const canPay    = !isPaid && !isNegado;
    const actionBtn = canPay
      ? `<button class="btn-wd-pay" onclick="markWithdrawalPaid('${escHtml(w.id)}', this)"
                title="Confirmar pagamento via Pix">
           <i class="fa fa-check-circle"></i> Marcar Pago
         </button>`
      : `<span style="color:#8888aa;font-size:12px">${isPaid ? 'Concluído' : 'N/A'}</span>`;

    return `
    <tr id="wd-row-${escHtml(w.id)}">
      <td>${escHtml(userMap[w.promoter_id] || (w.promoter_id || '').slice(0, 10) + '…')}</td>
      <td><strong>${fmtBRL(w.amount || 0)}</strong></td>
      <td style="font-family:monospace;font-size:12px">${escHtml(w.pix_key || '—')}</td>
      <td class="wd-status-cell">${statusBadge[w.status] || escHtml(w.status || '—')}</td>
      <td style="color:#8888aa;font-size:12px">${escHtml(w.notes || '—')}</td>
      <td>${actionBtn}</td>
    </tr>`;
  }).join('');
}

/**
 * Marca uma solicitação de saque como "pago" via PATCH direto no PostgREST
 * com JWT admin limpo — evita RLS por uid.
 * Atualiza a linha na UI sem recarregar a tabela inteira.
 */
async function markWithdrawalPaid(wdId, btnEl) {
  if (!wdId) return;
  if (!confirm('Confirmar pagamento deste saque? Esta ação não pode ser desfeita.')) return;

  // Feedback visual imediato
  if (btnEl) {
    btnEl.disabled   = true;
    btnEl.innerHTML  = '<i class="fa fa-spinner fa-spin"></i> Salvando…';
  }

  try {
    const token = await _getAdminJwt();
    const url   = `${SB_URL}/withdrawals?id=eq.${encodeURIComponent(wdId)}`;
    const res   = await fetch(url, {
      method:  'PATCH',
      headers: {
        'apikey':        SB_ANON,
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
        'Prefer':        'return=representation',
      },
      cache: 'no-store',
      body: JSON.stringify({ status: 'pago' }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`PATCH withdrawals: ${res.status} — ${err}`);
    }

    // Atualiza a linha sem reload completo
    const row        = document.getElementById(`wd-row-${wdId}`);
    const statusCell = row?.querySelector('.wd-status-cell');
    if (statusCell) statusCell.innerHTML = '<span class="wd-badge wd-pago">✅ Pago</span>';
    const actionCell = btnEl?.closest('td');
    if (actionCell) actionCell.innerHTML = '<span style="color:#8888aa;font-size:12px">Concluído</span>';

    // Atualiza totais do balanço (recarrega seção inteira para refletir wdPaid)
    loadBalanco();
    showAdminToast('Saque marcado como pago!', 'success');

  } catch (e) {
    console.error('[markWithdrawalPaid]', e);
    showAdminToast('Erro ao atualizar saque. Tente novamente.', 'error');
    if (btnEl) {
      btnEl.disabled  = false;
      btnEl.innerHTML = '<i class="fa fa-check-circle"></i> Marcar Pago';
    }
  }
}

/* ── Formatação BRL ── */
function fmtBRL(val) {
  return (val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}



/* ══════════════════════════════════════════════════
   AVALIAÇÕES NEGATIVAS (< 3 estrelas)
══════════════════════════════════════════════════ */

const REV = {
  all:     [],   // todas as avaliações negativas carregadas
  filter:  'all', // 'all' | '1' | '2'
};

async function loadBadReviews() {
  const icon = document.getElementById('reviews-refresh-icon');
  const list = document.getElementById('reviews-list');
  if (icon) icon.classList.add('fa-spin');
  if (list) list.innerHTML = '<div class="loading-state"><i class="fa fa-spinner fa-spin"></i><p>Carregando avaliações…</p></div>';

  try {
    // Busca todas as reviews (limit generoso para cobrir o dataset)
    const res = await apiGet('reviews?limit=500&sort=created_at');
    const all = (res.data || []).filter(r => (r.rating || 0) < 3 && (r.rating || 0) > 0);

    // Ordena: mais recentes primeiro
    all.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    REV.all = all;
    renderBadReviews();
    updateReviewsStats();
    renderWorstBars(all);

    // Badge no nav
    const badge = document.getElementById('badge-bad-reviews');
    if (badge) {
      const noReply = all.filter(r => !r.bar_reply).length;
      badge.textContent   = noReply;
      badge.style.display = noReply > 0 ? 'inline-flex' : 'none';
    }
  } catch (e) {
    console.error('[Reviews]', e);
    if (list) list.innerHTML = '<div class="loading-state"><i class="fa fa-exclamation-triangle" style="color:#ef4444"></i><p>Erro ao carregar avaliações.</p></div>';
  } finally {
    if (icon) icon.classList.remove('fa-spin');
  }
}

function setReviewsFilter(val, el) {
  REV.filter = val;
  document.querySelectorAll('#reviews-filter-row .filter-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  renderBadReviews();
}

function updateReviewsStats() {
  const all   = REV.all;
  const one   = all.filter(r => r.rating === 1);
  const two   = all.filter(r => r.rating === 2);
  const reply = all.filter(r => r.bar_reply);
  const noRep = all.filter(r => !r.bar_reply);
  setText('stat-bad-total',       all.length);
  setText('stat-one-star',        one.length);
  setText('stat-two-star',        two.length);
  setText('stat-replied-reviews', reply.length);
  setText('stat-no-reply',        noRep.length);
}

/* Ranking de bares pior avaliados — calculado sobre as avaliações negativas */
function renderWorstBars(reviews) {
  const el = document.getElementById('wrb-list');
  if (!el) return;

  if (!reviews.length) {
    el.innerHTML = '<span class="wrb-empty">Nenhuma avaliação negativa registrada.</span>';
    return;
  }

  // Agrupa por bar: soma de notas, contagem, nome
  const map = {};
  reviews.forEach(r => {
    if (!r.bar_id) return;
    if (!map[r.bar_id]) map[r.bar_id] = { name: r.bar_name || '—', sum: 0, count: 0, noReply: 0 };
    map[r.bar_id].sum   += (r.rating || 0);
    map[r.bar_id].count += 1;
    if (!r.bar_reply) map[r.bar_id].noReply += 1;
  });

  // Converte em array, calcula média, ordena: menor média primeiro; empate → mais avaliações negativas
  const bars = Object.entries(map)
    .map(([id, d]) => ({ id, name: d.name, avg: d.sum / d.count, count: d.count, noReply: d.noReply }))
    .sort((a, b) => a.avg - b.avg || b.count - a.count);

  // Exibe no máximo 8 bares
  const top = bars.slice(0, 8);

  // Pior média geral (para a barra de progresso relativa)
  const minAvg = top[top.length - 1]?.avg || 2;
  const maxAvg = 2; // teto: 2 estrelas é o máximo possível nesse contexto

  el.innerHTML = top.map((b, i) => {
    const avgFmt = b.avg.toFixed(1);
    // Largura da barra: quanto mais baixa a nota, mais preenchida
    const fillPct = Math.round(((maxAvg - b.avg) / (maxAvg - 1)) * 100);
    const barColor = b.avg <= 1.4 ? '#ef4444' : b.avg <= 1.8 ? '#f97316' : '#eab308';
    const pos = i + 1;

    return `
      <div class="wrb-item">
        <div class="wrb-pos ${pos === 1 ? 'wrb-pos-1' : pos === 2 ? 'wrb-pos-2' : pos === 3 ? 'wrb-pos-3' : ''}">${pos}</div>
        <div class="wrb-info">
          <div class="wrb-name-row">
            <span class="wrb-name">${escHtml(b.name)}</span>
            <div class="wrb-badges">
              <span class="wrb-badge-count">${b.count} avaliação${b.count !== 1 ? 'ões' : ''} negativa${b.count !== 1 ? 's' : ''}</span>
              ${b.noReply > 0 ? `<span class="wrb-badge-noreply"><i class="fa fa-clock"></i> ${b.noReply} sem resposta</span>` : '<span class="wrb-badge-ok"><i class="fa fa-check"></i> Todas respondidas</span>'}
            </div>
          </div>
          <div class="wrb-bar-track">
            <div class="wrb-bar-fill" style="width:${fillPct}%;background:${barColor}"></div>
          </div>
        </div>
        <div class="wrb-avg" style="color:${barColor}">
          <span class="wrb-avg-num">${avgFmt}</span>
          <i class="fa fa-star wrb-avg-star"></i>
        </div>
      </div>`;
  }).join('');
}

function renderBadReviews() {
  const list = document.getElementById('reviews-list');
  if (!list) return;

  let items = [...REV.all];
  if (REV.filter === '1') items = items.filter(r => r.rating === 1);
  if (REV.filter === '2') items = items.filter(r => r.rating === 2);

  if (!items.length) {
    list.innerHTML = `
      <div class="loading-state">
        <i class="fa fa-smile" style="color:#22c55e;font-size:32px"></i>
        <p style="color:#22c55e;font-weight:600;margin-top:10px">Nenhuma avaliação negativa encontrada!</p>
        <p style="color:#8888aa;font-size:13px">Todos os bares estão com notas acima de 2 estrelas.</p>
      </div>`;
    return;
  }

  list.innerHTML = items.map(r => {
    const rating      = r.rating || 0;
    const stars       = renderStars(rating);
    const ratingClass = rating === 1 ? 'rv-rating-1' : 'rv-rating-2';

    const fmtDate = ts => ts
      ? new Date(ts).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
      : '—';

    const avatarChar = (r.user_name || '?')[0].toUpperCase();
    const avatarHtml = r.user_photo
      ? `<img src="${escHtml(r.user_photo)}" alt="${escHtml(r.user_name || '')}" class="rv-avatar-img">`
      : `<div class="rv-avatar-char">${avatarChar}</div>`;

    /* ── Bloco do comentário do cliente ── */
    const commentBlock = r.comment
      ? `<div class="rv-block rv-block-client">
           <div class="rv-block-label">
             <i class="fa fa-user"></i>
             <span>Comentário do cliente</span>
           </div>
           <p class="rv-block-text">"${escHtml(r.comment)}"</p>
         </div>`
      : `<div class="rv-block rv-block-empty">
           <i class="fa fa-comment-slash"></i>
           <span>Cliente não deixou comentário</span>
         </div>`;

    /* ── Bloco da resposta do bar ── */
    const replyBlock = r.bar_reply
      ? `<div class="rv-block rv-block-bar">
           <div class="rv-block-label">
             <i class="fa fa-store"></i>
             <span>Resposta do bar</span>
             <span class="rv-block-date">${fmtDate(r.bar_reply_at)}</span>
           </div>
           <p class="rv-block-text">${escHtml(r.bar_reply)}</p>
         </div>`
      : `<div class="rv-block rv-block-pending">
           <i class="fa fa-clock"></i>
           <span>Bar ainda não respondeu</span>
         </div>`;

    return `
      <article class="rv-card ${r.bar_reply ? '' : 'rv-card-urgent'}">

        <!-- Cabeçalho: bar + nota -->
        <div class="rv-card-header">
          <div class="rv-bar-info">
            <div class="rv-bar-icon-wrap"><i class="fa fa-glass-cheers"></i></div>
            <div>
              <span class="rv-bar-name">${escHtml(r.bar_name || 'Bar desconhecido')}</span>
              <span class="rv-bar-id">Bar ID: ${escHtml((r.bar_id || '').slice(0, 10))}…</span>
            </div>
          </div>
          <div class="${ratingClass} rv-rating-badge">
            ${stars}
            <span>${rating} ${rating === 1 ? 'estrela' : 'estrelas'}</span>
          </div>
        </div>

        <!-- Linha do cliente -->
        <div class="rv-client-row">
          <div class="rv-avatar">${avatarHtml}</div>
          <div class="rv-user-info">
            <span class="rv-user-name">${escHtml(r.user_name || 'Cliente anônimo')}</span>
            <span class="rv-user-date"><i class="fa fa-calendar-alt"></i> ${fmtDate(r.created_at)}</span>
          </div>
          ${r.bar_reply
            ? '<span class="rv-status-tag rv-status-replied"><i class="fa fa-check-circle"></i> Respondida</span>'
            : '<span class="rv-status-tag rv-status-pending"><i class="fa fa-clock"></i> Sem resposta</span>'}
        </div>

        <!-- Corpo: comentário + resposta -->
        <div class="rv-conversation">
          ${commentBlock}
          ${replyBlock}
        </div>

      </article>`;
  }).join('');
}

function renderStars(rating) {
  let html = '';
  for (let i = 1; i <= 5; i++) {
    html += `<i class="fa fa-star" style="color:${i <= rating ? (rating === 1 ? '#ef4444' : '#f97316') : 'rgba(255,255,255,.15)'}"></i>`;
  }
  return html;
}

/* ══════════════════════════════════════════════════
   UTILITÁRIOS
══════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════
   ATIVAÇÕES
══════════════════════════════════════════════════ */
const ACTS = { allActs: [], allScheds: [], granularity: 'week', chart: null };

async function loadAtivacoes() {
  const btn = document.querySelector('#section-ativacoes .btn-refresh');
  if (btn) btn.classList.add('spinning');
  try {
    // activations via sbAdminFetchAll (JWT admin limpo, paginação completa — evita RLS por uid)
    const [allActs, schedsRes] = await Promise.all([
      sbAdminFetchAll('activations'),
      apiGet('scheduled_benefits?limit=500'),
    ]);
    ACTS.allScheds = schedsRes.data || [];

    // Allowlist: apenas status='active' (pagamento confirmado)
    ACTS.allActs = allActs.filter(isConfirmedAct);
    _renderActsGrowth(ACTS.allActs);
    _renderActsEngagement(ACTS.allActs);
    _renderActsType(ACTS.allActs, ACTS.allScheds);
    _renderActsCat(ACTS.allActs, ACTS.allScheds);
    setText('acts-updated', new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' }));
  } catch (e) {
    console.error('[Ativações]', e);
    showAdminToast('Erro ao carregar ativações.', 'error');
  } finally {
    if (btn) btn.classList.remove('spinning');
  }
}

function _renderActsEngagement(acts) {
  const threshold = Date.now() - 30 * 24 * 60 * 60 * 1000; // últimos 30 dias

  // Ativações do último mês
  const lastMonthActs = acts.filter(a => {
    const ts = typeof a.created_at === 'number' ? a.created_at : new Date(a.created_at).getTime();
    return !isNaN(ts) && ts >= threshold;
  });

  // Clientes únicos ativos (≥1 ativação no último mês)
  const activeClients = new Set(lastMonthActs.map(a => a.user_id).filter(Boolean));

  const total   = lastMonthActs.length;
  const clients = activeClients.size;
  const avg     = clients > 0 ? (total / clients).toFixed(1) : '—';

  setText('acts-active-clients', clients.toLocaleString('pt-BR'));
  setText('acts-last-month',     total.toLocaleString('pt-BR'));
  setText('acts-avg-active',     avg);
}

function _renderActsType(acts) {
  const el = document.getElementById('acts-type-bars');
  if (!el) return;

  // Buckets fixos por a.type da activation
  const TYPE_META = [
    { types: ['individual'],              label: 'Unitária',            color: '#60a5fa', icon: 'fa-ticket-alt'  },
    { types: ['advance_individual'],      label: 'Unitária Antecip.',   color: '#93c5fd', icon: 'fa-ticket-alt'  },
    { types: ['night', 'night_link'],     label: 'Noite Toda',          color: '#c084fc', icon: 'fa-moon'         },
    { types: ['advance_night'],           label: 'Noite Toda Antecip.', color: '#d8b4fe', icon: 'fa-moon'         },
    { types: ['advance_free'],            label: 'Grátis Antecip.',     color: '#86efac', icon: 'fa-gift'         },
    { types: ['free_credit'],             label: 'Crédito Grátis',      color: '#4ade80', icon: 'fa-gift'         },
    { types: ['free_credit_used'],        label: 'Crédito Usado',       color: '#34d399', icon: 'fa-check-circle' },
    { types: ['night_checkin'],           label: 'Checkin Noite',       color: '#a78bfa', icon: 'fa-sign-in-alt'  },
  ];

  const knownTypes = new Set(TYPE_META.flatMap(m => m.types));
  const countMap = {};
  let outros = 0;

  acts.forEach(a => {
    const t = a.type || '';
    if (knownTypes.has(t)) countMap[t] = (countMap[t] || 0) + 1;
    else outros++;
  });

  const items = TYPE_META
    .map(m => ({
      label: m.label,
      color: m.color,
      icon:  m.icon,
      count: m.types.reduce((s, t) => s + (countMap[t] || 0), 0),
    }))
    .filter(i => i.count > 0);

  if (outros > 0) items.push({ label: 'Outros', count: outros, color: '#6b7280', icon: 'fa-question-circle' });

  const total = items.reduce((s, i) => s + i.count, 0);
  setText('acts-type-sub', `${total.toLocaleString('pt-BR')} ativações`);

  if (!items.length) {
    el.innerHTML = '<p style="color:var(--text2);font-size:13px">Sem ativações registradas.</p>';
    return;
  }

  el.innerHTML = items.map(item => {
    const pct = total ? Math.round(item.count / total * 100) : 0;
    return `
      <div class="cli-bar-row">
        <div class="cli-bar-label">
          <i class="fa ${item.icon}" style="color:${item.color};width:14px;text-align:center"></i>
          <span>${item.label}</span>
        </div>
        <div class="cli-bar-track">
          <div class="cli-bar-fill" style="width:${pct}%;background:${item.color}"></div>
        </div>
        <div class="cli-bar-values">
          <span class="cli-bar-pct" style="color:${item.color}">${pct}%</span>
          <span class="cli-bar-abs">${item.count.toLocaleString('pt-BR')}</span>
        </div>
      </div>`;
  }).join('');
}

function _renderActsCat(acts, scheds) {
  const el = document.getElementById('acts-cat-bars');
  if (!el) return;

  // ── Mapa de cruzamento: "bar_id|YYYY-MM-DD" → category do scheduled_benefit
  const schedCatMap = new Map();
  (scheds || []).forEach(s => {
    if (!s.bar_id || !s.date || !s.category) return;
    const key = `${s.bar_id}|${s.date}`;
    if (!schedCatMap.has(key)) schedCatMap.set(key, s.category.trim());
  });

  // Cores e ícones fixos por categoria oficial
  const CAT_META = {
    'Comidinha':   { color: '#fb923c', icon: 'fa-hamburger' },
    'Bebida':      { color: '#60a5fa', icon: 'fa-beer'      },
    'Entrada VIP': { color: '#c084fc', icon: 'fa-star'      },
    'Desconto':    { color: '#fbbf24', icon: 'fa-tag'       },
    'Outros':      { color: '#4ade80', icon: 'fa-gift'      },
  };
  const CAT_ORDER = ['Comidinha', 'Bebida', 'Entrada VIP', 'Desconto', 'Outros'];

  // ── Conta ativações por categoria
  // Cruzamento: activations.bar_id + activations.benefit_date
  //          == scheduled_benefits.bar_id + scheduled_benefits.date → category
  const countMap = {};
  let semCorrespondencia = 0;

  acts.forEach(a => {
    if (!a.bar_id || !a.benefit_date) { semCorrespondencia++; return; }
    const cat = schedCatMap.get(`${a.bar_id}|${a.benefit_date}`);
    if (!cat) { semCorrespondencia++; return; }
    countMap[cat] = (countMap[cat] || 0) + 1;
  });

  const identified = Object.values(countMap).reduce((s, v) => s + v, 0);
  const total      = identified + semCorrespondencia;
  setText('acts-cat-sub',
    `${identified.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')} ativações identificadas`);

  if (!identified) {
    el.innerHTML = '<div style="color:var(--text2);font-size:13px">Nenhuma ativação com categoria identificada.</div>';
    return;
  }

  // Ordena: categorias oficiais primeiro (ordem fixa), depois extras por volume
  const sorted = [
    ...CAT_ORDER.filter(c => countMap[c] > 0).map(c => [c, countMap[c]]),
    ...Object.entries(countMap).filter(([c]) => !CAT_ORDER.includes(c)).sort((a, b) => b[1] - a[1]),
  ];

  el.innerHTML = sorted.map(([cat, count]) => {
    const pct  = Math.round(count / identified * 100);
    const meta = CAT_META[cat] || { color: '#94a3b8', icon: 'fa-circle' };
    return `
      <div class="cli-bar-row">
        <div class="cli-bar-label">
          <i class="fa ${meta.icon}" style="color:${meta.color};width:14px;text-align:center"></i>
          <span>${escHtml(cat)}</span>
        </div>
        <div class="cli-bar-track">
          <div class="cli-bar-fill" style="width:${pct}%;background:${meta.color}"></div>
        </div>
        <div class="cli-bar-values">
          <span class="cli-bar-pct" style="color:${meta.color}">${pct}%</span>
          <span class="cli-bar-abs">${count.toLocaleString('pt-BR')}</span>
        </div>
      </div>`;
  }).join('');
}

function setActsGranularity(gran, el) {
  ACTS.granularity = gran;
  document.querySelectorAll('#acts-gran-week, #acts-gran-month').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  if (ACTS.allActs.length) _renderActsGrowth(ACTS.allActs);
}

function _renderActsGrowth(acts) {
  const ctx = document.getElementById('chart-acts-growth');
  if (!ctx) return;
  if (ACTS.chart) { ACTS.chart.destroy(); ACTS.chart = null; }

  const now  = new Date();
  const gran = ACTS.granularity;

  function periodKey(ts) {
    const d = new Date(ts);
    if (gran === 'month') {
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    }
    const day  = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const mon  = new Date(d);
    mon.setDate(d.getDate() + diff);
    return mon.toISOString().slice(0, 10);
  }

  if (!acts.length) return;

  // ── Converte todos os created_at (string ISO ou ms) para timestamps numéricos
  // Math.min com strings ISO retorna NaN — é preciso converter explicitamente antes.
  const actTimestamps = acts
    .map(a => {
      if (!a.created_at) return null;
      const t = typeof a.created_at === 'number' ? a.created_at : new Date(a.created_at).getTime();
      return isNaN(t) ? null : t;
    })
    .filter(t => t !== null);

  if (!actTimestamps.length) return;

  const oldest   = Math.min(...actTimestamps);
  const startKey = periodKey(oldest);
  const todayKey = periodKey(now.getTime());

  // ── Gera sequência contínua de períodos: mais antigo → hoje
  // Cursor com T12:00:00 fixo evita ambiguidade de fuso em mode week
  const periods = [];
  const cursor  = gran === 'month'
    ? new Date(startKey + '-01T12:00:00')
    : new Date(startKey + 'T12:00:00');

  while (periodKey(cursor.getTime()) <= todayKey) {
    periods.push(periodKey(cursor.getTime()));
    gran === 'month'
      ? cursor.setMonth(cursor.getMonth() + 1)
      : cursor.setDate(cursor.getDate() + 7);
  }
  if (!periods.includes(todayKey)) periods.push(todayKey);
  const uniq = [...new Set(periods)].sort();

  // ── Conta ativações por período usando o mapa de timestamps já convertidos
  const counts = {};
  uniq.forEach(p => { counts[p] = 0; });
  actTimestamps.forEach(ts => {
    const p = periodKey(ts);
    if (counts[p] !== undefined) counts[p]++;
    // se o período não está no range (improvável), ignora silenciosamente
  });

  const labels = uniq.map(p => {
    if (gran === 'month') {
      const [y, m] = p.split('-');
      return ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][+m-1] + '/' + y.slice(2);
    }
    const [, mm, dd] = p.split('-');
    return `${dd}/${mm}`;
  });

  ACTS.chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label:           'Ativações',
        data:            uniq.map(p => counts[p] || 0),
        borderColor:     '#60a5fa',
        backgroundColor: 'rgba(96,165,250,.12)',
        borderWidth: 2.5, fill: true, tension: 0.4,
        pointBackgroundColor: '#60a5fa', pointRadius: 3, pointHoverRadius: 5,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1a24',
          borderColor:     'rgba(255,255,255,.1)',
          borderWidth:     1,
          titleColor:      '#e8e8f0',
          bodyColor:       '#8888aa',
          padding:         12,
          callbacks: {
            title: i => `Período: ${i[0].label}`,
            label: i => ` Ativações: ${i.parsed.y}`,
          },
        },
      },
      scales: {
        x: { ticks: { color: '#8888aa', font: { size: 11 }, maxRotation: 45 }, grid: { color: 'rgba(255,255,255,.04)' } },
        y: { ticks: { color: '#8888aa', font: { size: 11 }, stepSize: 1 }, grid: { color: 'rgba(255,255,255,.04)' }, beginAtZero: true },
      },
    },
  });
}

/* ══════════════════════════════════════════════════
   BENEFÍCIOS — Ativações por Categoria
══════════════════════════════════════════════════ */

const BENEFIT_CATS = ['Comidinha', 'Bebida', 'Entrada VIP', 'Desconto', 'Outros'];
const CAT_EMOJI    = { 'Comidinha': '🍔', 'Bebida': '🍺', 'Entrada VIP': '⭐', 'Desconto': '🏷️', 'Outros': '✨' };
const CAT_COLOR    = {
  'Comidinha':   '#f97316',
  'Bebida':      '#60a5fa',
  'Entrada VIP': '#d4a843',
  'Desconto':    '#34d399',
  'Outros':      '#a78bfa',
};

async function loadBeneficios() {
  const btn = document.querySelector('#section-beneficios .btn-refresh');
  if (btn) btn.classList.add('spinning');

  try {
    // activations via sbAdminFetchAll (JWT admin limpo — evita RLS por uid)
    const [schedsRes, acts] = await Promise.all([
      apiGet('scheduled_benefits?limit=500'),
      sbAdminFetchAll('activations'),
    ]);

    const scheds = schedsRes.data || [];

    // ── Mapa de cruzamento: "bar_id|YYYY-MM-DD" → category
    const schedCatMap = new Map();
    scheds.forEach(s => {
      if (!s.bar_id || !s.date || !s.category) return;
      const key = `${s.bar_id}|${s.date}`;
      if (!schedCatMap.has(key)) schedCatMap.set(key, s.category.trim());
    });

    // ── Inicializa contadores por categoria ──────────────────────────
    const allCats = [...BENEFIT_CATS, 'Sem categoria'];
    const catStats = {};
    allCats.forEach(c => {
      catStats[c] = { scheds: 0, total: 0 };
    });

    // Conta benefícios postados por categoria
    scheds.forEach(s => {
      const cat = (s.category || '').trim() || 'Sem categoria';
      if (!catStats[cat]) catStats[cat] = { scheds: 0, total: 0 };
      catStats[cat].scheds++;
    });

    // Conta ativações reais via cruzamento:
    // activations.bar_id + activations.benefit_date == scheduled_benefits.bar_id + scheduled_benefits.date
    acts.filter(isConfirmedAct).forEach(a => {
      if (!a.bar_id || !a.benefit_date) return;
      const cat = schedCatMap.get(`${a.bar_id}|${a.benefit_date}`);
      if (!cat) return;
      if (!catStats[cat]) catStats[cat] = { scheds: 0, total: 0 };
      catStats[cat].total++;
    });

    // ── KPIs gerais ──────────────────────────────────────────────────
    const totalScheds  = scheds.length;
    const totalActs    = Object.values(catStats).reduce((s, c) => s + c.total, 0);
    const uniqueBars   = new Set(scheds.map(s => s.bar_id).filter(Boolean)).size;
    const topCatEntry  = Object.entries(catStats)
      .filter(([, v]) => v.total > 0)
      .sort((a, b) => b[1].total - a[1].total)[0];
    const topCat       = topCatEntry
      ? `${CAT_EMOJI[topCatEntry[0]] || '🏷️'} ${topCatEntry[0]}`
      : '—';

    setText('ben-total-scheds', totalScheds.toLocaleString('pt-BR'));
    setText('ben-total-acts',   totalActs.toLocaleString('pt-BR'));
    setText('ben-top-cat',      topCat);
    setText('ben-bars-count',   uniqueBars.toLocaleString('pt-BR'));
    setText('ben-updated',      new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' }));

    // ── Tabela por categoria ─────────────────────────────────────────
    const tbody = document.getElementById('tbody-ben-cat');
    if (tbody) {
      // Ordena: categorias com mais total primeiro; "Sem categoria" sempre ao final
      const sorted = allCats
        .filter(c => c !== 'Sem categoria')
        .map(c => [c, catStats[c]])
        .sort((a, b) => b[1].total - a[1].total);

      // Adiciona "Sem categoria" ao final apenas se tiver registros
      if (catStats['Sem categoria']?.scheds > 0 || catStats['Sem categoria']?.total > 0) {
        sorted.push(['Sem categoria', catStats['Sem categoria']]);
      }

      if (!sorted.length || sorted.every(([, v]) => v.scheds === 0 && v.total === 0)) {
        tbody.innerHTML = '<tr><td colspan="6" class="bk-td-empty">Nenhum benefício cadastrado ainda.</td></tr>';
      } else {
        tbody.innerHTML = sorted.map(([cat, s]) => {
          const emoji   = CAT_EMOJI[cat] || '🏷️';
          const color   = CAT_COLOR[cat] || 'rgba(255,255,255,.5)';
          const pct     = totalActs > 0 ? ((s.total / totalActs) * 100).toFixed(1) : '0.0';
          const pctBar  = totalActs > 0 ? Math.round((s.total / totalActs) * 100) : 0;
          return `
            <tr>
              <td>
                <div style="display:flex;align-items:center;gap:8px">
                  <span style="display:inline-flex;align-items:center;justify-content:center;
                    width:30px;height:30px;border-radius:8px;font-size:15px;
                    background:${color}18;border:1px solid ${color}40">${emoji}</span>
                  <span style="font-weight:600;color:rgba(255,255,255,.9)">${escHtml(cat)}</span>
                </div>
              </td>
              <td style="text-align:center;color:rgba(255,255,255,.6)">${s.scheds}</td>
              <td style="text-align:center;font-weight:800;font-size:18px;color:${color}">${s.total}</td>
              <td style="text-align:right">
                <div style="display:flex;align-items:center;justify-content:flex-end;gap:8px">
                  <div style="width:80px;height:6px;border-radius:4px;background:rgba(255,255,255,.08);overflow:hidden">
                    <div style="height:100%;width:${pctBar}%;background:${color};border-radius:4px;transition:width .4s"></div>
                  </div>
                  <span style="font-size:12px;font-weight:700;color:rgba(255,255,255,.6);min-width:36px">${pct}%</span>
                </div>
              </td>
            </tr>`;
        }).join('');
      }
    }

    // ── Tabela de benefícios recentes ────────────────────────────────
    // ── Mapa "bar_id|YYYY-MM-DD" → contagem de ativações confirmadas
    // Reutiliza o mesmo cruzamento já feito para catStats, agora por chave individual
    const schedActMap = new Map();
    acts.filter(isConfirmedAct).forEach(a => {
      if (!a.bar_id || !a.benefit_date) return;
      const key = `${a.bar_id}|${a.benefit_date}`;
      schedActMap.set(key, (schedActMap.get(key) || 0) + 1);
    });

    const tbodyRecent = document.getElementById('tbody-ben-recent');
    if (tbodyRecent) {
      const recent = [...scheds]
        .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
        .slice(0, 30);

      if (!recent.length) {
        tbodyRecent.innerHTML = '<tr><td colspan="6" class="bk-td-empty">Nenhum benefício cadastrado ainda.</td></tr>';
      } else {
        tbodyRecent.innerHTML = recent.map(s => {
          const cat     = (s.category || '').trim() || 'Sem categoria';
          const emoji   = CAT_EMOJI[cat] || '🏷️';
          const color   = CAT_COLOR[cat] || 'rgba(255,255,255,.5)';
          const dateStr = s.date
            ? new Date(s.date + 'T12:00:00').toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit' })
            : '—';
          // Contagem real: cruzamento activations × scheduled_benefits via bar_id + date
          const actCount = s.bar_id && s.date ? (schedActMap.get(`${s.bar_id}|${s.date}`) || 0) : 0;
          return `
            <tr>
              <td style="font-weight:600;color:rgba(255,255,255,.85)">${escHtml(s.bar_name || '—')}</td>
              <td style="color:rgba(255,255,255,.7);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                  title="${escHtml(s.title || '')}">  ${escHtml(s.title || '—')}</td>
              <td style="text-align:center">
                <span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:12px;
                  font-size:11px;font-weight:700;background:${color}18;border:1px solid ${color}40;color:${color}">
                  ${emoji} ${escHtml(cat)}
                </span>
              </td>
              <td style="text-align:center;color:rgba(255,255,255,.55);font-size:12px">${dateStr}</td>
              <td style="text-align:center;font-weight:700;color:#60a5fa">${actCount}</td>
            </tr>`;
        }).join('');
      }
    }

  } catch (e) {
    console.error('[Benefícios]', e);
    showAdminToast('Erro ao carregar dados de benefícios.', 'error');
  } finally {
    if (btn) btn.classList.remove('spinning');
  }
}

/* ══════════════════════════════════════════════════
   PROMOTERS — Ranking por impacto
══════════════════════════════════════════════════ */

let _promoRankRows  = [];
let _promoRankShown = 0;

async function loadPromoters() {
  const btn = document.querySelector('#section-promoters .btn-refresh');
  if (btn) btn.classList.add('spinning');

  try {
    // activations via sbAdminFetchAll (JWT admin limpo, paginação completa — evita RLS por uid)
    const [usersRes, acts] = await Promise.all([
      apiGet('users?limit=1000'),
      sbAdminFetchAll('activations'),
    ]);
    const users = usersRes.data || [];

    // Separa promoters e clientes
    const promoters = users.filter(u => u.role === 'promoter');
    const clientes  = users.filter(u => u.role === 'cliente');

    // Ativações pagas confirmadas — allowlist: status='active' + amount > 0
    const paidActs = acts.filter(a => isConfirmedAct(a) && (a.amount || 0) > 0);

    // Mapa user_id → total gasto (ativações pagas)
    const spentByUser = {};
    paidActs.forEach(a => {
      if (!a.user_id) return;
      spentByUser[a.user_id] = (spentByUser[a.user_id] || 0) + (a.amount || 0);
    });

    // Agrupa clientes por promoter (referred_by = promoter.id)
    const statsByPromoter = {};
    clientes.forEach(c => {
      if (!c.referred_by) return;
      // Confirma que referred_by aponta para um promoter
      const referrer = users.find(u => u.id === c.referred_by && u.role === 'promoter');
      if (!referrer) return;
      const pid = referrer.id;
      if (!statsByPromoter[pid]) statsByPromoter[pid] = { clientCount: 0, totalSpent: 0 };
      statsByPromoter[pid].clientCount++;
      statsByPromoter[pid].totalSpent += spentByUser[c.id] || 0;
    });

    // Monta linhas do ranking ordenadas por total gasto (desc)
    _promoRankRows = promoters
      .map(p => ({
        id:          p.id,
        name:        p.name || p.email || '—',
        code:        p.referral_code || '—',
        clientCount: statsByPromoter[p.id]?.clientCount || 0,
        totalSpent:  statsByPromoter[p.id]?.totalSpent  || 0,
      }))
      .filter(r => r.clientCount > 0)          // oculta promoters sem nenhum indicado
      .sort((a, b) => b.totalSpent - a.totalSpent);

    // ── KPIs ──────────────────────────────────────────────────────────
    const totalClients = _promoRankRows.reduce((s, r) => s + r.clientCount, 0);
    const totalSpent   = _promoRankRows.reduce((s, r) => s + r.totalSpent,  0);
    const avgSpent     = totalClients > 0 ? totalSpent / totalClients : 0;

    setText('promo-rank-total',   promoters.length.toLocaleString('pt-BR'));
    setText('promo-rank-clients', totalClients.toLocaleString('pt-BR'));
    setText('promo-rank-spent',   fmtBRL(totalSpent));
    setText('promo-rank-avg',     fmtBRL(avgSpent));
    setText('promo-rank-updated', new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' }));

    // ── Ranking paginado ──────────────────────────────────────────────
    _promoRankShown = 0;
    const tbody = document.getElementById('tbody-promo-rank');
    if (tbody) tbody.innerHTML = '';
    _promoRankAppend(5);

  } catch (e) {
    console.error('[Promoters]', e);
    showAdminToast('Erro ao carregar dados de promoters.', 'error');
  } finally {
    if (btn) btn.classList.remove('spinning');
  }
}

function _promoRankAppend(count) {
  const tbody   = document.getElementById('tbody-promo-rank');
  const footer  = document.getElementById('promo-rank-footer');
  const countEl = document.getElementById('promo-rank-count');
  const subEl   = document.getElementById('promo-rank-sub');
  const btnMore = document.getElementById('btn-promo-rank-more');
  if (!tbody) return;

  if (!_promoRankRows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="bk-td-empty">Nenhum promoter com indicados cadastrados.</td></tr>';
    if (footer) footer.style.display = 'none';
    return;
  }

  const posCls = ['gold', 'silver', 'bronze'];
  const slice  = _promoRankRows.slice(_promoRankShown, _promoRankShown + count);

  slice.forEach((row, idx) => {
    const pos = _promoRankShown + idx + 1;
    const cls = posCls[pos - 1] || '';
    const tr  = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="bk-rank-pos ${cls}" style="display:inline-flex;width:26px;height:26px;font-size:11px">${pos}</span></td>
      <td style="font-weight:600">${escHtml(row.name)}</td>
      <td><span style="font-family:monospace;font-size:12px;background:rgba(192,132,252,.12);color:#c084fc;padding:2px 8px;border-radius:8px;border:1px solid rgba(192,132,252,.25)">${escHtml(row.code)}</span></td>
      <td style="text-align:center;font-weight:700;color:#c084fc">${row.clientCount}</td>
      <td style="text-align:right;font-weight:700;color:#4ade80">${fmtBRL(row.totalSpent)}</td>`;
    tbody.appendChild(tr);
  });

  _promoRankShown += slice.length;

  const total     = _promoRankRows.length;
  const remaining = total - _promoRankShown;
  if (footer) {
    footer.style.display = 'flex';
    if (countEl) countEl.textContent = `Exibindo ${_promoRankShown} de ${total} promoters`;
    if (subEl)   subEl.textContent   = `${total} promoters com indicados`;
    if (btnMore) {
      if (remaining > 0) {
        btnMore.style.display = 'inline-flex';
        btnMore.innerHTML = `<i class="fa fa-plus" style="margin-right:5px"></i> Mostrar mais ${Math.min(remaining, 10)}`;
      } else {
        btnMore.style.display = 'none';
      }
    }
  }
}

function promoRankLoadMore() {
  _promoRankAppend(10);
}

/* ══════════════════════════════════════════════════
   BARES — Engajamento e crescimento
══════════════════════════════════════════════════ */

const BAR = { allBars: [], schedBenefits: [], granularity: 'week', chart: null };

async function loadBares() {
  const btn = document.querySelector('#section-bares .btn-refresh');
  if (btn) btn.classList.add('spinning');

  try {
    // users, scheduled_benefits e activations todos via sbAdminFetchAll:
    // - bypassa RLS (usa JWT admin, não token do usuário logado)
    // - paginação completa (500/página) — sem limite fixo de 1000
    const [allUsers, scheds, acts] = await Promise.all([
      sbAdminFetchAll('users'),
      sbAdminFetchAll('scheduled_benefits'),
      sbAdminFetchAll('activations'),
    ]);

    // Filtra apenas bares; ordena por created_at convertendo string ISO → ms
    BAR.allBars       = allUsers
      .filter(u => u.role === 'bar')
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    BAR.schedBenefits = scheds;

    // Ativações confirmadas — allowlist: apenas status='active'
    BAR.activeActs = acts.filter(isConfirmedAct);

    // Mapa bar_id → bar_genre
    // As ativações gravam o campo bar_id do usuário-bar (= ID do registro na tabela bars),
    // não o id do usuário. Por isso usamos b.bar_id como chave, com fallback para b.id.
    BAR.barGenreMap = {};
    BAR.allBars.forEach(b => {
      const key = b.bar_id || b.id;
      BAR.barGenreMap[key] = b.bar_genre || '';
    });

    _renderBares();
    setText('bar-updated', new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' }));

  } catch (e) {
    console.error('[Bares]', e);
    showAdminToast('Erro ao carregar dados de bares.', 'error');
  } finally {
    if (btn) btn.classList.remove('spinning');
  }
}

function _renderBares() {
  const bars   = BAR.allBars;
  const scheds = BAR.schedBenefits;
  const total  = bars.length;

  // ── Limites de tempo ────────────────────────────────────────────────
  const now      = Date.now();
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
  // "mês anterior": de 60 a 30 dias atrás (para calcular churn)
  const twoMonthsAgo = now - 60 * 24 * 60 * 60 * 1000;

  // ── Bares ativos no último mês ──────────────────────────────────────
  // Ativo = postou pelo menos 1 benefício agendado nos últimos 30 dias
  // scheduled_benefits.bar_id = ID da tabela bars (= b.bar_id no usuário, não b.id)
  // created_at vem como string ISO do Supabase — converte para ms antes de comparar
  const activeBarIds = new Set(
    scheds
      .filter(s => new Date(s.created_at).getTime() >= monthAgo)
      .map(s => s.bar_id)
      .filter(Boolean)
  );
  // Confirma que o bar_id pertence a um bar cadastrado na plataforma
  const activeCount = [...activeBarIds].filter(id =>
    bars.some(b => (b.bar_id || b.id) === id)
  ).length;
  const activePct   = total > 0 ? Math.round(activeCount / total * 100) : 0;

  setText('bar-total',       total.toLocaleString('pt-BR'));
  setText('bar-active',      activeCount.toLocaleString('pt-BR'));
  setText('bar-active-pct',  `${activePct}% do total de bares`);

  // ── Taxa de churn (mês passado) ──────────────────────────────────────
  // Denominador = bares com mais de 2 meses na plataforma (created_at < twoMonthsAgo)
  // Numerador   = desses bares, os que não postaram nenhum benefício
  //               no período de 30 a 60 dias atrás (mês passado)
  const barsOver2Months = bars.filter(b => new Date(b.created_at).getTime() < twoMonthsAgo);
  const churnBase = barsOver2Months.length;

  const barIdsWithPostLastMonth = new Set(
    scheds
      .filter(s => {
        const t = new Date(s.created_at).getTime();
        return t >= twoMonthsAgo && t < monthAgo;
      })
      .map(s => s.bar_id)
      .filter(Boolean)
  );
  // Bares em churn = com mais de 2 meses e sem post no mês passado
  const churnedCount = barsOver2Months.filter(b => {
    const bid = b.bar_id || b.id;
    return !barIdsWithPostLastMonth.has(bid);
  }).length;
  const churnPct = churnBase > 0 ? Math.round(churnedCount / churnBase * 100) : 0;

  setText('bar-churn',     `${churnPct}%`);
  setText('bar-churn-abs', `${churnedCount} de ${churnBase} bares sem post no mês passado`);

  // ── Novos no último mês ─────────────────────────────────────────────
  const newBars = bars.filter(b => new Date(b.created_at).getTime() >= monthAgo).length;
  setText('bar-new-month', newBars.toLocaleString('pt-BR'));

  // ── Gráfico de evolução ──────────────────────────────────────────────
  _renderBarChart(bars, scheds);

  // ── Top 5 Bares (ativações) ──────────────────────────────────────────
  renderRankingBars(BAR.activeActs || []);

  // ── Ativações por tipo de bar ────────────────────────────────────────
  _renderBarGenreChart(BAR.activeActs || [], BAR.barGenreMap || {});
}

/* ── Ativações por tipo de bar ── */
function _renderBarGenreChart(acts, barGenreMap) {
  const el = document.getElementById('bar-genre-bars');
  if (!el) return;

  const GENRE_MAP = {
    balada:       { label: '🎵 Balada',       color: '#c084fc' },
    boteco:       { label: '🍺 Boteco',        color: '#fbbf24' },
    pub:          { label: '🎸 Pub',           color: '#60a5fa' },
    rooftop:      { label: '🌆 Rooftop',       color: '#f472b6' },
    lounge:       { label: '🛋️ Lounge',        color: '#a78bfa' },
    sertanejo:    { label: '🤠 Sertanejo',     color: '#fb923c' },
    pagode:       { label: '🥁 Pagode',        color: '#34d399' },
    rock:         { label: '🎸 Rock',          color: '#f87171' },
    eletronica:   { label: '🎧 Eletrônica',    color: '#22d3ee' },
    mpb:          { label: '🎶 MPB/Jazz',      color: '#4ade80' },
    diversificado:{ label: '🎼 Diversificado', color: '#e879f9' },
  };

  // Conta ativações por gênero do bar
  const counts = {};
  let totalActs = 0;
  acts.forEach(a => {
    if (!a.bar_id) return;
    const genre = (barGenreMap[a.bar_id] || '').toLowerCase().trim() || 'outro';
    counts[genre] = (counts[genre] || 0) + 1;
    totalActs++;
  });

  if (!totalActs) {
    el.innerHTML = '<div class="bk-loading" style="padding:12px 0">Nenhuma ativação registrada.</div>';
    setText('bar-genre-sub', '');
    return;
  }

  setText('bar-genre-sub', `${totalActs} ativações totais`);

  // Ordena por contagem decrescente
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  el.innerHTML = sorted.map(([genre, count]) => {
    const pct   = Math.round(count / totalActs * 100);
    const info  = GENRE_MAP[genre] || { label: `✨ ${genre.charAt(0).toUpperCase() + genre.slice(1)}`, color: '#8888aa' };
    return `
      <div class="cli-bar-row">
        <div class="cli-bar-label">
          <span>${info.label}</span>
        </div>
        <div class="cli-bar-track">
          <div class="cli-bar-fill" style="width:${pct}%;background:${info.color}"></div>
        </div>
        <div class="cli-bar-values">
          <span class="cli-bar-pct" style="color:${info.color}">${pct}%</span>
          <span class="cli-bar-abs">${count}</span>
        </div>
      </div>`;
  }).join('');
}

/* Troca granularidade e re-renderiza o gráfico */
function setBarGranularity(gran, el) {
  BAR.granularity = gran;
  document.querySelectorAll('#bar-gran-week, #bar-gran-month').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  if (BAR.allBars.length) _renderBarChart(BAR.allBars, BAR.schedBenefits);
}

function _renderBarChart(bars, scheds) {
  const ctx = document.getElementById('chart-bar-growth');
  if (!ctx) return;

  const now  = new Date();
  const gran = BAR.granularity;

  // ── Chave de período para um timestamp (ms) ─────────────────────────
  function periodKey(ts) {
    const d = new Date(ts);
    if (gran === 'month') {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    // Semana ISO: início na segunda-feira
    const day  = d.getDay();                      // 0=dom … 6=sáb
    const diff = day === 0 ? -6 : 1 - day;        // dias até segunda anterior
    const mon  = new Date(d);
    mon.setDate(d.getDate() + diff);
    mon.setHours(0, 0, 0, 0);
    return mon.toISOString().slice(0, 10);
  }

  // ── Gera sequência contínua de períodos: mais antigo → hoje ─────────
  // oldestTs = menor created_at real entre todos os bares (ignora nulls).
  // Math.min garante robustez mesmo que bars[] não esteja ordenado ou
  // contenha entradas com created_at nulo.
  const barTimestamps = bars
    .map(b => b.created_at ? new Date(b.created_at).getTime() : null)
    .filter(t => t !== null && !isNaN(t));
  const oldestTs = barTimestamps.length > 0 ? Math.min(...barTimestamps) : now.getTime();

  const startKey = periodKey(oldestTs);
  const todayKey = periodKey(now.getTime());

  const uniquePeriods = [];
  const cursor = gran === 'month'
    ? new Date(startKey + '-01T12:00:00')
    : new Date(startKey + 'T12:00:00');

  while (periodKey(cursor.getTime()) <= todayKey) {
    uniquePeriods.push(periodKey(cursor.getTime()));
    gran === 'month'
      ? cursor.setMonth(cursor.getMonth() + 1)
      : cursor.setDate(cursor.getDate() + 7);
  }
  if (!uniquePeriods.includes(todayKey)) uniquePeriods.push(todayKey);

  // ── Total acumulado de bares por período ─────────────────────────────
  // Bares com created_at nulo são contados no PRIMEIRO período (não descartados),
  // pois são bares reais que existem na plataforma e devem aparecer no total.
  const newInPeriod = new Array(uniquePeriods.length).fill(0);
  let barsWithoutDate = 0;
  bars.forEach(b => {
    if (!b.created_at) { barsWithoutDate++; return; }
    const ts = new Date(b.created_at).getTime();
    if (isNaN(ts)) { barsWithoutDate++; return; }
    const bKey = periodKey(ts);
    let idx = uniquePeriods.indexOf(bKey);
    // se o período ficou fora do range (anterior ao startKey), vai pro primeiro bucket
    if (idx === -1) idx = bKey < uniquePeriods[0] ? 0 : uniquePeriods.length - 1;
    newInPeriod[idx]++;
  });
  // bares sem data de cadastro são adicionados ao primeiro período
  newInPeriod[0] += barsWithoutDate;

  // acumulado progressivo — o último valor DEVE ser igual a bars.length
  const totalData = [];
  let running = 0;
  newInPeriod.forEach(n => { running += n; totalData.push(running); });

  // ── Bares ativos por período ─────────────────────────────────────────
  // "Ativo" num período = postou pelo menos 1 benefício agendado naquele período.
  // Usa s.created_at (quando o benefício foi CRIADO/postado pelo bar), não s.date
  // (data do evento), pois s.date pode ser futura e deslocar o bar para período errado.
  const activeMap = {};   // periodKey → Set<bar_id>
  uniquePeriods.forEach(p => { activeMap[p] = new Set(); });

  scheds.forEach(s => {
    if (!s.bar_id || !s.created_at) return;
    const sTs = new Date(s.created_at).getTime();
    if (isNaN(sTs)) return;
    const sKey = periodKey(sTs);
    if (activeMap[sKey]) activeMap[sKey].add(s.bar_id);
  });
  const activeData = uniquePeriods.map(p => activeMap[p].size);

  // ── Labels legíveis ─────────────────────────────────────────────────
  const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const labels = uniquePeriods.map(p => {
    if (gran === 'month') {
      const [y, m] = p.split('-');
      return `${MONTHS[parseInt(m, 10) - 1]}/${y.slice(2)}`;
    }
    const [, mm, dd] = p.split('-');
    return `${dd}/${mm}`;
  });

  // ── Destrói gráfico anterior e cria novo ────────────────────────────
  if (BAR.chart) { BAR.chart.destroy(); BAR.chart = null; }

  BAR.chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label:           'Total de bares',
          data:            totalData,
          borderColor:     '#fbbf24',
          backgroundColor: 'rgba(251,191,36,.12)',
          borderWidth: 2.5, fill: true, tension: 0.4,
          pointBackgroundColor: '#fbbf24', pointRadius: 4, pointHoverRadius: 6,
        },
        {
          label:           'Bares ativos',
          data:            activeData,
          borderColor:     '#4ade80',
          backgroundColor: 'rgba(74,222,128,.10)',
          borderWidth: 2.5, fill: true, tension: 0.4,
          pointBackgroundColor: '#4ade80', pointRadius: 4, pointHoverRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1a24',
          borderColor:     'rgba(255,255,255,.1)',
          borderWidth:     1,
          titleColor:      '#e8e8f0',
          bodyColor:       '#8888aa',
          padding:         10,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}`,
          },
        },
      },
      scales: {
        x: {
          grid:  { color: 'rgba(255,255,255,.05)' },
          ticks: { color: '#8888aa', font: { size: 11 }, maxRotation: 45 },
        },
        y: {
          beginAtZero: true,
          grid:  { color: 'rgba(255,255,255,.05)' },
          ticks: { color: '#8888aa', font: { size: 11 }, precision: 0 },
        },
      },
    },
  });
}

/* ══════════════════════════════════════════════════
   CLIENTES — Evolução de cadastros
══════════════════════════════════════════════════ */

// Estado da seção Clientes
const CLI = { allClientes: [], userRoleMap: {}, granularity: 'week', qualityGranularity: 'month', chart: null, qualityChart: null };

async function loadClientes() {
  const btn = document.querySelector('#section-clientes .btn-refresh');
  if (btn) btn.classList.add('spinning');

  try {
    // users via apiGet; activations e earnings via sbAdminFetchAll (JWT admin limpo,
    // paginação completa — evita RLS por uid que truncaria os dados)
    const [usersRes, acts, earnings] = await Promise.all([
      apiGet('users?limit=1000'),
      sbAdminFetchAll('activations'),
      sbAdminFetchAll('earnings'),
    ]);
    const users = usersRes.data || [];

    // Guarda no estado para uso no ranking
    CLI.acts     = acts;
    CLI.earnings = earnings;

    // Monta mapa id → role para classificar o referred_by
    CLI.userRoleMap = {};
    users.forEach(u => { CLI.userRoleMap[u.id] = u.role; });

    // Filtra apenas clientes, ordena por criação (mais antigo primeiro)
    CLI.allClientes = users
      .filter(u => u.role === 'cliente')
      .sort((a, b) => (a.created_at || 0) - (b.created_at || 0));

    // ── Calcula clientes ativos no último mês ─────────────────────────
    // Limite: 30 dias atrás (em ms)
    const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    // Ativações confirmadas do último mês — allowlist: apenas status='active'
    const recentActs = acts.filter(a =>
      isConfirmedAct(a) &&
      (a.created_at || 0) >= monthAgo
    );

    // Conjunto de user_ids únicos que ativaram no período
    CLI.activeLastMonth = new Set(recentActs.map(a => a.user_id).filter(Boolean));

    _renderClientes();
    setText('cli-updated', new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' }));

    // ── Ranking de ativações — allowlist: apenas status='active'
    const activeActs = acts.filter(isConfirmedAct);
    renderClientsActsTable(CLI.allClientes, activeActs, earnings);

  } catch (e) {
    console.error('[Clientes]', e);
    showAdminToast('Erro ao carregar dados de clientes.', 'error');
  } finally {
    if (btn) btn.classList.remove('spinning');
  }
}

/* Classifica um cliente em uma das 3 origens */
function _cliOrigin(u) {
  if (!u.referred_by) return 'organic';
  const inviterRole = CLI.userRoleMap[u.referred_by];
  if (inviterRole === 'promoter') return 'promoter';
  if (inviterRole === 'cliente')  return 'client';
  return 'organic'; // referred_by existe mas usuário não encontrado / outro role
}

/* Troca granularidade e re-renderiza só o gráfico */
function setCliGranularity(gran, el) {
  CLI.granularity = gran;
  document.querySelectorAll('.cli-gran-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  if (CLI.allClientes.length) _renderCliChart(CLI.allClientes);
}

function setQualityGranularity(gran, el) {
  CLI.qualityGranularity = gran;
  // Desativa apenas os botões do painel de qualidade
  document.getElementById('quality-gran-week')?.classList.remove('active');
  document.getElementById('quality-gran-month')?.classList.remove('active');
  if (el) el.classList.add('active');
  if (CLI.allClientes.length) _renderCliQuality(CLI.allClientes, CLI.acts || []);
}

function _renderClientes() {
  const clientes = CLI.allClientes;

  // ── KPIs ──────────────────────────────────────────────────────────
  let byPromoter = 0, byClient = 0, organic = 0;
  clientes.forEach(u => {
    const o = _cliOrigin(u);
    if (o === 'promoter') byPromoter++;
    else if (o === 'client') byClient++;
    else organic++;
  });

  setText('cli-total',       clientes.length.toLocaleString('pt-BR'));
  setText('cli-by-promoter', byPromoter.toLocaleString('pt-BR'));
  setText('cli-by-client',   byClient.toLocaleString('pt-BR'));
  setText('cli-organic',     organic.toLocaleString('pt-BR'));

  // ── KPI: clientes ativos no último mês ────────────────────────────
  const activeSet    = CLI.activeLastMonth || new Set();
  // Conta apenas clientes (filtra o Set pelo array de clientes)
  const clienteIds   = new Set(clientes.map(u => u.id));
  const activeCount  = [...activeSet].filter(id => clienteIds.has(id)).length;
  const activePct    = clientes.length > 0 ? Math.round(activeCount / clientes.length * 100) : 0;
  setText('cli-active-month', activeCount.toLocaleString('pt-BR'));
  setText('cli-active-pct',   `${activePct}% do total`);


  // ── KPI: churn mensal (modelo final)
  //
  //   NUMERADOR — clientes que cruzaram 60 dias de inatividade no mês:
  //     • última ativação válida caiu entre ago90 e ago60
  //       (completaram exatamente 60 dias de inatividade neste mês)
  //     • cadastrado há pelo menos 60 dias (evita novos)
  //     • já tinham ativado ao menos uma vez (garantido por estar no lastActMap)
  //
  //   DENOMINADOR — base ativa 60 dias atrás:
  //     • tinham ativado pelo menos 1 vez
  //     • estavam dentro da janela de atividade ≤60 dias sem uso naquele momento,
  //       ou seja, última ativação em [ago120, ago60)
  //
  //   Churn = numerador / denominador
  const now    = Date.now();
  const DAY    = 24 * 60 * 60 * 1000;
  const ago60  = now  - 60  * DAY;   // corte principal
  const ago90  = now  - 90  * DAY;   // ago60 − 30d  → janela do numerador
  const ago120 = now  - 120 * DAY;   // ago60 − 60d  → limite inferior do denominador

  const actsC    = CLI.acts || [];
  // Allowlist: apenas status='active' (pagamento confirmado)
  const validAct = isConfirmedAct;

  // Mapa: user_id → data de cadastro
  const signupMap = new Map(clientes.map(u => [u.id, u.created_at || 0]));

  // Mapa: user_id → timestamp da ÚLTIMA ativação válida
  const lastActMap = new Map();
  actsC.filter(validAct).forEach(a => {
    const ts = a.created_at || 0;
    if (!clienteIds.has(a.user_id)) return;
    if ((lastActMap.get(a.user_id) || 0) < ts) lastActMap.set(a.user_id, ts);
  });

  // DENOMINADOR: ativos 60 dias atrás
  //   → última ativação em [ago120, ago60): tinham ativado e estavam ≤60 dias sem uso
  const baseActive = [...lastActMap.entries()]
    .filter(([, ts]) => ts >= ago120 && ts < ago60);

  // NUMERADOR: cruzaram 60 dias de inatividade neste mês
  //   → última ativação em [ago90, ago60) + cadastrado há 60+ dias
  const churnedThisMonth = baseActive.filter(([uid, ts]) => {
    if (ts < ago90) return false;                   // última ativação > 90 dias atrás: já era churn antes
    const signup = signupMap.get(uid) || 0;
    return signup <= ago60;                          // tem pelo menos 60 dias de vida
  });

  const churnBase  = baseActive.length;
  const churnCount = churnedThisMonth.length;
  const churnPct   = churnBase > 0 ? Math.round(churnCount / churnBase * 100) : 0;

  setText('cli-churn-pct', churnBase > 0 ? `${churnPct}%` : '—');
  setText('cli-churn-sub', churnBase > 0
    ? `${churnCount} clientes churned (base: ${churnBase} ativos há 60 dias)`
    : 'Sem dados suficientes');

  // ── KPI: retenção
  //   Numerador:   clientes com ≥2 ativações válidas E última ativação ≤ 60 dias atrás
  //   Denominador: clientes com ≥1 ativação válida
  const retNow   = Date.now();
  const retAgo60 = retNow - 60 * DAY;

  // Contagem de ativações válidas por cliente
  const actCountMap = new Map(); // user_id → { count, lastTs }
  actsC.filter(validAct).forEach(a => {
    if (!clienteIds.has(a.user_id)) return;
    const ts  = a.created_at || 0;
    const cur = actCountMap.get(a.user_id) || { count: 0, lastTs: 0 };
    cur.count++;
    if (ts > cur.lastTs) cur.lastTs = ts;
    actCountMap.set(a.user_id, cur);
  });

  // Denominador: clientes com ≥1 ativação
  const withAny = [...actCountMap.values()].filter(v => v.count >= 1).length;

  // Numerador: clientes com ≥2 ativações E última ativação nos últimos 60 dias
  const retained = [...actCountMap.values()]
    .filter(v => v.count >= 2 && v.lastTs >= retAgo60).length;

  const retPct = withAny > 0 ? Math.round(retained / withAny * 100) : 0;
  setText('cli-retention-pct', withAny > 0 ? `${retPct}%` : '—');
  setText('cli-retention-sub', withAny > 0
    ? `${retained} retidos de ${withAny} com ≥1 ativação`
    : 'Sem dados');

  // ── KPI: LTV (clientes ativos)
  //   "Ativo" = ≥1 ativação válida e última ativação ≤ 60 dias atrás
  //
  //   ticket médio     = receita paga dos ativos ÷ ativações pagas dos ativos
  //   ativações/usuário= total de ativações válidas dos ativos ÷ qtd de ativos
  //   tempo médio      = média(dias desde cadastro) ÷ 30  → em meses
  //   LTV              = ticket médio × (ativações totais ÷ ativos) × tempo médio em meses
  const ltvAgo60 = now - 60 * DAY;

  // IDs dos clientes ativos (≥1 ativ. válida + última ≤ 60 dias)
  const activeClientIds = new Set(
    [...actCountMap.entries()]
      .filter(([, v]) => v.lastTs >= ltvAgo60)
      .map(([uid]) => uid)
  );

  if (activeClientIds.size > 0) {
    // Ativações válidas restritas aos clientes ativos
    const activeCliActs = actsC.filter(a => validAct(a) && activeClientIds.has(a.user_id));

    // Ticket médio: apenas ativações com amount > 0
    const paidActiveActs   = activeCliActs.filter(a => (a.amount || 0) > 0);
    const totalRevActive   = paidActiveActs.reduce((s, a) => s + (a.amount || 0), 0);
    const ticketMedio      = paidActiveActs.length > 0
      ? totalRevActive / paidActiveActs.length : 0;

    // Nº médio de ativações por usuário
    const avgActs = activeCliActs.length / activeClientIds.size;

    // Tempo médio na plataforma (em meses)
    const activeClientes = clientes.filter(u => activeClientIds.has(u.id));
    const totalDays      = activeClientes.reduce((s, u) => {
      const dias = (now - (u.created_at || now)) / DAY;
      return s + dias;
    }, 0);
    const avgMonths = (totalDays / activeClientes.length) / 30;

    const ltv = ticketMedio * avgActs * avgMonths;

    setText('cli-ltv', ltv > 0 ? fmtBRL(ltv) : '—');
    setText('cli-ltv-sub',
      `${activeClientIds.size} ativos · ticket R$${ticketMedio.toFixed(2).replace('.',',')} · `
      + `${avgActs.toFixed(1).replace('.',',')} ativ./usu. · `
      + `${avgMonths.toFixed(1).replace('.',',')} meses`
    );
  } else {
    setText('cli-ltv', '—');
    setText('cli-ltv-sub', 'Sem clientes ativos nos últimos 60 dias');
  }

  // ── Gráfico ───────────────────────────────────────────────────────
  _renderCliChart(clientes);

  // ── Qualidade dos novos clientes ──────────────────────────────────
  _renderCliQuality(clientes, actsC);

  // ── Análise de perfil ─────────────────────────────────────────────
  _renderCliProfile(clientes);

  // ── Tabela de últimos cadastros (paginada) ────────────────────────
  CLI.recentRows  = [...clientes].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  CLI.recentShown = 0;
  const tbody = document.getElementById('tbody-cli-recent');
  if (tbody) tbody.innerHTML = '';
  _cliRecentAppend(15);
}

/* ── Análise de perfil: gênero e faixa etária ── */
function _renderCliProfile(clientes) {
  const total = clientes.length;
  if (!total) return;

  setText('cli-profile-sub', `${total} clientes analisados`);

  /* ── GÊNERO ────────────────────────────────────────────────────── */
  const genderMap = { masculino: 0, feminino: 0, nao_binario: 0, outro: 0, prefiro_nao_dizer: 0, '': 0 };
  clientes.forEach(u => {
    const g = (u.gender || '').toLowerCase().trim();
    if      (g === 'masculino')        genderMap.masculino++;
    else if (g === 'feminino')         genderMap.feminino++;
    else if (g === 'nao_binario')      genderMap.nao_binario++;
    else if (g === 'outro')            genderMap.outro++;
    else if (g === 'prefiro_nao_dizer') genderMap.prefiro_nao_dizer++;
    else                               genderMap['']++;
  });

  const genderItems = [
    { label: 'Masculino',          count: genderMap.masculino,        color: '#60a5fa', icon: 'fa-mars'           },
    { label: 'Feminino',           count: genderMap.feminino,         color: '#f472b6', icon: 'fa-venus'          },
    { label: 'Não-binário',        count: genderMap.nao_binario,      color: '#34d399', icon: 'fa-transgender-alt'},
    { label: 'Outro',              count: genderMap.outro,            color: '#a78bfa', icon: 'fa-genderless'     },
    { label: 'Prefiro não dizer',  count: genderMap.prefiro_nao_dizer,color: '#6b7280', icon: 'fa-minus-circle'   },
    { label: 'Não informado',      count: genderMap[''],              color: '#4b5563', icon: 'fa-question-circle'},
  ].filter(g => g.count > 0);

  const genderEl = document.getElementById('cli-gender-bars');
  if (genderEl) {
    genderEl.innerHTML = genderItems.map(g => {
      const pct = Math.round(g.count / total * 100);
      return `
        <div class="cli-bar-row">
          <div class="cli-bar-label">
            <i class="fa ${g.icon}" style="color:${g.color};width:14px;text-align:center"></i>
            <span>${g.label}</span>
          </div>
          <div class="cli-bar-track">
            <div class="cli-bar-fill" style="width:${pct}%;background:${g.color}"></div>
          </div>
          <div class="cli-bar-values">
            <span class="cli-bar-pct" style="color:${g.color}">${pct}%</span>
            <span class="cli-bar-abs">${g.count}</span>
          </div>
        </div>`;
    }).join('');
  }

  /* ── FAIXA ETÁRIA ──────────────────────────────────────────────── */
  const ageBuckets = [
    { label: '18–24', min: 18, max: 24,  color: '#34d399' },
    { label: '25–34', min: 25, max: 34,  color: '#60a5fa' },
    { label: '35–44', min: 35, max: 44,  color: '#f472b6' },
    { label: '45+',   min: 45, max: 999, color: '#fbbf24' },
    { label: 'Não informado', min: -1, max: -1, color: '#4b5563' },
  ];
  ageBuckets.forEach(b => { b.count = 0; });

  const thisYear = new Date().getFullYear();
  clientes.forEach(u => {
    if (!u.birth_date) {
      ageBuckets[ageBuckets.length - 1].count++;
      return;
    }
    const year = parseInt((u.birth_date || '').split('-')[0], 10);
    if (!year || isNaN(year)) { ageBuckets[ageBuckets.length - 1].count++; return; }
    const age = thisYear - year;
    const bucket = ageBuckets.find(b => b.min >= 0 && age >= b.min && age <= b.max);
    if (bucket) bucket.count++;
    else ageBuckets[ageBuckets.length - 1].count++;
  });

  const ageEl = document.getElementById('cli-age-bars');
  if (ageEl) {
    ageEl.innerHTML = ageBuckets.filter(b => b.count > 0).map(b => {
      const pct = Math.round(b.count / total * 100);
      return `
        <div class="cli-bar-row">
          <div class="cli-bar-label">
            <span class="cli-age-dot" style="background:${b.color}"></span>
            <span>${b.label}</span>
          </div>
          <div class="cli-bar-track">
            <div class="cli-bar-fill" style="width:${pct}%;background:${b.color}"></div>
          </div>
          <div class="cli-bar-values">
            <span class="cli-bar-pct" style="color:${b.color}">${pct}%</span>
            <span class="cli-bar-abs">${b.count}</span>
          </div>
        </div>`;
    }).join('');
  }
}

/* Adiciona `count` linhas de cadastros recentes a partir do índice atual */
function _cliRecentAppend(count) {
  const tbody   = document.getElementById('tbody-cli-recent');
  const footer  = document.getElementById('cli-recent-footer');
  const countEl = document.getElementById('cli-recent-count');
  const subEl   = document.getElementById('cli-recent-sub');
  const btnMore = document.getElementById('btn-cli-recent-more');
  if (!tbody) return;

  const rows = CLI.recentRows || [];

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="bk-td-empty">Nenhum cliente cadastrado ainda.</td></tr>';
    if (footer) footer.style.display = 'none';
    return;
  }

  const originBadge = {
    promoter: `<span class="cli-origin-badge cli-origin-promoter"><i class="fa fa-star"></i> Promoter</span>`,
    client:   `<span class="cli-origin-badge cli-origin-client"><i class="fa fa-user-friends"></i> Cliente</span>`,
    organic:  `<span class="cli-origin-badge cli-origin-organic"><i class="fa fa-globe"></i> Orgânico</span>`,
  };

  // Mapa user_id → contagem de ativações confirmadas (status='active', sem tipos internos)
  // Construído a partir de CLI.acts para não depender do campo denormalizado activations_count
  const confirmedActMap = new Map();
  (CLI.acts || []).filter(isConfirmedAct).forEach(a => {
    if (!a.user_id) return;
    confirmedActMap.set(a.user_id, (confirmedActMap.get(a.user_id) || 0) + 1);
  });

  const slice = rows.slice(CLI.recentShown, CLI.recentShown + count);
  slice.forEach(u => {
    const origin  = _cliOrigin(u);
    const dateStr = u.created_at
      ? new Date(u.created_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' })
      : '—';
    const actCount = confirmedActMap.get(u.id) || 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight:600">${escHtml(u.name || '—')}</td>
      <td style="color:var(--text2);font-size:12px">${escHtml(u.email || '—')}</td>
      <td style="text-align:center">${originBadge[origin]}</td>
      <td style="text-align:center;color:var(--text2);font-size:12px">${dateStr}</td>
      <td style="text-align:center;font-weight:700;color:#60a5fa">${actCount}</td>`;
    tbody.appendChild(tr);
  });

  CLI.recentShown += slice.length;

  // Atualiza rodapé
  const total     = rows.length;
  const remaining = total - CLI.recentShown;
  if (footer) {
    footer.style.display = 'flex';
    if (countEl) countEl.textContent = `Exibindo ${CLI.recentShown} de ${total} clientes`;
    if (subEl)   subEl.textContent   = `${total} cadastros`;
    if (btnMore) {
      if (remaining > 0) {
        btnMore.style.display = 'inline-flex';
        btnMore.innerHTML     = `<i class="fa fa-plus" style="margin-right:5px"></i> Mostrar mais ${Math.min(remaining, 30)}`;
      } else {
        btnMore.style.display = 'none';
      }
    }
  }
}

/* Chamado pelo botão "Mostrar mais 30" dos últimos cadastros */
function cliRecentLoadMore() {
  _cliRecentAppend(30);
}

function _renderCliChart(clientes) {
  const ctx = document.getElementById('chart-cli-growth');
  if (!ctx) return;

  // ── Gera os períodos (semanas ou meses) cobertos pelos dados ──────
  // Vai da data do cliente mais antigo até hoje
  const now = new Date();
  const gran = CLI.granularity;

  // Função que retorna a chave do período para uma data
  function periodKey(ts) {
    const d = new Date(ts);
    if (gran === 'month') {
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    }
    // Semana: segunda-feira como início
    const day  = d.getDay(); // 0=dom
    const diff = (day === 0) ? -6 : 1 - day;
    const mon  = new Date(d);
    mon.setDate(d.getDate() + diff);
    return mon.toISOString().slice(0, 10);
  }

  // Descobre o período mais antigo
  const oldest = clientes.length > 0 ? clientes[0].created_at : now.getTime();
  const startKey = periodKey(oldest);

  // Gera todos os períodos entre startKey e hoje
  const periods = [];
  const cursor  = new Date(gran === 'month'
    ? startKey + '-01'
    : startKey);

  while (cursor <= now) {
    periods.push(periodKey(cursor.getTime()));
    if (gran === 'month') {
      cursor.setMonth(cursor.getMonth() + 1);
    } else {
      cursor.setDate(cursor.getDate() + 7);
    }
  }
  // Garante que o período atual esteja incluído
  const todayKey = periodKey(now.getTime());
  if (!periods.includes(todayKey)) periods.push(todayKey);

  // Remove duplicatas e ordena
  const uniquePeriods = [...new Set(periods)].sort();

  // ── Conta cadastros por período e origem ─────────────────────────
  const counts = { promoter: {}, client: {}, organic: {} };
  uniquePeriods.forEach(p => {
    counts.promoter[p] = 0;
    counts.client[p]   = 0;
    counts.organic[p]  = 0;
  });

  clientes.forEach(u => {
    if (!u.created_at) return;
    const p = periodKey(u.created_at);
    if (!counts.promoter[p]) { counts.promoter[p] = 0; counts.client[p] = 0; counts.organic[p] = 0; }
    const o = _cliOrigin(u);
    counts[o][p]++;
  });

  // ── Labels legíveis ───────────────────────────────────────────────
  const labels = uniquePeriods.map(p => {
    if (gran === 'month') {
      const [y, m] = p.split('-');
      const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
      return `${months[parseInt(m)-1]}/${y.slice(2)}`;
    }
    // Semana: mostra "dd/mm"
    const [, mm, dd] = p.split('-');
    return `${dd}/${mm}`;
  });

  // ── Destrói gráfico anterior e cria novo ─────────────────────────
  if (CLI.chart) { CLI.chart.destroy(); CLI.chart = null; }

  CLI.chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label:            'Convidados por promoter',
          data:             uniquePeriods.map(p => counts.promoter[p] || 0),
          borderColor:      '#c084fc',
          backgroundColor:  'rgba(192,132,252,.12)',
          borderWidth: 2.5, fill: true, tension: 0.4,
          pointBackgroundColor: '#c084fc', pointRadius: 4, pointHoverRadius: 6,
        },
        {
          label:            'Convidados por cliente',
          data:             uniquePeriods.map(p => counts.client[p] || 0),
          borderColor:      '#60a5fa',
          backgroundColor:  'rgba(96,165,250,.10)',
          borderWidth: 2.5, fill: true, tension: 0.4,
          pointBackgroundColor: '#60a5fa', pointRadius: 4, pointHoverRadius: 6,
        },
        {
          label:            'Sem convite',
          data:             uniquePeriods.map(p => counts.organic[p] || 0),
          borderColor:      '#6b7280',
          backgroundColor:  'rgba(107,114,128,.08)',
          borderWidth: 2,   fill: true, tension: 0.4,
          pointBackgroundColor: '#6b7280', pointRadius: 3, pointHoverRadius: 5,
          borderDash: [5, 3],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false }, // usamos legenda manual no HTML
        tooltip: {
          backgroundColor: '#1a1a24',
          borderColor:     'rgba(255,255,255,.1)',
          borderWidth:     1,
          titleColor:      '#e8e8f0',
          bodyColor:       '#8888aa',
          padding:         12,
          callbacks: {
            title: items => `Período: ${items[0].label}`,
            label: item  => ` ${item.dataset.label}: ${item.parsed.y} novos`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#8888aa', font: { size: 11 }, maxRotation: 45 },
          grid:  { color: 'rgba(255,255,255,.04)' },
        },
        y: {
          ticks: { color: '#8888aa', font: { size: 11 }, stepSize: 1 },
          grid:  { color: 'rgba(255,255,255,.04)' },
          beginAtZero: true,
        },
      },
    },
  });
}

/* ── Gráfico de Qualidade: Taxa de Adeptos por coorte de cadastro ── */
function _renderCliQuality(clientes, acts) {
  const ctx = document.getElementById('chart-cli-quality');
  if (!ctx) return;

  const gran     = CLI.qualityGranularity || 'month';
  const DAY_MS   = 24 * 60 * 60 * 1000;
  const now      = new Date();
  const nowTs    = now.getTime();
  const cutoff30 = nowTs - 30 * DAY_MS; // coortes mais recentes que isto são "maturando"

  // Allowlist: apenas status='active' (pagamento confirmado)
  // night_checkin excluído via ACT_INTERNAL_TYPES dentro de isConfirmedAct
  const validAct = isConfirmedAct;

  // Mapa: user_id → nº de ativações válidas
  const actCountMap = new Map();
  acts.filter(validAct).forEach(a => {
    if (!a.user_id) return;
    actCountMap.set(a.user_id, (actCountMap.get(a.user_id) || 0) + 1);
  });

  // Função: data → chave do período
  function periodKey(ts) {
    const d = new Date(ts);
    if (gran === 'month') {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    // Semana: segunda-feira da semana
    const day  = d.getDay(); // 0=dom
    const diff = (day === 0 ? -6 : 1 - day);
    const mon  = new Date(d);
    mon.setDate(d.getDate() + diff);
    mon.setHours(0, 0, 0, 0);
    return `${mon.getFullYear()}-${String(mon.getMonth()+1).padStart(2,'0')}-${String(mon.getDate()).padStart(2,'0')}`;
  }

  // Função: chave → timestamp de início do período
  function periodStart(key) {
    if (gran === 'month') {
      const [y, m] = key.split('-');
      return new Date(parseInt(y), parseInt(m) - 1, 1).getTime();
    }
    return new Date(key).getTime();
  }

  // Agrupa clientes por período de cadastro
  const cohorts = new Map(); // key → { total, adeptos }
  clientes.forEach(u => {
    if (!u.created_at) return;
    const key  = periodKey(u.created_at);
    const cur  = cohorts.get(key) || { total: 0, adeptos: 0 };
    cur.total++;
    if ((actCountMap.get(u.id) || 0) >= 1) cur.adeptos++;
    cohorts.set(key, cur);
  });

  if (cohorts.size === 0) {
    if (CLI.qualityChart) { CLI.qualityChart.destroy(); CLI.qualityChart = null; }
    return;
  }

  // Ordena períodos cronologicamente
  const sortedKeys = [...cohorts.keys()].sort();

  // Monta labels legíveis
  const labels = sortedKeys.map(k => {
    if (gran === 'month') {
      const [y, m] = k.split('-');
      const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
      return `${months[parseInt(m)-1]}/${y.slice(2)}`;
    }
    const [, mm, dd] = k.split('-');
    return `${dd}/${mm}`;
  });

  // Separa dados maduros vs maturando (últimos 30 dias)
  const dataMature   = [];
  const dataMaturing = [];

  sortedKeys.forEach(k => {
    const { total, adeptos } = cohorts.get(k);
    const pct = total > 0 ? parseFloat((adeptos / total * 100).toFixed(1)) : null;
    const start = periodStart(k);
    if (start >= cutoff30) {
      // Coorte ainda maturando
      dataMature.push(null);
      dataMaturing.push(pct);
    } else {
      dataMature.push(pct);
      dataMaturing.push(null);
    }
  });

  // Conecta o último ponto maduro ao primeiro ponto maturando (linha contínua)
  const lastMatureIdx = dataMature.reduce((acc, v, i) => v !== null ? i : acc, -1);
  if (lastMatureIdx >= 0 && lastMatureIdx + 1 < dataMaturing.length && dataMaturing[lastMatureIdx + 1] !== null) {
    dataMature[lastMatureIdx + 1] = dataMaturing[lastMatureIdx + 1];
  }

  if (CLI.qualityChart) { CLI.qualityChart.destroy(); CLI.qualityChart = null; }

  CLI.qualityChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label:           'Taxa de adeptos (madura)',
          data:             dataMature,
          borderColor:      '#4ade80',
          backgroundColor:  'rgba(74,222,128,.12)',
          borderWidth:      2.5,
          fill:             true,
          tension:          0.4,
          spanGaps:         false,
          pointBackgroundColor: '#4ade80',
          pointRadius:      4,
          pointHoverRadius: 6,
        },
        {
          label:           'Últimos 30 dias (maturando)',
          data:             dataMaturing,
          borderColor:      'rgba(74,222,128,.45)',
          backgroundColor:  'rgba(74,222,128,.05)',
          borderWidth:      2,
          borderDash:       [6, 4],
          fill:             true,
          tension:          0.4,
          spanGaps:         false,
          pointBackgroundColor: 'rgba(74,222,128,.5)',
          pointRadius:      4,
          pointHoverRadius: 6,
        },
      ],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1a24',
          borderColor:     'rgba(255,255,255,.1)',
          borderWidth:     1,
          titleColor:      '#e8e8f0',
          bodyColor:       '#8888aa',
          padding:         12,
          callbacks: {
            title: items => `Coorte: ${items[0].label}`,
            label: item => {
              if (item.parsed.y === null) return null;
              const key    = sortedKeys[item.dataIndex];
              const cohort = cohorts.get(key) || {};
              const maturando = periodStart(key) >= cutoff30 ? ' (maturando)' : '';
              return ` ${item.parsed.y}% adeptos — ${cohort.adeptos || 0} de ${cohort.total || 0}${maturando}`;
            },
            filter: item => item.parsed.y !== null,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#8888aa', font: { size: 11 }, maxRotation: 45 },
          grid:  { color: 'rgba(255,255,255,.04)' },
        },
        y: {
          min:   0,
          max:   100,
          ticks: {
            color: '#8888aa',
            font:  { size: 11 },
            callback: v => `${v}%`,
          },
          grid: { color: 'rgba(255,255,255,.04)' },
        },
      },
    },
  });
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// Abre/fecha o painel explicativo do KPI (botão ⓘ dentro de card ou painel)
function toggleKpiInfo(btn) {
  const container = btn.closest('.bk-stat-card') || btn.closest('.bk-panel') || btn.closest('.bk-panel-hd');
  const panel = container?.querySelector('.kpi-info-panel');
  if (!panel) return;
  panel.classList.toggle('open');
  btn.style.background = panel.classList.contains('open')
    ? 'rgba(136,136,170,.5)' : '';
  btn.style.color = panel.classList.contains('open') ? '#fff' : '';
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let _toastTimer;
function showAdminToast(msg, type = '') {
  const t = document.getElementById('admin-toast');
  if (!t) return;
  t.textContent = msg;
  t.className   = `toast ${type} show`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { t.className = 'toast'; }, 3200);
}
