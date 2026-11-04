'use strict';

/* =========================================================================
   Controle de Pressão — app.js
   Registro de aferições (manhã/tarde/noite), médias diárias/semanais,
   gráfico de evolução, relatório para o médico, CSV/PDF, lembretes.
   ========================================================================= */

/* ------------------------------ utilidades ------------------------------ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const PERIOD_LABEL = { manha: 'Manhã', tarde: 'Tarde', noite: 'Noite' };
const PERIOD_ORDER = ['manha', 'tarde', 'noite'];
const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

const KEY_RECORDS = 'cp_records_v1';
const KEY_SETTINGS = 'cp_settings_v1';

const CLASSES = [
  { label: 'Ótima', short: 'Ótima', color: '#16a34a' },
  { label: 'Normal', short: 'Normal', color: '#65a30d' },
  { label: 'Normal alta', short: 'Normal alta', color: '#d97706' },
  { label: 'Hipertensão estágio 1', short: 'Estágio 1', color: '#ea580c' },
  { label: 'Hipertensão estágio 2', short: 'Estágio 2', color: '#dc2626' },
  { label: 'Crise hipertensiva', short: 'Crise', color: '#7f1d1d' }
];

const pad2 = (n) => String(n).padStart(2, '0');
const toISODate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const toTime = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtDate = (iso) => { const d = parseISO(iso); return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`; };
const fmtDateShort = (iso) => { const d = parseISO(iso); return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`; };
const fmtLong = (iso) => { const d = parseISO(iso); return `${WEEKDAYS[d.getDay()]}, ${fmtDate(iso)}`; };

const fmt1 = (v) => (v == null || isNaN(v)) ? '—' : (Math.round(v * 10) / 10).toLocaleString('pt-BR');
const fmt0 = (v) => (v == null || isNaN(v)) ? '—' : Math.round(v).toLocaleString('pt-BR');
const plural = (n, sing, plur) => (n === 1 ? sing : plur);

/* =========================================================================
   Ajuste de tamanho da tela — "📐 Tamanho da tela"
   Mesma receita do app APP_COLECAO_GAMER: zoom nativo no <html>
   (documentElement.style.zoom) — o conteúdo REFLUI como se a tela fosse
   maior/menor, em vez de só crescer e transbordar. É preferência visual
   POR APARELHO, guardada no localStorage (não entra no backup de dados).
   ========================================================================= */
const ESCALA_MIN = 80;
const ESCALA_MAX = 150;
const KEY_ESCALA = 'cp_escala';

function escalaLida() {
  let v = 0;
  try { v = Number(localStorage.getItem(KEY_ESCALA)); } catch (e) { v = 0; }
  if (!(v >= ESCALA_MIN && v <= ESCALA_MAX)) v = 100;
  return v;
}

function aplicarEscala(v) {
  v = Math.min(ESCALA_MAX, Math.max(ESCALA_MIN, Number(v) || 100));
  // Em 100% o zoom fica FORA do <html>: o WebKit (iPhone/Safari) trata
  // qualquer zoom no raiz como ancestral transformado e aí o cabeçalho
  // fixo deixa de "grudar". Sem zoom no raiz, o padrão fica certinho.
  if (v === 100) document.documentElement.style.removeProperty('zoom');
  else document.documentElement.style.zoom = v / 100;
  return v;
}

function salvarEscala(v) {
  v = aplicarEscala(v);
  try { localStorage.setItem(KEY_ESCALA, String(v)); } catch (e) { /* sem espaço: vale nesta sessão */ }
  return v;
}

// Aplica já na carga, antes do primeiro desenho (evita "piscar" no tamanho errado)
aplicarEscala(escalaLida());

function avgOf(list, key) {
  const v = list.map((x) => Number(x[key])).filter((x) => !isNaN(x) && x > 0);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

const byAsc = (a, b) => (a.date === b.date ? String(a.time).localeCompare(String(b.time)) : String(a.date).localeCompare(String(b.date)));
const byDesc = (a, b) => byAsc(b, a);

function periodFromTime(hhmm) {
  const h = parseInt(String(hhmm).slice(0, 2), 10);
  if (h >= 5 && h < 12) return 'manha';
  if (h >= 12 && h < 18) return 'tarde';
  return 'noite';
}

function classify(s, d) {
  if (s >= 180 || d >= 120) return 5;
  if (s >= 160 || d >= 100) return 4;
  if (s >= 140 || d >= 90) return 3;
  if (s >= 130 || d >= 80) return 2;
  if (s >= 120) return 1;
  return 0;
}

function addDays(date, n) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + n);
  return d;
}

function mondayOf(iso) {
  const d = parseISO(iso);
  const dow = (d.getDay() + 6) % 7; // segunda = 0
  return addDays(d, -dow);
}

/* ------------------------------ estado ------------------------------ */
let records = [];
let settings = {};
let editingId = null;
let periodTouched = false;
let reportSeries = [];
let reportWeeks = [];
let deferredPrompt = null;
let bannerTimer = null;

