/* ═══════════════════════════════════════════
   OZ PITCH — Login & Navigation
═══════════════════════════════════════════ */

// ── Senha de acesso (altere aqui) ──────────
const PITCH_PASSWORD = 'oz2025inv';

// ── Estrutura de navegação ─────────────────
const NAV = [
  { group: 'Visão Geral', items: [
    { id: 's01', num: '01', label: 'Proposta de Valor' },
    { id: 's02', num: '02', label: 'O Problema' },
    { id: 's03', num: '03', label: 'A Solução' },
  ]},
  { group: 'Produto', items: [
    { id: 's04', num: '04', label: 'Como Funciona' },
    { id: 's05', num: '05', label: 'Perfis & Ecossistema' },
    { id: 's06', num: '06', label: 'Tração & Métricas' },
  ]},
  { group: 'Negócio', items: [
    { id: 's07', num: '07', label: 'Modelo de Receita' },
    { id: 's08', num: '08', label: 'Mercado & TAM' },
    { id: 's09', num: '09', label: 'Competidores' },
    { id: 's10', num: '10', label: 'Projeções' },
    { id: 's11', num: '11', label: 'Roadmap' },
  ]},
  { group: 'Investimento — NDA', items: [
    { id: 's12', num: '12', label: 'Captação & Uso', lock: true },
    { id: 's13', num: '13', label: 'Equipe', lock: true },
    { id: 's14', num: '14', label: 'Contato & Next Steps', lock: true },
  ]},
];

let currentSlide = 's01';

// ── Helpers ────────────────────────────────
function allSlideIds() {
  return NAV.flatMap(g => g.items.map(i => i.id));
}

// ── BUILD NAV ──────────────────────────────
function buildNav() {
  const nav = document.getElementById('pitch-nav');
  nav.innerHTML = '';
  NAV.forEach(group => {
    const groupEl = document.createElement('div');

    const label = document.createElement('span');
    label.className = 'nav-group-label';
    label.textContent = group.group;
    groupEl.appendChild(label);

    group.items.forEach(item => {
      const btn = document.createElement('button');
      btn.className = 'nav-item';
      btn.dataset.id = item.id;
      btn.innerHTML = `
        <span class="nav-num">${item.num}</span>
        <span>${item.label}</span>
        ${item.lock ? '<span class="nav-lock">🔒</span>' : ''}
      `;
      btn.addEventListener('click', () => goTo(item.id));
      groupEl.appendChild(btn);
    });

    nav.appendChild(groupEl);
  });
}

// ── NAVEGAÇÃO ──────────────────────────────
function goTo(id) {
  // Esconde todos os slides
  document.querySelectorAll('.slide').forEach(s => s.classList.remove('active'));
  // Ativa slide
  const slide = document.getElementById(id);
  if (slide) slide.classList.add('active');
  // Atualiza nav
  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.id === id);
  });
  currentSlide = id;
  // Scroll ao topo
  const main = document.getElementById('pitch-main');
  if (main) main.scrollTo({ top: 0 });
  // Renderiza gráfico do slide se houver
  requestAnimationFrame(() => _renderSlideChart(id));
}

// ── LOGIN ──────────────────────────────────
function doPitchLogin() {
  const name  = document.getElementById('pitch-name').value.trim();
  const pass  = document.getElementById('pitch-pass').value.trim();
  const nda   = document.getElementById('pitch-nda').checked;
  const errEl = document.getElementById('login-error');

  errEl.style.display = 'none';

  if (!name) {
    errEl.textContent = 'Informe seu nome completo.';
    errEl.style.display = 'block';
    document.getElementById('pitch-name').focus();
    return;
  }
  if (!nda) {
    errEl.textContent = 'Aceite o Acordo de Confidencialidade para continuar.';
    errEl.style.display = 'block';
    return;
  }
  if (pass !== PITCH_PASSWORD) {
    errEl.textContent = 'Senha incorreta. Solicite acesso ao time OZ.';
    errEl.style.display = 'block';
    document.getElementById('pitch-pass').focus();
    return;
  }

  // Salva sessão
  sessionStorage.setItem('oz_pitch', JSON.stringify({ name, ts: new Date().toISOString() }));

  // Mostra o app
  document.getElementById('pitch-login').style.display = 'none';
  document.getElementById('pitch-app').style.display = 'block';
  buildNav();
  goTo('s01');
  initAllCharts();
}

// ── LOGOUT ─────────────────────────────────
function doPitchLogout() {
  sessionStorage.removeItem('oz_pitch');
  document.getElementById('pitch-app').style.display = 'none';
  document.getElementById('pitch-login').style.display = 'flex';
  document.getElementById('pitch-pass').value = '';
  document.getElementById('login-error').style.display = 'none';
}

