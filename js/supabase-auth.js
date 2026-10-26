/* ====================================================
   OZ APP — Supabase Auth Layer
   Centraliza signup, login, logout e persistência de sessão
   ==================================================== */

'use strict';

/* ── Configuração ── */
const SUPA_URL   = 'https://qyxefytxyrmvotjnhoir.supabase.co';
const SUPA_ANON  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5eGVmeXR4eXJtdm90am5ob2lyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3Mjk4NzQsImV4cCI6MjA5MjMwNTg3NH0.6TSq1HjRyS9D2lBGvrjLT0oTPT-QT752DgdBbHrltq8';

/* ──────────────────────────────────────────────────────
   AUTH CLIENT — chamadas diretas à API de Auth do Supabase
   (não depende do SDK supabase-js, apenas fetch nativo)
────────────────────────────────────────────────────── */
const SupaAuth = (() => {

  const AUTH_URL   = `${SUPA_URL}/auth/v1`;
  const BASE_HEADS = {
    'Content-Type': 'application/json',
    'apikey':        SUPA_ANON,
  };

  /* Chave de armazenamento da sessão */
  const SESSION_KEY = 'oz_supabase_session';

  /* ── Estado interno ── */
  let _session = null; // { access_token, refresh_token, expires_at, user }

  /* ── Persistência ── */
  function _saveSession(session) {
    _session = session;
    if (session) {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
  }

  function _loadSession() {
    if (_session) return _session;
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) { _session = JSON.parse(raw); }
    } catch (_) { _session = null; }
    return _session;
  }

  /* ── Helper: resposta ── */
  async function _handleAuthResp(res) {
    const body = await res.json();
    if (!res.ok) {
      const msg = body?.error_description || body?.msg || body?.message || `Erro ${res.status}`;
      throw new Error(msg);
    }
    return body;
  }

  /* ── Headers autenticados (com token de acesso) ── */
  function _authHeaders() {
    const token = _session?.access_token || SUPA_ANON;
    return {
      ...BASE_HEADS,
      'Authorization': `Bearer ${token}`,
    };
  }

  /* ── REFRESH TOKEN ── */
  async function refreshSession() {
    const sess = _loadSession();
    if (!sess?.refresh_token) return null;
    try {
      const res = await fetch(`${AUTH_URL}/token?grant_type=refresh_token`, {
        method:  'POST',
        headers: BASE_HEADS,
        body:    JSON.stringify({ refresh_token: sess.refresh_token }),
      });
      const body = await _handleAuthResp(res);
      const newSession = {
        access_token:  body.access_token,
        refresh_token: body.refresh_token,
        expires_at:    Date.now() + (body.expires_in || 3600) * 1000,
        user:          body.user,
      };
      _saveSession(newSession);
      return newSession;
    } catch (err) {
      console.warn('[SupaAuth] Falha ao renovar sessão:', err.message);
      _saveSession(null);
      return null;
    }
  }

  /* ── SIGNUP ──
     Cria usuário no Auth e retorna { user, session }
     O registro na tabela "users" deve ser feito pelo chamador
     com o id = authUser.id para manter FK consistente.         */
  async function signUp(email, password) {
    const res = await fetch(`${AUTH_URL}/signup`, {
      method:  'POST',
      headers: BASE_HEADS,
      body:    JSON.stringify({ email, password }),
    });
    const body = await _handleAuthResp(res);

    // Supabase retorna session + user dentro do body de signup
    const session = body.access_token
      ? {
          access_token:  body.access_token,
          refresh_token: body.refresh_token,
          expires_at:    Date.now() + (body.expires_in || 3600) * 1000,
          user:          body.user,
        }
      : null;

    _saveSession(session);
    return { user: body.user, session };
  }

  /* ── LOGIN ── */
  async function signIn(email, password) {
    const res = await fetch(`${AUTH_URL}/token?grant_type=password`, {
      method:  'POST',
      headers: BASE_HEADS,
      body:    JSON.stringify({ email, password }),
    });
    const body = await _handleAuthResp(res);

    const session = {
      access_token:  body.access_token,
      refresh_token: body.refresh_token,
      expires_at:    Date.now() + (body.expires_in || 3600) * 1000,
      user:          body.user,
    };
    _saveSession(session);
    return { user: body.user, session };
  }

  /* ── LOGOUT ── */
  async function signOut() {
    try {
      await fetch(`${AUTH_URL}/logout`, {
        method:  'POST',
        headers: _authHeaders(),
      });
    } catch (_) { /* ignora erro de rede no logout */ }
    _saveSession(null);
  }

  /* ── OBTER USUÁRIO ATUAL (Auth) ── */
  async function getUser() {
    const sess = await getSession();
    return sess?.user || null;
  }

  /* ── OBTER SESSÃO ATUAL (verifica expiração e renova se necessário) ── */
  async function getSession() {
    const sess = _loadSession();
    if (!sess) return null;

    /* Se expira em menos de 60 s, tenta renovar */
    const expiresAt = sess.expires_at || 0;
    if (Date.now() > expiresAt - 60_000) {
      return await refreshSession();
    }
    return sess;
  }

  /* ── VERIFICAR SE ESTÁ LOGADO ── */
  async function isLoggedIn() {
    const sess = await getSession();
    return !!sess?.access_token;
  }

  /* ── ACCESS TOKEN ATUAL (para uso nas requisições REST) ── */
  async function getAccessToken() {
    const sess = await getSession();
    return sess?.access_token || SUPA_ANON;
  }

  /* ── RESET DE SENHA — envia e-mail de recuperação ── */
  async function resetPassword(email) {
    const res = await fetch(`${AUTH_URL}/recover`, {
      method:  'POST',
      headers: BASE_HEADS,
      body:    JSON.stringify({ email }),
    });
    // Supabase retorna 200 mesmo para e-mails inexistentes (evita enumeração)
    // Só lança erro em caso de falha real (rede, config)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg  = body?.error_description || body?.msg || `Erro ${res.status}`;
      throw new Error(msg);
    }
  }

  /* ── CAPTURA SESSÃO DO HASH DA URL (formato implícito) ──
     O Supabase redireciona com:
       #access_token=xxx&refresh_token=yyy&type=recovery
     Esta função lê o hash, monta e salva a sessão internamente,
     e retorna { type, session } para o chamador decidir o que fazer.  */
  function setSessionFromHash() {
    const hash = window.location.hash.slice(1); // remove o '#'
    if (!hash) return null;

    const params       = new URLSearchParams(hash);
    const accessToken  = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const expiresIn    = parseInt(params.get('expires_in') || '3600', 10);
    const type         = params.get('type'); // 'recovery' | 'signup' | 'magiclink'

    if (!accessToken) return null;

    const session = {
      access_token:  accessToken,
      refresh_token: refreshToken || '',
      expires_at:    Date.now() + expiresIn * 1000,
      user:          null, // será preenchido por getUser() se necessário
    };

    _saveSession(session);

    // Limpa o hash da URL sem recarregar a página
    window.history.replaceState(null, '', window.location.pathname + window.location.search);

    return { type, session };
  }

  /* ── TROCA CÓDIGO PKCE POR SESSÃO (formato mais novo) ──
     Quando o Supabase usa PKCE, o link chega com ?code=xxx
     Esta função troca o code por tokens de sessão.             */
  async function exchangeCodeForSession(code) {
    const res = await fetch(`${AUTH_URL}/token?grant_type=pkce`, {
      method:  'POST',
      headers: BASE_HEADS,
      body:    JSON.stringify({ auth_code: code }),
    });
    const body = await _handleAuthResp(res);

    const session = {
      access_token:  body.access_token,
      refresh_token: body.refresh_token,
      expires_at:    Date.now() + (body.expires_in || 3600) * 1000,
      user:          body.user,
    };
    _saveSession(session);

    // Remove o ?code da URL sem recarregar
    window.history.replaceState(null, '', window.location.pathname);

    return { type: 'recovery', session };
  }

  /* ── ATUALIZAR SENHA (requer sessão de recovery ativa) ── */
  async function updatePassword(newPassword) {
    const sess = _loadSession();
    if (!sess?.access_token) throw new Error('Sessão de recuperação não encontrada. Solicite um novo link.');

    const res = await fetch(`${AUTH_URL}/user`, {
      method:  'PUT',
      headers: {
        ...BASE_HEADS,
        'Authorization': `Bearer ${sess.access_token}`,
      },
      body: JSON.stringify({ password: newPassword }),
    });
    const body = await _handleAuthResp(res);

    // Após trocar a senha, encerra a sessão de recovery
    // O usuário deverá fazer login normalmente
    _saveSession(null);

    return body;
  }

  /* ── EXPOR API PÚBLICA ── */
  return {
    signUp,
    signIn,
    signOut,
    getUser,
    getSession,
    isLoggedIn,
    getAccessToken,
    refreshSession,
    resetPassword,
    setSessionFromHash,
    exchangeCodeForSession,
    updatePassword,
  };
})();