const DEFAULT_SETTINGS = () => ({
  patient: '',
  remindersEnabled: false,
  reminders: { manha: '07:30', tarde: '13:30', noite: '20:30' },
  fired: {}
});

function load() {
  try { records = JSON.parse(localStorage.getItem(KEY_RECORDS)) || []; } catch (e) { records = []; }
  if (!Array.isArray(records)) records = [];
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY_SETTINGS)) || {}; } catch (e) { s = {}; }
  const def = DEFAULT_SETTINGS();
  settings = Object.assign({}, def, s);
  settings.reminders = Object.assign({}, def.reminders, s.reminders || {});
  settings.fired = s.fired || {};
}

function updateHeader() {
  $('#header-sub').textContent =
    (settings.patient ? settings.patient + ' · ' : '') + fmtLong(toISODate(new Date()));
}

function save() {
  try {
    localStorage.setItem(KEY_RECORDS, JSON.stringify(records));
    localStorage.setItem(KEY_SETTINGS, JSON.stringify(settings));
  } catch (e) {
    toast('Não foi possível salvar (armazenamento cheio?)', true);
  }
}

/* ------------------------------ avisos ------------------------------ */
function toast(msg, isErr) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('err', !!isErr);
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), 2600);
}

function showBanner(msg) {
  $('#banner-text').textContent = msg;
  $('#banner').classList.remove('hidden');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => $('#banner').classList.add('hidden'), 60000);
}

