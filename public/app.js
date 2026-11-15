// 统一反馈后台前端：用户提交的内容一律用 textContent / 属性赋值渲染，不拼 HTML
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var SVGNS = 'http://www.w3.org/2000/svg';
  var KINDS = ['解析失败', '下载失败', '还有水印', '视频有问题', '图片有问题', '其他'];
  var SITE_KEYS = ['douyin', 'xiaohongshu', 'bilibili', 'youtube', 'tiktok', 'kuaishou', 'weibo', 'deepseek', 'zhijia', 'brake', 'other'];
  var SITES = { douyin: '抖音', xiaohongshu: '小红书', bilibili: 'B站', youtube: 'YouTube', tiktok: 'TikTok', kuaishou: '快手', weibo: '微博', deepseek: 'DeepSeek', zhijia: '智驾模拟器', brake: '刹车模拟器', other: '其他' };
  var state = { cursor: null, loading: false, site: '', status: '', order: 'desc', total: 0, more: false, stats: null, seq: 0 };

  /* ---------- 工具 ---------- */
  var ICONS = {
    refresh: 'M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6',
    logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
    sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42',
    moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
    search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
    inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
    alert: 'M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
    clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
    check: 'M20 6L9 17l-5-5',
    undo: 'M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13',
    trash: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6',
    link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
    copy: 'M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
    user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
    pin: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    hash: 'M4 9h16M4 15h16M10 3L8 21M16 3l-2 18',
    file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
    layers: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
    today: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
    trend: 'M23 6l-9.5 9.5-5-5L1 18M17 6h6v6',
  };
  function icon(name) {
    var s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'ico'); s.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', ICONS[name]); s.appendChild(p);
    return s;
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = String(text);
    return e;
  }
  function svgEl(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function siteKey(s) { return SITE_KEYS.indexOf(s) >= 0 ? s : 'other'; }
  function toast(t) {
    var e = $('toast'); e.textContent = t; e.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { e.hidden = true; }, 2400);
  }
  var TZ = 'Asia/Shanghai';
  function fmtAbs(ms) {
    return new Date(ms).toLocaleString('zh-CN', { hour12: false, timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function fmtRel(ms) {
    var d = (Date.now() - ms) / 1000;
    if (d < 60) return '刚刚';
    if (d < 3600) return Math.floor(d / 60) + ' 分钟前';
    if (d < 86400) return Math.floor(d / 3600) + ' 小时前';
    if (d < 86400 * 30) return Math.floor(d / 86400) + ' 天前';
    if (d < 86400 * 365) return Math.floor(d / 86400 / 30) + ' 个月前';
    return Math.floor(d / 86400 / 365) + ' 年前';
  }
  function dayCN(ms) { return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10); }
  function confirmBox(title, text, okText) {
    return new Promise(function (resolve) {
      var m = $('modal'); $('modalTitle').textContent = title; $('modalText').textContent = text; $('modalOk').textContent = okText || '确定';
      m.hidden = false; $('modalCancel').focus();
      function done(v) { m.hidden = true; $('modalOk').onclick = $('modalCancel').onclick = m.onclick = null; document.removeEventListener('keydown', esc); resolve(v); }
      function esc(e) { if (e.key === 'Escape') done(false); }
      $('modalOk').onclick = function () { done(true); };
      $('modalCancel').onclick = function () { done(false); };
      m.onclick = function (e) { if (e.target === m) done(false); };
      document.addEventListener('keydown', esc);
    });
  }
  async function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
    if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    var r, j = null;
    try { r = await fetch(path, init); } catch (e) { return { ok: false, status: 0, error: '网络错误，请检查网络后重试' }; }
    try { j = await r.json(); } catch (e) {}
    if (!j) j = { ok: false, error: '服务器出错（HTTP ' + r.status + '）' };
    j.status = r.status;
    if (r.status === 401 && path !== '/api/login') showLogin('登录已过期，请重新登录');
    return j;
  }

  /* ---------- 主题 ---------- */
  function isDark() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t) return t === 'dark';
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function paintThemeButtons() {
    var dark = isDark();
    var b = $('themeBtn'); b.textContent = ''; b.appendChild(icon(dark ? 'sun' : 'moon')); b.appendChild(el('span', null, dark ? '浅色模式' : '深色模式'));
    var m = $('themeBtnM'); m.textContent = ''; m.appendChild(icon(dark ? 'sun' : 'moon')); m.title = dark ? '切换浅色模式' : '切换深色模式';
  }
  function toggleTheme() {
    var next = isDark() ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('af_theme', next); } catch (e) {}
    paintThemeButtons();
  }
  if (window.matchMedia) { var mq = matchMedia('(prefers-color-scheme: dark)'); if (mq.addEventListener) mq.addEventListener('change', paintThemeButtons); }

  /* ---------- 登录 ---------- */
  function showLogin(msg) {
    $('app').hidden = true; $('login').hidden = false;
    $('loginErr').textContent = msg || '';
    setTimeout(function () { $('loginKey').focus(); }, 30);
  }
  function showApp() { $('login').hidden = true; $('app').hidden = false; }
  $('loginForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!$('loginKey').value) { $('loginErr').textContent = '请输入管理密码'; return; }
    var btn = $('loginBtn'); btn.disabled = true; btn.textContent = ''; btn.appendChild(el('span', 'spin')); btn.appendChild(el('span', null, '登录中…'));
    $('loginErr').textContent = '';
    var j = await api('/api/login', { method: 'POST', body: { key: $('loginKey').value } });
    btn.disabled = false; btn.textContent = '登录';
    if (j.ok) { $('loginKey').value = ''; showApp(); reloadAll(); }
    else $('loginErr').textContent = j.error || '登录失败';
  });
  async function logout() {
    if (!(await confirmBox('退出登录', '确定要退出管理后台吗？', '退出'))) return;
    await api('/api/logout', { method: 'POST', body: {} });
    showLogin('已退出登录');
  }

  /* ---------- 统计 ---------- */
  function kpi(label, value, sub, ico, tone) {
    var c = el('div', 'kpi');
    var i = el('div', 'kpi-ico' + (tone ? ' ' + tone : '')); i.appendChild(icon(ico)); c.appendChild(i);
    var b = el('div');
    b.appendChild(el('div', 'kpi-label', label));
    if (value === null) b.appendChild(el('div', 'skel'));
    else b.appendChild(el('div', 'kpi-val', value));
    if (sub) b.appendChild(el('div', 'kpi-sub', sub));
    c.appendChild(b);
    return c;
  }
  function renderKpisLoading() {
    var k = $('kpis'); k.textContent = '';
    [['总反馈', 'layers'], ['未处理', 'alert', 'warn'], ['今日新增', 'today', 'ok'], ['近 7 天', 'trend', 'pink']].forEach(function (x) { k.appendChild(kpi(x[0], null, '', x[1], x[2])); });
  }
  async function loadStats() {
    var j = await api('/api/stats');
    if (!j.ok) { if (j.status !== 401) $('statNote').textContent = '统计加载失败：' + (j.error || ''); return; }
    state.stats = j;
    if (j.siteNames) SITES = j.siteNames;
    fillKinds(j);
    var today = dayCN(Date.now());
    var byDay = {}; j.days.forEach(function (d) { byDay[d.day] = d; });
    var todayN = byDay[today] ? byDay[today].total : 0;
    var week = 0; for (var i = 0; i < 7; i++) { var d = byDay[dayCN(Date.now() - i * 86400000)]; if (d) week += d.total; }
    var k = $('kpis'); k.textContent = '';
    k.appendChild(kpi('总反馈', j.total, j.sites.length + ' 个站点', 'layers'));
    k.appendChild(kpi('未处理', j.open, '已处理 ' + j.done, 'alert', 'warn'));
    k.appendChild(kpi('今日新增', todayN, '北京时间 ' + today.slice(5).replace('-', '/'), 'today', 'ok'));
    k.appendChild(kpi('近 7 天', week, '日均 ' + (week / 7).toFixed(1), 'trend', 'pink'));
    renderNav(j); renderChart(byDay); renderDist(j);
    $('statNote').textContent = j.truncated ? '记录较多，统计只计算了最新 ' + j.counted + ' 条。' : '';
  }
  function fillKinds(j) {
    var fk = $('fKind'); var have = {};
    for (var i = 1; i < fk.options.length; i++) have[fk.options[i].value] = 1;
    KINDS.concat((j.kinds || []).map(function (x) { return x.kind; })).forEach(function (k) {
      if (!k || have[k]) return; have[k] = 1; var o = el('option', null, k); o.value = k; fk.appendChild(o);
    });
  }
  function renderNav(j) {
    var nav = $('siteNav'); nav.textContent = '';
    nav.appendChild(el('div', 'nav-label', '站点'));
    var items = [{ site: '', label: '全部站点', total: j.total, open: j.open }].concat(j.sites);
    items.forEach(function (s) {
      var b = el('button', 'nav-item ' + (s.site ? 's-' + siteKey(s.site) : 's-all')); b.type = 'button';
      b.setAttribute('aria-current', state.site === s.site ? 'true' : 'false');
      b.appendChild(el('span', 'dot'));
      b.appendChild(el('span', 'name', s.label || SITES[s.site] || s.site));
      if (s.open) { var bd = el('span', 'badge', s.open); bd.title = s.open + ' 条未处理'; b.appendChild(bd); }
      b.appendChild(el('span', 'count', s.total));
      b.addEventListener('click', function () { setSite(s.site); });
      nav.appendChild(b);
    });
  }
  function renderDist(j) {
    var box = $('dist'); box.textContent = '';
    if (!j.sites.length) { box.appendChild(el('p', 'muted small', '暂无数据')); return; }
    var max = Math.max.apply(null, j.sites.map(function (s) { return s.total; }));
    j.sites.forEach(function (s) {
      var r = el('button', 'dist-row s-' + siteKey(s.site)); r.type = 'button';
      r.title = (s.label || s.site) + '：' + s.total + ' 条，未处理 ' + s.open;
      r.appendChild(el('span', null, s.label || s.site));
      var bar = el('span', 'dist-bar'); var fill = el('i'); fill.style.width = Math.max(3, Math.round(s.total / max * 100)) + '%'; bar.appendChild(fill);
      r.appendChild(bar); r.appendChild(el('b', null, s.total));
      r.addEventListener('click', function () { setSite(s.site); });
      box.appendChild(r);
    });
  }
  var lastByDay = null, rzTimer;
  window.addEventListener('resize', function () { clearTimeout(rzTimer); rzTimer = setTimeout(function () { if (lastByDay && !$('app').hidden) renderChart(lastByDay); }, 150); });
  function renderChart(byDay) {
    var box = $('chart'); box.textContent = '';
    var days = [];
    for (var i = 29; i >= 0; i--) { var d = dayCN(Date.now() - i * 86400000); days.push({ day: d, n: byDay[d] ? byDay[d].total : 0 }); }
    var sum = days.reduce(function (a, b) { return a + b.n; }, 0);
    $('chartLegend').textContent = '共 ' + sum + ' 条';
    lastByDay = byDay;
    var W = Math.max(260, Math.round(box.clientWidth || 600)), H = Math.max(120, Math.round(box.clientHeight || 170)), L = 26, B = 20, T = 8;
    var every = W < 420 ? 7 : 5;
    var max = Math.max(4, Math.max.apply(null, days.map(function (d) { return d.n; })));
    var step = Math.ceil(max / 4); max = step * 4;
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H });
    for (var g = 0; g <= 4; g++) {
      var y = T + (H - T - B) * (1 - g / 4);
      svg.appendChild(svgEl('line', { x1: L, x2: W, y1: y, y2: y, class: 'grid' }));
      var t = svgEl('text', { x: L - 6, y: y + 3, 'text-anchor': 'end', class: 'axis' }); t.textContent = String(step * g); svg.appendChild(t);
    }
    var bw = (W - L) / days.length;
    var tip = el('div', 'chart-tip'); tip.hidden = true;
    var pts = [];
    days.forEach(function (d, i) {
      var h = (H - T - B) * d.n / max, x = L + i * bw;
      pts.push([x + bw / 2, H - B - h]);
      var r = svgEl('rect', { x: x + bw * 0.18, y: H - B - h, width: bw * 0.64, height: Math.max(h, d.n ? 2 : 0), rx: 2, class: 'bar' + (i === days.length - 1 ? ' today' : '') });
      var hit = svgEl('rect', { x: x, y: T, width: bw, height: H - T - B, fill: 'transparent', class: 'barhit' });
      hit.addEventListener('mouseenter', function () {
        tip.textContent = d.day.slice(5) + '：' + d.n + ' 条'; tip.hidden = false;
        tip.style.left = ((x + bw / 2) / W * 100) + '%'; tip.style.top = ((H - B - h) / H * 100) + '%';
      });
      hit.addEventListener('mouseleave', function () { tip.hidden = true; });
      svg.appendChild(hit); svg.appendChild(r);
      if ((days.length - 1 - i) % every === 0) { var lt = svgEl('text', { x: x + bw / 2, y: H - 5, 'text-anchor': 'middle', class: 'axis' }); lt.textContent = d.day.slice(5).replace('-', '/'); svg.appendChild(lt); }
    });
    var line = 'M' + pts.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' L');
    svg.insertBefore(svgEl('path', { d: line + ' L' + pts[pts.length - 1][0] + ' ' + (H - B) + ' L' + pts[0][0] + ' ' + (H - B) + ' Z', class: 'area' }), svg.firstChild);
    svg.appendChild(svgEl('path', { d: line, class: 'line' }));
    box.appendChild(svg); box.appendChild(tip);
  }

  /* ---------- 列表 ---------- */
  function setSite(s) {
    state.site = s;
    $('pageTitle').textContent = s ? (SITES[s] || s) + ' 反馈' : '全部反馈';
    $('pageSub').textContent = s ? '只看来自「' + (SITES[s] || s) + '」的反馈' : '所有站点的用户反馈';
    document.querySelectorAll('.nav-item').forEach(function (b) { b.setAttribute('aria-current', 'false'); });
    var cur = document.querySelector('.nav-item.' + (s ? 's-' + siteKey(s) : 's-all')); if (cur) cur.setAttribute('aria-current', 'true');
    loadPage(true);
  }
  function seg(id, onChange) {
    var g = $(id);
    g.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      g.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-checked', x === b ? 'true' : 'false'); });
      onChange(b.getAttribute('data-v'));
    });
  }
  function query() {
    var p = new URLSearchParams();
    if (state.site) p.set('site', state.site);
    if ($('fKind').value) p.set('kind', $('fKind').value);
    if (state.status) p.set('status', state.status);
    if ($('fQ').value.trim()) p.set('q', $('fQ').value.trim());
    p.set('order', state.order);
    p.set('limit', '20');
    if (state.cursor) p.set('cursor', state.cursor);
    return '/api/feedback?' + p.toString();
  }
  function skeletons() {
    var f = document.createDocumentFragment();
    for (var i = 0; i < 3; i++) {
      var c = el('div', 'sk-card');
      [['30%', 22], ['92%', 14], ['70%', 14], ['45%', 12]].forEach(function (x) { var s = el('div', 'skel'); s.style.width = x[0]; s.style.height = x[1] + 'px'; c.appendChild(s); });
      f.appendChild(c);
    }
    return f;
  }
  function stateBox(kind, title, text, btnText, onBtn) {
    var s = el('div', 'state' + (kind === 'error' ? ' error' : ''));
    var i = el('div', 'state-ico'); i.appendChild(icon(kind === 'error' ? 'alert' : 'inbox')); s.appendChild(i);
    s.appendChild(el('h3', null, title)); s.appendChild(el('p', null, text));
    if (btnText) { var b = el('button', 'btn', btnText); b.type = 'button'; b.addEventListener('click', onBtn); s.appendChild(b); }
    return s;
  }
  async function loadPage(reset) {
    var my = ++state.seq;
    if (reset) { state.cursor = null; $('list').textContent = ''; $('listState').textContent = ''; $('list').appendChild(skeletons()); $('moreBtn').hidden = true; $('listNote').textContent = ''; }
    state.loading = true; $('moreBtn').disabled = true; $('moreBtn').textContent = '加载中…';
    var j = await api(query());
    if (my !== state.seq) return; // 已有更新的请求
    state.loading = false; $('moreBtn').disabled = false; $('moreBtn').textContent = '加载更多';
    if (reset) $('list').textContent = '';
    if (!j.ok) {
      if (j.status !== 401) { $('listState').textContent = ''; $('listState').appendChild(stateBox('error', '加载失败', j.error || '请稍后重试', '重试', function () { loadPage(true); })); }
      return;
    }
    j.items.forEach(function (it) { $('list').appendChild(card(it)); });
    state.cursor = j.cursor; state.total = j.total; state.more = j.more;
    $('moreBtn').hidden = !j.more;
    checkEmpty();
    updateNote();
  }
  function checkEmpty() {
    var box = $('listState'); box.textContent = '';
    if ($('list').querySelector('.fb')) return;
    var filtered = state.site || state.status || $('fKind').value || $('fQ').value.trim();
    if (state.more) box.appendChild(stateBox('empty', '这一批里没有匹配的反馈', '点击「加载更多」继续往后找'));
    else if (filtered) box.appendChild(stateBox('empty', '没有找到匹配的反馈', '换个关键词或筛选条件试试', '清除筛选', clearFilters));
    else box.appendChild(stateBox('empty', '还没有反馈', '用户提交反馈后会出现在这里'));
  }
  function clearFilters() {
    $('fQ').value = ''; $('fKind').value = ''; state.status = '';
    $('segStatus').querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-checked', x.getAttribute('data-v') === '' ? 'true' : 'false'); });
    setSite('');
  }
  function updateNote() { $('listNote').textContent = '全部站点共 ' + state.total + ' 条反馈' + (state.more ? ' · 下滑加载更多' : ' · 已全部显示'); }

  function metaItem(ic, text, title) { var s = el('span'); s.appendChild(icon(ic)); s.appendChild(el('span', null, text)); if (title) s.title = title; return s; }
  function card(it) {
    var sk = siteKey(it.site);
    var d = el('article', 'fb s-' + sk + (it.status === 'done' ? ' done' : ''));
    var head = el('div', 'fb-head');
    head.appendChild(el('span', 'chip site', it.siteLabel || SITES[sk] || it.site));
    if (it.kind) head.appendChild(el('span', 'chip kind', it.kind));
    head.appendChild(el('span', 'chip st-' + it.status, it.status === 'done' ? '已处理' : '未处理'));
    var tm = el('span', 'fb-time');
    if (it.time) { tm.appendChild(el('b', null, fmtRel(it.time))); tm.appendChild(document.createTextNode(' · ' + fmtAbs(it.time))); tm.title = '北京时间 ' + fmtAbs(it.time); }
    else tm.textContent = '时间未知';
    head.appendChild(tm);
    d.appendChild(head);
    d.appendChild(el('div', 'fb-msg' + (it.message ? '' : ' empty'), it.message || '（没有填写内容）'));
    if (it.link) {
      var lk = el('div', 'fb-link'); lk.appendChild(icon('link'));
      var ls = el('span', null, it.link); ls.title = it.link; lk.appendChild(ls);
      var cp = el('button', 'copy'); cp.type = 'button'; cp.title = '复制链接'; cp.setAttribute('aria-label', '复制链接'); cp.appendChild(icon('copy'));
      cp.addEventListener('click', function () {
        if (navigator.clipboard) navigator.clipboard.writeText(it.link).then(function () { toast('已复制链接'); }, function () { toast('复制失败'); });
      });
      lk.appendChild(cp); d.appendChild(lk);
    }
    if (it.attachments && it.attachments.length) {
      var atts = el('div', 'atts');
      it.attachments.forEach(function (a) {
        var src = '/api/file?key=' + encodeURIComponent(a.key);
        var box;
        if (/^image\/(png|jpe?g|pjpeg|gif|webp|heic|heif|avif|bmp)$/i.test(a.type)) {
          box = el('a', 'att'); box.href = src; box.target = '_blank'; box.rel = 'noopener noreferrer'; box.title = (a.name || '图片') + '（点击查看原图）';
          var img = el('img'); img.src = src; img.alt = a.name || '图片附件'; img.loading = 'lazy'; box.appendChild(img);
        } else if (/^video\//i.test(a.type)) {
          box = el('div', 'att video-box');
          var v = el('video'); v.src = src; v.controls = true; v.preload = 'metadata'; v.setAttribute('playsinline', ''); box.appendChild(v);
        } else {
          box = el('a', 'att file'); box.href = src; box.setAttribute('download', a.name || 'attachment'); box.rel = 'noopener noreferrer';
          box.appendChild(icon('file')); box.appendChild(el('span', null, a.name || '下载附件'));
        }
        atts.appendChild(box);
      });
      d.appendChild(atts);
    }
    var foot = el('div', 'fb-foot');
    var meta = el('div', 'meta');
    if (it.contact) meta.appendChild(metaItem('user', it.contact, '联系方式'));
    var g = it.geo || {}; var geo = [g.country, g.region, g.city].filter(Boolean).join(' · ');
    if (it.ip || geo) meta.appendChild(metaItem('pin', [it.ip, geo].filter(Boolean).join('  '), 'IP / 地区'));
    if (it.page) meta.appendChild(metaItem('globe', it.page.replace(/^https?:\/\//, ''), '来源页面：' + it.page));
    meta.appendChild(metaItem('hash', it.id, '编号'));
    if (it.status === 'done' && it.handledAt) meta.appendChild(metaItem('check', '处理于 ' + fmtAbs(it.handledAt)));
    foot.appendChild(meta);
    var acts = el('div', 'fb-actions');
    var done = it.status === 'done';
    var mark = el('button', 'icon-btn sm' + (done ? ' ok-on' : '')); mark.type = 'button';
    mark.title = done ? '标为未处理' : '标为已处理'; mark.setAttribute('aria-label', mark.title); mark.setAttribute('aria-pressed', done ? 'true' : 'false');
    mark.appendChild(icon(done ? 'undo' : 'check'));
    mark.addEventListener('click', async function () {
      mark.disabled = true;
      var want = done ? 'open' : 'done';
      var j = await api('/api/status', { method: 'POST', body: { id: it.id, status: want } });
      mark.disabled = false;
      if (!j.ok) { if (j.status !== 401) toast('操作失败：' + (j.error || '')); return; }
      it.status = want; it.handledAt = want === 'done' ? Date.now() : 0;
      d.replaceWith(card(it));
      toast(want === 'done' ? '已标为已处理' : '已标为未处理');
      loadStats();
    });
    var del = el('button', 'icon-btn sm danger'); del.type = 'button'; del.title = '删除'; del.setAttribute('aria-label', '删除这条反馈');
    del.appendChild(icon('trash'));
    del.addEventListener('click', async function () {
      if (!(await confirmBox('删除这条反馈？', '附件会一起删除，删除后无法恢复。', '删除'))) return;
      del.disabled = true;
      var j = await api('/api/feedback', { method: 'DELETE', body: { id: it.id } });
      del.disabled = false;
      if (!j.ok) { if (j.status !== 401) toast('删除失败：' + (j.error || '')); return; }
      d.remove();
      state.total = Math.max(0, (state.total || 1) - 1); updateNote(); checkEmpty();
      toast('已删除' + (j.files ? '（含 ' + j.files + ' 个附件）' : '') + (j.fileErrors ? '，有 ' + j.fileErrors + ' 个附件没删掉' : ''));
      loadStats();
    });
    acts.appendChild(mark); acts.appendChild(del);
    foot.appendChild(acts);
    d.appendChild(foot);
    return d;
  }

  function reloadAll() { renderKpisLoading(); loadStats(); loadPage(true); }
  var qTimer;
  $('fQ').addEventListener('input', function () { clearTimeout(qTimer); qTimer = setTimeout(function () { loadPage(true); }, 350); });
  $('fQ').addEventListener('keydown', function (e) { if (e.key === 'Enter') { clearTimeout(qTimer); loadPage(true); } });
  $('fKind').addEventListener('change', function () { loadPage(true); });
  seg('segStatus', function (v) { state.status = v; loadPage(true); });
  seg('segOrder', function (v) { state.order = v; loadPage(true); });
  $('moreBtn').addEventListener('click', function () { loadPage(false); });
  $('refreshBtn').appendChild(icon('refresh'));
  $('refreshBtn').addEventListener('click', function () { reloadAll(); toast('已刷新'); });
  $('logoutBtnM').appendChild(icon('logout'));
  $('logoutBtnM').addEventListener('click', logout);
  var lb = $('logoutBtn'); lb.appendChild(icon('logout')); lb.appendChild(el('span', null, '退出登录')); lb.addEventListener('click', logout);
  $('themeBtn').addEventListener('click', toggleTheme);
  $('themeBtnM').addEventListener('click', toggleTheme);
  document.querySelector('.search-ico').appendChild(icon('search'));
  paintThemeButtons();

  api('/api/me').then(function (j) {
    if (j.ok && j.admin) { showApp(); reloadAll(); }
    else showLogin(j.ok && j.configured === false ? '本站还没配置管理密码' : '');
  });
})();