// ── KEYBOARD NAV ───────────────────────────
document.addEventListener('keydown', e => {
  if (document.getElementById('pitch-app').style.display === 'none') return;
  const all = allSlideIds();
  const idx = all.indexOf(currentSlide);
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault();
    if (idx < all.length - 1) goTo(all[idx + 1]);
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (idx > 0) goTo(all[idx - 1]);
  }
});

// ═══════════════════════════════════════════
//  CHART.JS — Configuração global de defaults
// ═══════════════════════════════════════════
Chart.defaults.color           = '#a0aec0';
Chart.defaults.borderColor     = 'rgba(255,255,255,0.07)';
Chart.defaults.font.family     = "'Inter', sans-serif";
Chart.defaults.font.size       = 12;
Chart.defaults.plugins.legend.labels.boxWidth  = 12;
Chart.defaults.plugins.legend.labels.padding   = 16;
Chart.defaults.plugins.tooltip.padding         = 12;
Chart.defaults.plugins.tooltip.cornerRadius    = 8;
Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(20,20,35,0.95)';
Chart.defaults.plugins.tooltip.borderColor     = 'rgba(193,121,255,0.3)';
Chart.defaults.plugins.tooltip.borderWidth     = 1;

const ACCENT    = '#c179ff';
const ACCENT2   = '#ff6bba';
const ACCENT3   = '#7dd3fc';
const ACCENT4   = '#86efac';
const ACCENT5   = '#fcd34d';
const GRID_CLR  = 'rgba(255,255,255,0.07)';

// ── Paleta de donut/pie ─────────────────────
const PIE_COLORS = [ACCENT, ACCENT2, ACCENT3, ACCENT4, ACCENT5, '#fb923c'];

// ── Helper: canvas já foi inicializado? ─────
const _charts = {};
function initChart(id, config) {
  if (_charts[id]) { _charts[id].destroy(); }
  const canvas = document.getElementById(id);
  if (!canvas) return;
  _charts[id] = new Chart(canvas, config);
}

// ═══════════════════════════════════════════
//  01 · chart-mvp
//  Slide 06 — Meta MVP 90 dias (bares, promoters, ativações)
//  Tipo: bar agrupado mostrando evolução mês a mês
// ═══════════════════════════════════════════
function renderChartMVP() {
  initChart('chart-mvp', {
    type: 'bar',
    data: {
      labels: ['Mês 1', 'Mês 2', 'Mês 3'],
      datasets: [
        {
          label: 'Bares ativos',
          data: [8, 18, 30],
          backgroundColor: ACCENT,
          borderRadius: 6,
          borderSkipped: false,
        },
        {
          label: 'Promoters ativos',
          data: [40, 110, 200],
          backgroundColor: ACCENT2,
          borderRadius: 6,
          borderSkipped: false,
        },
        {
          label: 'Ativações (×10)',
          data: [60, 200, 500],
          backgroundColor: ACCENT3,
          borderRadius: 6,
          borderSkipped: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: ctx => {
              const v = ctx.raw;
              if (ctx.datasetIndex === 2) return ` Ativações: ${v * 10}`;
              return ` ${ctx.dataset.label}: ${v}`;
            },
          },
        },
      },
      scales: {
        x: { grid: { color: GRID_CLR }, ticks: { color: '#a0aec0' } },
        y: {
          grid: { color: GRID_CLR },
          ticks: { color: '#a0aec0' },
          beginAtZero: true,
        },
      },
    },
  });
}