/* ------------------------------ navegação ------------------------------ */
function activateView(name) {
  $$('.tab').forEach((t) => {
    const on = t.dataset.view === name;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  if (name === 'registrar') renderToday();
  if (name === 'historico') renderHistory();
  if (name === 'relatorio') renderReport();
}

/* =========================================================================
   REGISTRAR
   ========================================================================= */
function resetForm() {
  editingId = null;
  periodTouched = false;
  $('#form-title').textContent = 'Nova aferição';
  $('#btn-submit').textContent = 'Salvar aferição';
  $('#edit-banner').classList.add('hidden');
  $('#in-date').value = toISODate(new Date());
  $('#in-time').value = toTime(new Date());
  $('#in-sys').value = '';
  $('#in-dia').value = '';
  $('#in-pulse').value = '';
  $('#in-note').value = '';
  $('#in-period').value = periodFromTime($('#in-time').value);
  $('#form-error').classList.add('hidden');
  updateLiveClass();
}

function startEdit(id) {
  const r = records.find((x) => x.id === id);
  if (!r) return;
  editingId = id;
  periodTouched = true;
  $('#form-title').textContent = 'Editar aferição';
  $('#btn-submit').textContent = 'Salvar alterações';
  $('#edit-banner').classList.remove('hidden');
  $('#in-date').value = r.date;
  $('#in-time').value = r.time;
  $('#in-sys').value = r.sys;
  $('#in-dia').value = r.dia;
  $('#in-pulse').value = r.pulse || '';
  $('#in-note').value = r.note || '';
  $('#in-period').value = r.period;
  $('#form-error').classList.add('hidden');
  updateLiveClass();
  activateView('registrar');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  setTimeout(() => $('#in-sys').focus(), 250);
}

function updateLiveClass() {
  const el = $('#live-class');
  const s = Number($('#in-sys').value);
  const d = Number($('#in-dia').value);
  if (!s || !d || s < 30 || d < 20) { el.innerHTML = ''; return; }
  const c = CLASSES[classify(s, d)];
  el.innerHTML = `<span class="badge" style="background:${c.color}1f;color:${c.color};font-size:.8rem;padding:5px 11px">${c.label}</span>`;
}

function readingRow(r, opts) {
  opts = opts || {};
  const c = CLASSES[classify(r.sys, r.dia)];
  return `<div class="reading" data-id="${r.id}">
    <div class="time">${esc(r.time)}</div>
    <div class="bp">${r.sys}/${r.dia}<small> mmHg</small></div>
    <div class="acts">
      <button class="act" data-act="edit" title="Editar" aria-label="Editar">✏️</button>
      <button class="act del" data-act="del" title="Excluir" aria-label="Excluir">🗑</button>
    </div>
    <div class="meta">
      <span class="badge ${r.period}">${PERIOD_LABEL[r.period] || ''}</span>
      ${opts.showDate ? `<span class="badge" style="background:#f3f4f6;color:#4b5563">${fmtDate(r.date)}</span>` : ''}
      ${r.pulse ? `<span class="badge" style="background:#f3f4f6;color:#4b5563">${r.pulse} bpm</span>` : ''}
      <span class="badge" style="background:${c.color}1f;color:${c.color}">${c.short}</span>
      ${r.note ? `<div class="note" title="${esc(r.note)}">📝 ${esc(r.note)}</div>` : ''}
    </div>
  </div>`;
}

function renderToday() {
  const today = toISODate(new Date());
  const list = records.filter((r) => r.date === today).sort(byAsc);

  $('#today-summary').textContent = list.length
    ? `${list.length} ${plural(list.length, 'aferição', 'aferições')}`
    : 'nenhuma ainda';

  const chips = PERIOD_ORDER.map((p) => {
    const rs = list.filter((r) => r.period === p);
    const done = rs.length > 0;
    const v = done ? `${Math.round(avgOf(rs, 'sys'))} / ${Math.round(avgOf(rs, 'dia'))}` : 'pendente';
    return `<div class="chip ${done ? 'ok' : ''}">
      <div class="t">${PERIOD_LABEL[p]}</div>
      <div class="v ${done ? '' : 'none'}">${v}</div>
    </div>`;
  });

  if (list.length) {
    chips.push(`<div class="chip">
      <div class="t">Média do dia</div>
      <div class="v">${Math.round(avgOf(list, 'sys'))} / ${Math.round(avgOf(list, 'dia'))}</div>
    </div>`);
  }

  $('#today-chips').innerHTML = chips.join('');
  $('#today-list').innerHTML = list.map((r) => readingRow(r)).join('');
  $('#today-empty').classList.toggle('hidden', list.length > 0);
}

/* =========================================================================
   HISTÓRICO
   ========================================================================= */
function inRange(days) {
  if (!days) return records.slice();
  const start = toISODate(addDays(new Date(), -(days - 1)));
  return records.filter((r) => r.date >= start);
}

function renderHistory() {
  const days = Number($('#hist-range').value);
  const period = $('#hist-period').value;

  let list = inRange(days);
  if (period) list = list.filter((r) => r.period === period);
  list.sort(byDesc);

  const summary = $('#hist-summary');
  const empty = $('#hist-empty');

  if (!list.length) {
    summary.classList.add('hidden');
    empty.classList.remove('hidden');
    $('#hist-list').innerHTML = '';
    return;
  }
  empty.classList.add('hidden');

  const dias = new Set(list.map((r) => r.date));
  const completos = countCompleteDays(dias);

  summary.classList.remove('hidden');
  summary.innerHTML = `<div class="summary-grid">
    <div class="s-item"><b>${list.length}</b><span>${plural(list.length, 'aferição', 'aferições')}</span></div>
    <div class="s-item"><b>${dias.size}</b><span>${plural(dias.size, 'dia com registro', 'dias com registro')}</span></div>
    <div class="s-item"><b>${fmt0(avgOf(list, 'sys'))}</b><span>média sistólica</span></div>
    <div class="s-item"><b>${fmt0(avgOf(list, 'dia'))}</b><span>média diastólica</span></div>
    <div class="s-item"><b>${completos}/${dias.size}</b><span>dias completos (3x)</span></div>
  </div>`;

  const groups = new Map();
  list.forEach((r) => {
    if (!groups.has(r.date)) groups.set(r.date, []);
    groups.get(r.date).push(r);
  });

  $('#hist-list').innerHTML = Array.from(groups.entries()).map(([date, rs]) => {
    const d = parseISO(date);
    const done = PERIOD_ORDER.every((p) => rs.some((r) => r.period === p));
    return `<div class="day-group">
      <div class="day-head">
        <span class="d-title">${fmtDate(date)} <em>· ${WEEKDAYS[d.getDay()]}</em></span>
        <span class="d-avg">Média <b>${Math.round(avgOf(rs, 'sys'))}/${Math.round(avgOf(rs, 'dia'))}</b>
          · ${rs.length}x ${done ? '✅ completo' : '⚠️ incompleto'}</span>
      </div>
      <div class="day-body">${rs.map((r) => readingRow(r)).join('')}</div>
    </div>`;
  }).join('');
}

function countCompleteDays(dateSet) {
  const arr = Array.from(dateSet);
  return arr.filter((date) => {
    const rs = records.filter((r) => r.date === date);
    return PERIOD_ORDER.every((p) => rs.some((r) => r.period === p));
  }).length;
}

/* =========================================================================
   RELATÓRIO
   ========================================================================= */
function stats(list) {
  return {
    n: list.length,
    sys: avgOf(list, 'sys'),
    dia: avgOf(list, 'dia'),
    pulse: avgOf(list, 'pulse'),
    minSys: list.length ? Math.min.apply(null, list.map((r) => r.sys)) : null,
    maxSys: list.length ? Math.max.apply(null, list.map((r) => r.sys)) : null,
    minDia: list.length ? Math.min.apply(null, list.map((r) => r.dia)) : null,
    maxDia: list.length ? Math.max.apply(null, list.map((r) => r.dia)) : null
  };
}

function dailySeries(list) {
  const map = new Map();
  list.slice().sort(byAsc).forEach((r) => {
    if (!map.has(r.date)) map.set(r.date, []);
    map.get(r.date).push(r);
  });
  return Array.from(map.entries()).map(([date, rs]) => ({
    date,
    n: rs.length,
    sys: avgOf(rs, 'sys'),
    dia: avgOf(rs, 'dia'),
    list: rs
  }));
}

function weeklySeries(list) {
  const map = new Map();
  list.slice().sort(byAsc).forEach((r) => {
    const mon = toISODate(mondayOf(r.date));
    if (!map.has(mon)) map.set(mon, []);
    map.get(mon).push(r);
  });
  return Array.from(map.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([mon, rs]) => {
      const end = addDays(parseISO(mon), 6);
      return {
        mon,
        label: `${fmtDateShort(mon)}–${pad2(end.getDate())}/${pad2(end.getMonth() + 1)}`,
        n: rs.length,
        sys: avgOf(rs, 'sys'),
        dia: avgOf(rs, 'dia'),
        pulse: avgOf(rs, 'pulse')
      };
    });
}

function renderReport() {
  const days = Number($('#rep-range').value);
  const list = inRange(days).slice().sort(byAsc);
  const from = list.length ? list[0].date : null;
  const to = list.length ? list[list.length - 1].date : null;
  const rangeTxt = from ? `${fmtDate(from)} a ${fmtDate(to)}` : 'sem dados';

  $('#print-sub').textContent =
    (settings.patient ? `Paciente: ${settings.patient} · ` : '') +
    `Período: ${rangeTxt} · ${list.length} ${plural(list.length, 'aferição', 'aferições')} · gerado em ${fmtDate(toISODate(new Date()))} às ${toTime(new Date())}`;
  $('#rep-footer-text').textContent =
    `Relatório gerado pelo aplicativo Controle de Pressão em ${fmtDate(toISODate(new Date()))} às ${toTime(new Date())}, ` +
    `sobre ${list.length} ${plural(list.length, 'aferição', 'aferições')} no período ${rangeTxt}. ` +
    'Médias aritméticas por período e por semana. Documento de acompanhamento — não substitui avaliação médica.';

  if (!list.length) {
    $('#rep-kpis').innerHTML = '<p class="empty">Nenhuma aferição no período selecionado.</p>';
    $('#rep-periods').innerHTML = '';
    $('#rep-chart').innerHTML = '<p class="empty">Sem dados para o gráfico.</p>';
    $('#rep-weeks').innerHTML = '';
    $('#rep-weekchart').innerHTML = '';
    $('#rep-class').innerHTML = '';
    reportSeries = []; reportWeeks = [];
    return;
  }

  /* ---- KPIs ---- */
  const st = stats(list);
  const dias = new Set(list.map((r) => r.date));
  const completos = countCompleteDays(dias);
  const cSys = CLASSES[classify(Math.round(st.sys), Math.round(st.dia))];

  $('#rep-kpis').innerHTML = `
    <div class="kpi"><div class="k-label">Média sistólica</div><div class="k-value sys">${fmt1(st.sys)}</div><div class="k-sub">mmHg · ${cSys.label}</div></div>
    <div class="kpi"><div class="k-label">Média diastólica</div><div class="k-value dia">${fmt1(st.dia)}</div><div class="k-sub">mmHg</div></div>
    <div class="kpi"><div class="k-label">Média do pulso</div><div class="k-value">${fmt0(st.pulse)}</div><div class="k-sub">bpm</div></div>
    <div class="kpi"><div class="k-label">Aferições</div><div class="k-value">${st.n}</div><div class="k-sub">em ${plural(dias.size, 'dia', 'dias')}</div></div>
    <div class="kpi"><div class="k-label">Dias completos (3x)</div><div class="k-value">${completos}/${dias.size}</div><div class="k-sub">manhã + tarde + noite</div></div>
    <div class="kpi"><div class="k-label">Sistólica mín–máx</div><div class="k-value" style="font-size:1.15rem">${st.minSys}–${st.maxSys}</div><div class="k-sub">diastólica ${st.minDia}–${st.maxDia}</div></div>`;

  /* ---- médias por período ---- */
  const rows = PERIOD_ORDER.map((p) => {
    const rs = list.filter((r) => r.period === p);
    if (!rs.length) return `<tr><td>${PERIOD_LABEL[p]}</td><td>0</td><td colspan="4" class="muted">sem registros</td></tr>`;
    const s = stats(rs);
    return `<tr>
      <td>${PERIOD_LABEL[p]}</td>
      <td>${s.n}</td>
      <td><strong>${fmt1(s.sys)}</strong></td>
      <td><strong>${fmt1(s.dia)}</strong></td>
      <td>${fmt0(s.pulse)}</td>
      <td>${s.minSys}–${s.maxSys}</td>
    </tr>`;
  }).join('');

  $('#rep-periods').innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Período</th><th>N</th><th>Média sistólica</th><th>Média diastólica</th><th>Média pulso</th><th>Sist. mín–máx</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td>Geral</td><td>${st.n}</td><td>${fmt1(st.sys)}</td><td>${fmt1(st.dia)}</td><td>${fmt0(st.pulse)}</td><td>${st.minSys}–${st.maxSys}</td></tr></tfoot>
  </table></div>`;

  /* ---- médias semanais ---- */
  const weeks = weeklySeries(list);
  reportWeeks = weeks;
  const wrows = weeks.map((w, i) => {
    let delta = '<td class="delta-flat">—</td>';
    if (i > 0) {
      const diff = w.sys - weeks[i - 1].sys;
      if (Math.abs(diff) < 0.5) delta = '<td class="delta-flat">–</td>';
      else if (diff > 0) delta = `<td class="delta-up">▲ +${fmt1(diff)}</td>`;
      else delta = `<td class="delta-down">▼ ${fmt1(diff)}</td>`;
    }
    return `<tr>
      <td>${w.label}</td><td>${w.n}</td>
      <td><strong>${fmt1(w.sys)}</strong></td>
      <td><strong>${fmt1(w.dia)}</strong></td>
      <td>${fmt0(w.pulse)}</td>${delta}
    </tr>`;
  }).join('');

  $('#rep-weeks').innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Semana</th><th>N</th><th>Média sistólica</th><th>Média diastólica</th><th>Média pulso</th><th>Δ vs anterior</th></tr></thead>
    <tbody>${wrows}</tbody>
  </table></div>`;

  /* ---- classificação ---- */
  const counts = new Array(CLASSES.length).fill(0);
  list.forEach((r) => counts[classify(r.sys, r.dia)]++);
  $('#rep-class').innerHTML = `<div class="class-list">` + CLASSES.map((c, i) => {
    const pct = Math.round((counts[i] / list.length) * 100);
    return `<div class="class-row">
      <span class="c-name">${c.label}</span>
      <span class="c-bar"><i style="width:${pct}%;background:${c.color}"></i></span>
      <span class="c-count">${counts[i]} (${pct}%)</span>
    </div>`;
  }).join('') + `</div>`;

  reportSeries = dailySeries(list);
  renderCharts();
}

/* =========================================================================
   GRÁFICOS (SVG próprio, sem dependências)
   ========================================================================= */
function renderCharts() {
  if (!$('#view-relatorio').classList.contains('active')) return;
  const w1 = $('#rep-chart').clientWidth || 340;
  const w2 = $('#rep-weekchart').clientWidth || 340;

  $('#rep-chart').innerHTML = reportSeries.length
    ? lineChartSVG(reportSeries, w1)
    : '<p class="empty">Sem dados para o gráfico.</p>';

  $('#rep-weekchart').innerHTML = reportWeeks.length > 1
    ? weekBarSVG(reportWeeks, w2)
    : '<p class="empty">Dados de pelo menos 2 semanas para comparar.</p>';
}

function lineChartSVG(series, width) {
  const W = Math.max(300, Math.round(width));
  const H = 300;
  const pad = { l: 40, r: 14, t: 16, b: 40 };
  const vals = [];
  series.forEach((d) => { vals.push(d.sys, d.dia); d.list.forEach((r) => vals.push(r.sys, r.dia)); });

  let min = Math.min.apply(null, vals);
  let max = Math.max.apply(null, vals);
  min = Math.min(Math.floor((min - 8) / 10) * 10, 70);
  max = Math.max(Math.ceil((max + 8) / 10) * 10, 150);
  if (max - min < 40) max = min + 40;

  const n = series.length;
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const X = (i) => (n === 1 ? pad.l + iw / 2 : pad.l + (i * iw) / (n - 1));
  const Y = (v) => pad.t + ((max - v) / (max - min)) * ih;

  let g = '';

  // grade + escala
  const step = (max - min) <= 80 ? 10 : 20;
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) {
    const y = Y(v);
    g += `<line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${W - pad.r}" y2="${y.toFixed(1)}" stroke="#eef0f5" stroke-width="1"/>`;
    g += `<text x="${pad.l - 7}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#9aa1ad">${v}</text>`;
  }

  // linhas de referência 140 / 90 (limite clássico)
  [[140, '#dc2626', '140'], [90, '#2563eb', '90']].forEach(([v, color, lbl]) => {
    if (v < min || v > max) return;
    const y = Y(v);
    g += `<line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${W - pad.r}" y2="${y.toFixed(1)}" stroke="${color}" stroke-width="1.4" stroke-dasharray="6 5" opacity=".65"/>`;
    g += `<text x="${W - pad.r - 2}" y="${(y - 5).toFixed(1)}" text-anchor="end" font-size="10" font-weight="700" fill="${color}" opacity=".85">${lbl}</text>`;
  });

  // eixo x
  g += `<line x1="${pad.l}" y1="${H - pad.b}" x2="${W - pad.r}" y2="${H - pad.b}" stroke="#d7dbe4" stroke-width="1.5"/>`;
  const every = Math.ceil(n / 7);
  series.forEach((d, i) => {
    if (i % every !== 0 && i !== n - 1) return;
    const x = X(i);
    g += `<text x="${x.toFixed(1)}" y="${H - pad.b + 16}" text-anchor="middle" font-size="10.5" fill="#7b8291">${fmtDateShort(d.date)}</text>`;
  });

  // pontos individuais
  series.forEach((d, i) => {
    d.list.forEach((r) => {
      g += `<circle cx="${X(i).toFixed(1)}" cy="${Y(r.sys).toFixed(1)}" r="3" fill="#dc2626" opacity=".3"><title>${fmtDate(r.date)} ${r.time} — sistólica ${r.sys}</title></circle>`;
      g += `<circle cx="${X(i).toFixed(1)}" cy="${Y(r.dia).toFixed(1)}" r="3" fill="#2563eb" opacity=".3"><title>${fmtDate(r.date)} ${r.time} — diastólica ${r.dia}</title></circle>`;
    });
  });

  // linhas das médias diárias
  const path = (key) => series.map((d, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(d[key]).toFixed(1)}`).join(' ');
  if (n > 1) {
    g += `<path d="${path('sys')}" fill="none" stroke="#dc2626" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>`;
    g += `<path d="${path('dia')}" fill="none" stroke="#2563eb" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  series.forEach((d, i) => {
    g += `<circle cx="${X(i).toFixed(1)}" cy="${Y(d.sys).toFixed(1)}" r="4.6" fill="#fff" stroke="#dc2626" stroke-width="2.4"><title>${fmtDate(d.date)} — média sistólica ${fmt1(d.sys)} (${d.n}x)</title></circle>`;
    g += `<circle cx="${X(i).toFixed(1)}" cy="${Y(d.dia).toFixed(1)}" r="4.6" fill="#fff" stroke="#2563eb" stroke-width="2.4"><title>${fmtDate(d.date)} — média diastólica ${fmt1(d.dia)} (${d.n}x)</title></circle>`;
  });

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de evolução diária da pressão">
    <rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>${g}</svg>`;
}

function weekBarSVG(weeks, width) {
  const W = Math.max(300, Math.round(width));
  const H = 250;
  const pad = { l: 40, r: 14, t: 22, b: 42 };
  const vals = [];
  weeks.forEach((w) => vals.push(w.sys, w.dia));

  let min = Math.min.apply(null, vals);
  let max = Math.max.apply(null, vals);
  min = Math.min(Math.floor((min - 8) / 10) * 10, 70);
  max = Math.max(Math.ceil((max + 8) / 10) * 10, 150);
  if (max - min < 40) max = min + 40;

  const n = weeks.length;
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const gw = iw / n;
  const bw = Math.min(30, gw * 0.32);
  const Y = (v) => pad.t + ((max - v) / (max - min)) * ih;

  let g = '';
  const step = (max - min) <= 80 ? 10 : 20;
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) {
    const y = Y(v);
    g += `<line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${W - pad.r}" y2="${y.toFixed(1)}" stroke="#eef0f5"/>`;
    g += `<text x="${pad.l - 7}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#9aa1ad">${v}</text>`;
  }
  g += `<line x1="${pad.l}" y1="${H - pad.b}" x2="${W - pad.r}" y2="${H - pad.b}" stroke="#d7dbe4" stroke-width="1.5"/>`;

  weeks.forEach((w, i) => {
    const cx = pad.l + gw * i + gw / 2;
    const x1 = cx - bw - 3;
    const x2 = cx + 3;
    const ySys = Y(w.sys), yDia = Y(w.dia);

    g += `<rect x="${x1.toFixed(1)}" y="${ySys.toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - pad.b - ySys).toFixed(1)}" rx="4" fill="#dc2626"><title>${w.label} — média sistólica ${fmt1(w.sys)} (${w.n}x)</title></rect>`;
    g += `<rect x="${x2.toFixed(1)}" y="${yDia.toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - pad.b - yDia).toFixed(1)}" rx="4" fill="#2563eb"><title>${w.label} — média diastólica ${fmt1(w.dia)} (${w.n}x)</title></rect>`;

    if (gw > 62) {
      g += `<text x="${(x1 + bw / 2).toFixed(1)}" y="${(ySys - 5).toFixed(1)}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#dc2626">${Math.round(w.sys)}</text>`;
      g += `<text x="${(x2 + bw / 2).toFixed(1)}" y="${(yDia - 5).toFixed(1)}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#2563eb">${Math.round(w.dia)}</text>`;
    }
    g += `<text x="${cx.toFixed(1)}" y="${H - pad.b + 16}" text-anchor="middle" font-size="10" fill="#7b8291">${w.label}</text>`;
  });

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de médias semanais">
    <rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>${g}</svg>`;
}

/* =========================================================================
   EXPORTAÇÃO
   ========================================================================= */
function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function exportCSV() {
  const days = Number($('#hist-range').value);
  const period = $('#hist-period').value;
  let list = inRange(days);
  if (period) list = list.filter((r) => r.period === period);
  if (!list.length) { toast('Nenhuma aferição para exportar', true); return; }
  list.sort(byAsc);

  const head = ['Data', 'Hora', 'Periodo', 'Sistolica', 'Diastolica', 'Pulso', 'Classificacao', 'Observacao'];
  const rows = list.map((r) => [
    fmtDate(r.date), r.time, PERIOD_LABEL[r.period] || r.period,
    r.sys, r.dia, r.pulse || '', CLASSES[classify(r.sys, r.dia)].label, r.note || ''
  ]);

  const csv = '\ufeffsep=;\n' + [head].concat(rows)
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');

  download(`pressao_${toISODate(new Date())}.csv`, csv, 'text/csv;charset=utf-8');
  toast('CSV exportado');
}

function exportBackup() {
  const data = {
    app: 'controle-pressao',
    version: 1,
    exportedAt: new Date().toISOString(),
    records,
    settings
  };
  download(`backup-pressao_${toISODate(new Date())}.json`, JSON.stringify(data, null, 2), 'application/json');
  toast('Backup salvo');
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const recs = Array.isArray(data) ? data : data.records;
      if (!Array.isArray(recs)) throw new Error('formato inválido');
      const ok = recs.every((r) => r && r.date && r.time && Number(r.sys) > 0 && Number(r.dia) > 0);
      if (!ok) throw new Error('registros inválidos');
      if (!confirm(`Restaurar backup com ${recs.length} ${plural(recs.length, 'aferição', 'aferições')}? Os dados atuais serão substituídos.`)) return;
      records = recs.map((r) => ({
        id: r.id || Date.now() + Math.floor(Math.random() * 1000),
        date: r.date,
        time: r.time,
        sys: Number(r.sys),
        dia: Number(r.dia),
        pulse: r.pulse ? Number(r.pulse) : null,
        period: r.period || periodFromTime(r.time),
        note: r.note || ''
      }));
      if (data.settings) {
        const def = DEFAULT_SETTINGS();
        settings = Object.assign({}, def, data.settings);
        settings.reminders = Object.assign({}, def.reminders, (data.settings || {}).reminders || {});
        settings.fired = (data.settings || {}).fired || {};
      }
      save();
      renderToday(); renderHistory();
      updateHeader();
      if ($('#view-relatorio').classList.contains('active')) renderReport();
      toast('Backup restaurado');
    } catch (e) {
      toast('Arquivo de backup inválido', true);
    }
  };
  reader.readAsText(file);
}

function printReport() {
  activateView('relatorio');
  setTimeout(() => window.print(), 350);
}

/* =========================================================================
   LEMBRETES
   ========================================================================= */
function checkReminders() {
  const now = new Date();
  const hhmm = toTime(now);
  const today = toISODate(now);

  // limpar avisos antigos
  const cutoff = toISODate(addDays(now, -7));
  let dirty = false;
  Object.keys(settings.fired || {}).forEach((k) => {
    if (String(k).slice(0, 10) < cutoff) { delete settings.fired[k]; dirty = true; }
  });
  if (dirty) save();

  if (!settings.remindersEnabled) return;

  PERIOD_ORDER.forEach((p) => {
    if (settings.reminders[p] !== hhmm) return;
    const key = `${today}|${p}`;
    if (settings.fired[key]) return;
    settings.fired[key] = true;
    save();

    const msg = `Hora de medir a pressão — ${PERIOD_LABEL[p].toLowerCase()} (${hhmm})`;
    showBanner('⏰ ' + msg);
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('Controle de Pressão', { body: msg, tag: key, icon: 'icons/icon-192.png' });
      } catch (e) { /* ignora */ }
    }
  });
}

async function toggleReminders(on) {
  settings.remindersEnabled = on;
  if (on && 'Notification' in window && Notification.permission === 'default') {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') toast('Permissão de notificação negada', true);
    } catch (e) { /* ignora */ }
  }
  save();
}

/* =========================================================================
   INICIALIZAÇÃO
   ========================================================================= */
function bind() {
  // abas
  $$('.tab').forEach((t) => t.addEventListener('click', () => activateView(t.dataset.view)));

  // formulário
  $('#form-reading').addEventListener('submit', (e) => {
    e.preventDefault();
    const date = $('#in-date').value;
    const time = $('#in-time').value;
    const sys = Number($('#in-sys').value);
    const dia = Number($('#in-dia').value);
    const pulseRaw = $('#in-pulse').value;
    const pulse = pulseRaw === '' ? null : Number(pulseRaw);
    const period = $('#in-period').value;
    const note = $('#in-note').value.trim();
    const err = $('#form-error');

    const fail = (msg) => {
      err.textContent = msg;
      err.classList.remove('hidden');
      return false;
    };

    if (!date || !time) return fail('Informe data e hora da aferição.');
    if (!sys || !dia) return fail('Informe a pressão sistólica e diastólica.');
    if (sys < 60 || sys > 260) return fail('Sistólica fora do intervalo aceito (60–260 mmHg).');
    if (dia < 30 || dia > 160) return fail('Diastólica fora do intervalo aceito (30–160 mmHg).');
    if (sys <= dia) return fail('A sistólica deve ser maior que a diastólica.');
    if (pulse !== null && (pulse < 30 || pulse > 220)) return fail('Pulso fora do intervalo aceito (30–220 bpm).');
    err.classList.add('hidden');

    if (editingId) {
      const r = records.find((x) => x.id === editingId);
      if (r) Object.assign(r, { date, time, sys, dia, pulse, period, note });
      save();
      toast('Alterações salvas');
    } else {
      records.push({
        id: Date.now() + Math.floor(Math.random() * 1000),
        date, time, sys, dia, pulse, period, note
      });
      save();
      toast('Aferição registrada ✓');
    }

    resetForm();
    renderToday();
    if ($('#view-historico').classList.contains('active')) renderHistory();
    if ($('#view-relatorio').classList.contains('active')) renderReport();
  });

  $('#btn-cancel-edit').addEventListener('click', () => { resetForm(); $('#in-sys').focus(); });

  // classificação ao vivo + período automático
  ['#in-sys', '#in-dia'].forEach((sel) => $(sel).addEventListener('input', updateLiveClass));
  $('#in-time').addEventListener('change', () => {
    if (!periodTouched) $('#in-period').value = periodFromTime($('#in-time').value);
  });
  $('#in-period').addEventListener('change', () => { periodTouched = true; });

  // ações em leituras (editar/excluir) — delegação global
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const wrap = btn.closest('.reading');
    if (!wrap) return;
    const id = Number(wrap.dataset.id);
    const act = btn.dataset.act;
    if (act === 'edit') startEdit(id);
    if (act === 'del') {
      const r = records.find((x) => x.id === id);
      if (!r) return;
      if (!confirm(`Excluir a aferição de ${fmtDate(r.date)} às ${r.time} (${r.sys}/${r.dia})?`)) return;
      records = records.filter((x) => x.id !== id);
      save();
      renderToday();
      renderHistory();
      if ($('#view-relatorio').classList.contains('active')) renderReport();
      if (editingId === id) resetForm();
      toast('Registro excluído');
    }
  });

  // histórico
  $('#hist-range').addEventListener('change', renderHistory);
  $('#hist-period').addEventListener('change', renderHistory);
  $('#btn-csv').addEventListener('click', exportCSV);
  $('#btn-print-hist').addEventListener('click', printReport);
  $('#btn-backup').addEventListener('click', exportBackup);
  $('#in-restore').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) importBackup(f);
    e.target.value = '';
  });

  // relatório
  $('#rep-range').addEventListener('change', renderReport);
  $('#btn-print-report').addEventListener('click', () => window.print());

  // banner
  $('#banner-close').addEventListener('click', () => $('#banner').classList.add('hidden'));

  // configurações
  const dlg = $('#settings-dialog');

  // 📐 ajuste de tamanho da tela (mesmo ajuste do APP_COLECAO_GAMER)
  const escalaRange = $('#escala-range');
  const escalaVal = $('#escala-val');
  const syncEscala = (v) => { escalaRange.value = v; escalaVal.textContent = v + '%'; };
  syncEscala(escalaLida());
  // ao vivo enquanto arrasta
  escalaRange.addEventListener('input', (e) => {
    escalaVal.textContent = aplicarEscala(e.target.value) + '%';
  });
  // guarda ao soltar
  escalaRange.addEventListener('change', (e) => {
    escalaVal.textContent = salvarEscala(e.target.value) + '%';
  });
  $('#escala-reset').addEventListener('click', () => {
    syncEscala(salvarEscala(100));
    toast('Tamanho voltando ao padrão (100%)');
  });
  // imprimir/PDF sempre sai no tamanho normal
  window.addEventListener('beforeprint', () => document.documentElement.style.removeProperty('zoom'));
  window.addEventListener('afterprint', () => aplicarEscala(escalaLida()));

  $('#btn-settings').addEventListener('click', () => {
    syncEscala(escalaLida());
    $('#set-patient').value = settings.patient || '';
    $('#set-reminders').checked = !!settings.remindersEnabled;
    $('#rem-manha').value = settings.reminders.manha;
    $('#rem-tarde').value = settings.reminders.tarde;
    $('#rem-noite').value = settings.reminders.noite;
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  });
  $('#set-patient').addEventListener('input', (e) => { settings.patient = e.target.value.trim(); save(); updateHeader(); });
  $('#set-reminders').addEventListener('change', (e) => toggleReminders(e.target.checked));
  ['manha', 'tarde', 'noite'].forEach((p) => {
    $('#rem-' + p).addEventListener('change', (e) => {
      settings.reminders[p] = e.target.value;
      save();
      toast(`Lembrete ${PERIOD_LABEL[p].toLowerCase()} às ${e.target.value}`);
    });
  });
  $('#btn-test-notify').addEventListener('click', async () => {
    if ('Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch (e) { /* ignora */ }
    }
    showBanner('⏰ Teste de lembrete — hora de medir a pressão!');
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification('Controle de Pressão', { body: 'Teste de lembrete ✓', icon: 'icons/icon-192.png' }); } catch (e) { /* ignora */ }
    } else {
      toast('Navegador sem permissão de notificação', true);
    }
  });

  // instalação (PWA)
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $('#btn-install').classList.remove('hidden');
  });
  $('#btn-install').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch (e) { /* ignora */ }
    deferredPrompt = null;
    $('#btn-install').classList.add('hidden');
  });
  window.addEventListener('appinstalled', () => {
    $('#btn-install').classList.add('hidden');
    toast('App instalado ✓');
  });

  // redimensionar gráficos
  let rt = null;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { if ($('#view-relatorio').classList.contains('active')) renderCharts(); }, 160);
  });

  // tecla Escape fecha o dialog nativo (navegadores antigos)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dlg.hasAttribute('open')) dlg.close();
  });
}

function init() {
  load();

  updateHeader();

  resetForm();
  bind();
  renderToday();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  checkReminders();
  setInterval(checkReminders, 20000);
  setInterval(updateHeader, 60000);
}

document.addEventListener('DOMContentLoaded', init);