// ═══════════════════════════════════════════
//  02 · chart-revenue
//  Slide 07 — Composição da receita (donut)
// ═══════════════════════════════════════════
function renderChartRevenue() {
  initChart('chart-revenue', {
    type: 'doughnut',
    data: {
      labels: ['Taxa de ativação', 'Spread promoter', 'Destaque (featured)', 'Reservas premium'],
      datasets: [{
        data: [50, 25, 15, 10],
        backgroundColor: PIE_COLORS,
        borderColor: 'rgba(255,255,255,0.06)',
        borderWidth: 2,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: {
          position: 'right',
          labels: { padding: 14, font: { size: 11 } },
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${ctx.raw}% da receita`,
          },
        },
      },
    },
  });
}

// ═══════════════════════════════════════════
//  03 · chart-tam
//  Slide 08 — TAM / SAM / SOM (barras horizontais)
// ═══════════════════════════════════════════
function renderChartTAM() {
  initChart('chart-tam', {
    type: 'bar',
    data: {
      labels: ['TAM', 'SAM', 'SOM'],
      datasets: [{
        label: 'Tamanho (R$ Bilhões)',
        data: [150, 18, 0.32],
        backgroundColor: [ACCENT, ACCENT2, ACCENT3],
        borderRadius: 8,
        borderSkipped: false,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const v = ctx.raw;
              if (v < 1) return ` R$ ${(v * 1000).toFixed(0)}M`;
              return ` R$ ${v}B`;
            },
          },
        },
      },
      scales: {
        x: {
          type: 'logarithmic',
          grid: { color: GRID_CLR },
          ticks: {
            color: '#a0aec0',
            callback: v => v >= 1 ? `R$${v}B` : `R$${(v*1000).toFixed(0)}M`,
          },
        },
        y: { grid: { color: GRID_CLR }, ticks: { color: '#e2e8f0', font: { weight: '600', size: 13 } } },
      },
    },
  });
}

// ═══════════════════════════════════════════
//  04 · chart-radar
//  Slide 09 — Mapa competitivo (radar)
//  OZ vs Sympla vs iFood vs Instagram
// ═══════════════════════════════════════════
function renderChartRadar() {
  const radarLabels = [
    'Benefício Tempo Real',
    'Promoter Comissionado',
    'Pay-per-Activation',
    'QR Code Nativo',
    'PIX Automático',
    'Multi-perfil (3 lados)',
  ];
  initChart('chart-radar', {
    type: 'radar',
    data: {
      labels: radarLabels,
      datasets: [
        {
          label: 'OZ',
          data: [5, 5, 5, 5, 5, 5],
          backgroundColor: 'rgba(193,121,255,0.2)',
          borderColor: ACCENT,
          borderWidth: 2,
          pointBackgroundColor: ACCENT,
          pointRadius: 4,
        },
        {
          label: 'Sympla',
          data: [2, 0, 1, 2, 1, 1],
          backgroundColor: 'rgba(255,107,186,0.1)',
          borderColor: ACCENT2,
          borderWidth: 1.5,
          pointBackgroundColor: ACCENT2,
          pointRadius: 3,
          borderDash: [4, 3],
        },
        {
          label: 'iFood',
          data: [1, 0, 3, 2, 4, 1],
          backgroundColor: 'rgba(125,211,252,0.1)',
          borderColor: ACCENT3,
          borderWidth: 1.5,
          pointBackgroundColor: ACCENT3,
          pointRadius: 3,
          borderDash: [4, 3],
        },
        {
          label: 'Instagram',
          data: [2, 1, 0, 0, 0, 1],
          backgroundColor: 'rgba(134,239,172,0.1)',
          borderColor: ACCENT4,
          borderWidth: 1.5,
          pointBackgroundColor: ACCENT4,
          pointRadius: 3,
          borderDash: [4, 3],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { padding: 12, font: { size: 11 } } },
      },
      scales: {
        r: {
          min: 0,
          max: 5,
          ticks: {
            display: false,
            stepSize: 1,
          },
          grid: { color: GRID_CLR },
          angleLines: { color: GRID_CLR },
          pointLabels: { color: '#cbd5e1', font: { size: 11 } },
        },
      },
    },
  });
}

// ═══════════════════════════════════════════
//  05 · chart-growth
//  Slide 10 — Crescimento mensal (dual-axis)
//  Ativações/mês + Receita OZ/mês (12 meses)
// ═══════════════════════════════════════════
function renderChartGrowth() {
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const activations = [800, 1800, 3200, 5000, 7500, 10000, 13000, 16500, 19000, 22000, 25500, 28000];
  const revenue     = [  4,    9,   16,   25,   37,    50,    65,   82,    95,   110,   127,   140 ]; // R$ K

  initChart('chart-growth', {
    type: 'line',
    data: {
      labels: months,
      datasets: [
        {
          label: 'Ativações/mês',
          data: activations,
          borderColor: ACCENT,
          backgroundColor: 'rgba(193,121,255,0.12)',
          borderWidth: 2.5,
          fill: true,
          tension: 0.4,
          pointBackgroundColor: ACCENT,
          pointRadius: 4,
          yAxisID: 'yAct',
        },
        {
          label: 'Receita OZ (R$ mil)',
          data: revenue,
          borderColor: ACCENT2,
          backgroundColor: 'rgba(255,107,186,0.08)',
          borderWidth: 2.5,
          fill: true,
          tension: 0.4,
          pointBackgroundColor: ACCENT2,
          pointRadius: 4,
          yAxisID: 'yRev',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: ctx => {
              if (ctx.datasetIndex === 0) return ` Ativações: ${ctx.raw.toLocaleString('pt-BR')}`;
              return ` Receita OZ: R$ ${ctx.raw}K`;
            },
          },
        },
      },
      scales: {
        x: { grid: { color: GRID_CLR }, ticks: { color: '#a0aec0' } },
        yAct: {
          type: 'linear',
          position: 'left',
          beginAtZero: true,
          grid: { color: GRID_CLR },
          ticks: {
            color: ACCENT,
            callback: v => v >= 1000 ? `${(v/1000).toFixed(0)}K` : v,
          },
        },
        yRev: {
          type: 'linear',
          position: 'right',
          beginAtZero: true,
          grid: { display: false },
          ticks: {
            color: ACCENT2,
            callback: v => `R$${v}K`,
          },
        },
      },
    },
  });
}

// ═══════════════════════════════════════════
//  06 · chart-roadmap
//  Slide 11 — Marcos por fase (bar agrupado)
//  Fases: MVP, Expansão SP, Nacional, Escala
// ═══════════════════════════════════════════
function renderChartRoadmap() {
  initChart('chart-roadmap', {
    type: 'bar',
    data: {
      labels: ['MVP\n(Q3 2025)', 'Expansão SP\n(Q1 2026)', 'Nacional\n(Q3 2026)', 'Escala\n(2027)'],
      datasets: [
        {
          label: 'Bares ativos',
          data: [30, 120, 300, 800],
          backgroundColor: ACCENT,
          borderRadius: 6,
          borderSkipped: false,
        },
        {
          label: 'Promoters ativos',
          data: [200, 800, 2000, 6000],
          backgroundColor: ACCENT2,
          borderRadius: 6,
          borderSkipped: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.raw.toLocaleString('pt-BR')}`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: GRID_CLR },
          ticks: {
            color: '#a0aec0',
            maxRotation: 0,
          },
        },
        y: {
          type: 'logarithmic',
          beginAtZero: false,
          grid: { color: GRID_CLR },
          ticks: {
            color: '#a0aec0',
            callback: v => v >= 1000 ? `${(v/1000).toFixed(0)}K` : v,
          },
        },
      },
    },
  });
}

// ═══════════════════════════════════════════
//  07 · chart-allocation
//  Slide 12 — Alocação do capital Seed (donut)
// ═══════════════════════════════════════════
function renderChartAllocation() {
  initChart('chart-allocation', {
    type: 'doughnut',
    data: {
      labels: [
        'Time (dev + growth + ops)',
        'Aquisição de bares (SP)',
        'Marketing & crescimento',
        'Tecnologia & infraestrutura',
        'Legal, compliance & reserva',
      ],
      datasets: [{
        data: [33, 23, 20, 14, 10],
        backgroundColor: PIE_COLORS,
        borderColor: 'rgba(255,255,255,0.06)',
        borderWidth: 2,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '58%',
      plugins: {
        legend: {
          position: 'right',
          labels: { padding: 12, font: { size: 11 } },
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              const values = ['R$ 500K', 'R$ 350K', 'R$ 300K', 'R$ 200K', 'R$ 150K'];
              return ` ${ctx.label}: ${ctx.raw}% · ${values[ctx.dataIndex]}`;
            },
          },
        },
      },
    },
  });
}

// ═══════════════════════════════════════════
//  INICIALIZAR TODOS OS GRÁFICOS
//  Chamado após login E ao restaurar sessão
// ═══════════════════════════════════════════
function initAllCharts() {
  // Aguarda um frame para garantir que os canvas são visíveis
  requestAnimationFrame(() => {
    renderChartRevenue();
    renderChartTAM();
    renderChartRadar();
    renderChartGrowth();
    renderChartRoadmap();
    renderChartAllocation();
    // chart-mvp está em slide s06 — inicializa junto
    renderChartMVP();
  });
}

// ── Renderizar gráfico ao navegar para o slide ──
function _renderSlideChart(id) {
  const slideCharts = {
    s06: renderChartMVP,
    s07: renderChartRevenue,
    s08: renderChartTAM,
    s09: renderChartRadar,
    s10: renderChartGrowth,
    s11: renderChartRoadmap,
    s12: renderChartAllocation,
  };
  if (slideCharts[id]) slideCharts[id]();
}

// ── VALIDAÇÃO EM TEMPO REAL ────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Verifica sessão existente
  const stored = sessionStorage.getItem('oz_pitch');
  if (stored) {
    document.getElementById('pitch-login').style.display = 'none';
    document.getElementById('pitch-app').style.display = 'block';
    buildNav();
    goTo('s01');
    initAllCharts();
    return;
  }

  // Habilita/desabilita botão conforme campos
  const nameEl = document.getElementById('pitch-name');
  const passEl = document.getElementById('pitch-pass');
  const ndaEl  = document.getElementById('pitch-nda');
  const btnEl  = document.getElementById('pitch-login-btn');

  if (!nameEl || !passEl || !ndaEl || !btnEl) return; // guard: elementos de login ausentes

  function checkForm() {
    btnEl.disabled = !(nameEl.value.trim() && passEl.value.trim() && ndaEl.checked);
  }
  nameEl.addEventListener('input', checkForm);
  passEl.addEventListener('input', checkForm);
  ndaEl.addEventListener('change', checkForm);
});
