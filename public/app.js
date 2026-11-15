// 统一反馈后台前端：用户提交的内容一律用 textContent / 属性赋值渲染，不拼 HTML
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var SVGNS = 'http://www.w3.org/2000/svg';
  var KINDS = ['解析失败', '下载失败', '还有水印', '视频有问题', '图片有问题', '其他'];
  var SITE_KEYS = ['douyin', 'xiaohongshu', 'bilibili', 'youtube', 'tiktok', 'kuaishou', 'weibo', 'deepseek', 'zhijia', 'brake', 'other'];
  var SITES = { douyin: '抖音', xiaohongshu: '小红书', bilibili: 'B站', youtube: 'YouTube', tiktok: 'TikTok', kuaishou: '快手', weibo: '微博', deepseek: 'DeepSeek', zhijia: '智驾模拟器', brake: '刹车模拟器', other: '其他' };
  var state = { cursor: null, loading: false, site: '', status: '', order: 'desc', total: 0, more: false, stats: null, seq: 0, view: 'fb', pfSite: '', pfRange: 30, pf: null, pfSeq: 0 };
  var PF_SITES = ['douyin', 'xiaohongshu', 'bilibili', 'youtube', 'tiktok', 'kuaishou', 'weibo'];

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
    download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
    broken: 'M2 2l20 20M10.41 10.41a2 2 0 1 1-2.83-2.83M21 15l-3.09-3.09M13.5 13.5L6 21M3 3a2 2 0 0 0-1 1.73V19a2 2 0 0 0 2 2h14.27M21 16V5a2 2 0 0 0-2-2H8',
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
  function fmtCN(ms) { return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' '); }

  /* ---------- 复制 ---------- */
  function copyFallback(text) {
    var ta = el('textarea'); ta.value = text; ta.setAttribute('readonly', '');
    ta.className = 'clip-ta';
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }
  function copyText(text, okMsg) {
    var done = function (ok) { toast(ok ? (okMsg || '已复制') : '复制失败，请手动选择文字复制'); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(copyFallback(text)); });
    } else done(copyFallback(text));
  }
  function summaryText(it) {
    var sk = siteKey(it.site);
    var g = it.geo || {}; var geo = [g.country, g.region, g.city].filter(Boolean).join(' · ');
    var ipLine = it.ip ? it.ip + (geo ? '（' + geo + '）' : '') : geo;
    var rows = [
      ['站点', it.siteLabel || SITES[sk] || it.site],
      ['时间', it.time ? fmtCN(it.time) + '（北京时间）' : ''],
      ['类型', it.kind],
      ['状态', it.status === 'done' ? '已处理' + (it.handledAt ? '（' + fmtCN(it.handledAt) + '）' : '') : '未处理'],
      ['内容', it.message],
      ['链接', it.link],
      ['联系方式', it.contact],
      ['来源页面', it.page],
      ['IP / 地区', ipLine],
      ['UA', it.ua],
      ['附件', (it.attachments || []).map(function (a) { return a.name || a.key.split('/').pop(); }).join('、')],
      ['编号', it.id],
    ];
    return rows.filter(function (r) { return r[1] != null && String(r[1]).trim() !== ''; })
      .map(function (r) { var v = String(r[1]); return r[0] + '：' + (v.indexOf('\n') >= 0 ? '\n' + v : v); }).join('\n');
  }

  /* ---------- 附件下载 ---------- */
  function fileUrl(a, download) {
    var u = '/api/file?key=' + encodeURIComponent(a.key);
    if (download) u += '&download=1&name=' + encodeURIComponent(a.name || a.key.split('/').pop());
    return u;
  }
  // 只取 1 个字节探测文件是否还在，避免把 404 页面当成文件保存
  async function probeFile(a) {
    try {
      var r = await fetch(fileUrl(a), { credentials: 'same-origin', cache: 'no-store', headers: { Range: 'bytes=0-0' } });
      try { if (r.body && r.body.cancel) r.body.cancel(); } catch (e) {}
      if (r.status === 401) showLogin('登录已过期，请重新登录');
      return r.status === 416 ? 200 : r.status;
    } catch (e) { return 0; }
  }
  function triggerDownload(a) {
    var x = el('a'); x.href = fileUrl(a, true); // 文件名以服务端 Content-Disposition 为准（扩展名按真实类型）
    x.setAttribute('download', ''); x.rel = 'noopener';
    x.hidden = true; document.body.appendChild(x); x.click(); setTimeout(function () { x.remove(); }, 1000);
  }
  function probeMsg(st) { return st === 404 ? '文件不存在' : st === 401 ? '登录已过期' : st === 0 ? '网络错误，下载失败' : '下载失败（HTTP ' + st + '）'; }
  // 返回 true 表示已开始下载
  async function downloadOne(a, onMissing) {
    var st = await probeFile(a);
    if (st >= 200 && st < 300) { triggerDownload(a); return true; }
    if (st === 404 && onMissing) onMissing();
    return st;
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
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
    if (state.view === 'fb') renderNav(j);
    renderDist(j); renderChart(byDay);
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
  /* ---------- 最近 30 天图表：按站点堆叠的柱状图 ---------- */
  // 尺寸跟着容器走：ResizeObserver 监听 #chart，容器变大变小（面板被各站分布撑高、侧边栏收起、横竖屏）都会重画；
  // 容器还没显示（宽度为 0）时不画，等显示后 ResizeObserver 会再触发一次。
  // 反馈图（#chart）和解析失败图（#pfChart）共用同一套画法：makeStackChart 返回 render(byDay, order)
  function makeStackChart(boxId, legendId, words) {
    var lastByDay = null, lastOrder = [], raf = 0;
    function schedule() {
      if (!lastByDay) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () { draw(lastByDay, lastOrder); });
    }
    if (window.ResizeObserver) new ResizeObserver(schedule).observe($(boxId));
    else window.addEventListener('resize', schedule);
    function draw(byDay, order) {
      lastByDay = byDay; lastOrder = order || [];
      drawStack($(boxId), $(legendId), byDay, lastOrder, words);
    }
    return draw;
  }
  var WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  function niceTicks(maxN) {
    // 整数刻度，最多约 5 格；顶部留一格余量，数据少（比如最多 3 条）时就是 0,1,2,3,4
    var steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
    var step = steps[steps.length - 1];
    for (var i = 0; i < steps.length; i++) if (maxN / steps[i] <= 4) { step = steps[i]; break; }
    var top = (Math.floor(maxN / step) + 1) * step;
    var out = []; for (var v = 0; v <= top; v += step) out.push(v);
    return out;
  }
  function drawStack(box, legend, byDay, order, words) {
    var W = Math.round(box.clientWidth), H = Math.round(box.clientHeight);
    if (!W || !H) return; // 还没显示，等 ResizeObserver
    box.textContent = '';
    // 站点堆叠顺序：和右侧分布一致（总数多的在下面）
    var days = [];
    for (var i = 29; i >= 0; i--) {
      var d = dayCN(Date.now() - i * 86400000), rec = byDay[d] || { total: 0, sites: {} };
      var parts = [];
      order.forEach(function (k) { if (rec.sites && rec.sites[k]) parts.push({ site: k, n: rec.sites[k] }); });
      Object.keys(rec.sites || {}).forEach(function (k) { if (order.indexOf(k) < 0 && rec.sites[k]) parts.push({ site: k, n: rec.sites[k] }); });
      days.push({ day: d, n: rec.total || 0, parts: parts, today: i === 0 });
    }
    var sum = days.reduce(function (a, b) { return a + b.n; }, 0);
    legend.textContent = '共 ' + sum + ' ' + words.unit;
    var ticks = niceTicks(Math.max.apply(null, days.map(function (x) { return x.n; })));
    var top = ticks[ticks.length - 1];
    // 边距：左边给 y 轴数字，右边留够最后一个日期标签（今天）的一半宽度，柱子和标签都不会被裁掉
    var L = 10 + String(top).length * 7, R = 16, T = 10, B = 22;
    var x0 = L + 6, x1 = W - R, plotH = H - T - B, baseY = H - B;
    var slot = (x1 - x0) / days.length, bw = Math.min(28, Math.max(3, slot * 0.62));
    var yOf = function (v) { return baseY - plotH * v / top; };
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H });
    var defs = svgEl('defs', {}); svg.appendChild(defs);
    ticks.forEach(function (v) {
      var y = Math.round(yOf(v)) + 0.5;
      svg.appendChild(svgEl('line', { x1: x0 - 4, x2: x1, y1: y, y2: y, class: 'grid' + (v === 0 ? ' base' : '') }));
      var t = svgEl('text', { x: L, y: y + 3.5, 'text-anchor': 'end', class: 'axis' }); t.textContent = String(v); svg.appendChild(t);
    });
    // 日期标签：从今天往前每隔 k 天一个，k 按柱宽算，保证标签之间至少 44px，不重叠
    var minGap = 44, kSteps = [1, 2, 3, 5, 7, 10, 15], k = 15;
    for (var s2 = 0; s2 < kSteps.length; s2++) if (kSteps[s2] * slot >= minGap) { k = kSteps[s2]; break; }
    var cols = svgEl('g', { class: 'cols' }), bars = svgEl('g', { class: 'bars' }), hits = svgEl('g', { class: 'hits' });
    svg.appendChild(cols); svg.appendChild(bars);
    days.forEach(function (d, i) {
      var cx = x0 + slot * (i + 0.5), bx = cx - bw / 2;
      d.cx = cx;
      cols.appendChild(svgEl('rect', { x: x0 + slot * i, y: T, width: slot, height: plotH, class: 'col', 'data-i': i }));
      if (d.n) {
        var hTot = baseY - yOf(d.n);
        var cid = box.id + '-c' + i;
        var cp = svgEl('clipPath', { id: cid });
        cp.appendChild(svgEl('rect', { x: bx, y: baseY - hTot, width: bw, height: hTot + 4, rx: Math.min(3, bw / 2) }));
        defs.appendChild(cp);
        var g = svgEl('g', { 'clip-path': 'url(#' + cid + ')' });
        var acc = 0;
        d.parts.forEach(function (pt) {
          var y1 = yOf(acc), y2 = yOf(acc + pt.n); acc += pt.n;
          g.appendChild(svgEl('rect', { x: bx, y: y2, width: bw, height: Math.max(0.5, y1 - y2), class: 'seg s-' + siteKey(pt.site) }));
        });
        if (acc < d.n) { var yA = yOf(acc), yB = yOf(d.n); g.appendChild(svgEl('rect', { x: bx, y: yB, width: bw, height: yA - yB, class: 'seg s-other' })); }
        d.topY = baseY - hTot;
        bars.appendChild(g);
      } else d.topY = baseY;
      if ((days.length - 1 - i) % k === 0) {
        var lt = svgEl('text', { x: cx, y: H - 6, 'text-anchor': 'middle', class: 'axis' + (d.today ? ' today' : '') });
        lt.textContent = d.today ? '今天' : d.day.slice(5).replace('-', '/');
        svg.appendChild(lt);
      }
      // 透明的鼠标感应区放在最上层，柱子不会挡住它
      hits.appendChild(svgEl('rect', { x: x0 + slot * i, y: 0, width: slot, height: H, class: 'hit', 'data-i': i }));
    });
    svg.appendChild(hits);
    var tip = el('div', 'chart-tip'); tip.hidden = true;
    var cur = -1;
    function show(i) {
      if (i === cur) return; cur = i;
      var d = days[i];
      var colEls = cols.children; for (var c = 0; c < colEls.length; c++) colEls[c].classList.toggle('on', c === i);
      tip.textContent = '';
      var dt = new Date(d.day + 'T00:00:00Z');
      tip.appendChild(el('div', 'tip-date', (d.today ? '今天 · ' : '') + d.day.slice(5).replace('-', '月') + '日 周' + WEEK[dt.getUTCDay()]));
      tip.appendChild(el('div', 'tip-total', d.n ? '合计 ' + d.n + ' ' + words.unit : words.none));
      d.parts.slice().sort(function (a, b) { return b.n - a.n; }).forEach(function (pt) {
        var row = el('div', 'tip-row s-' + siteKey(pt.site));
        row.appendChild(el('span', 'tip-dot'));
        row.appendChild(el('span', 'tip-name', SITES[pt.site] || pt.site));
        row.appendChild(el('b', null, pt.n));
        tip.appendChild(row);
      });
      tip.hidden = false;
      // 先放进去量尺寸，再左右夹在图表范围内；放在柱子顶部上方，太靠上时贴着图表顶部
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      var left = Math.min(Math.max(d.cx - tw / 2, 0), W - tw);
      var topPx = Math.max(d.topY - th - 8, -th / 2);
      tip.style.left = Math.round(left) + 'px';
      tip.style.top = Math.round(topPx) + 'px';
    }
    function hide() { cur = -1; tip.hidden = true; var colEls = cols.children; for (var c = 0; c < colEls.length; c++) colEls[c].classList.remove('on'); }
    hits.addEventListener('pointerover', function (e) { var i = e.target.getAttribute && e.target.getAttribute('data-i'); if (i !== null) show(Number(i)); });
    hits.addEventListener('pointerdown', function (e) { var i = e.target.getAttribute && e.target.getAttribute('data-i'); if (i !== null) show(Number(i)); });
    svg.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hide(); });
    box.appendChild(svg); box.appendChild(tip);
  }

  var feedbackChart = makeStackChart('chart', 'chartLegend', { unit: '条', none: '没有反馈' });
  function renderChart(byDay) {
    feedbackChart(byDay, state.stats && state.stats.sites ? state.stats.sites.map(function (x) { return x.site; }) : []);
  }

  /* ---------- 列表 ---------- */
  function setSiteTitle() {
    var s = state.site;
    $('pageTitle').textContent = s ? (SITES[s] || s) + ' 反馈' : '全部反馈';
    $('pageSub').textContent = s ? '只看来自「' + (SITES[s] || s) + '」的反馈' : '所有站点的用户反馈';
  }
  function setSite(s) {
    state.site = s;
    setSiteTitle();
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

  function attachment(a) {
    var src = fileUrl(a);
    var name = a.name || a.key.split('/').pop();
    var wrap = el('div', 'att-item');
    var box, media = null;
    var isImg = /^image\/(png|jpe?g|pjpeg|gif|webp|heic|heif|avif|bmp)$/i.test(a.type), isVid = /^video\//i.test(a.type);
    if (isImg) {
      box = el('a', 'att'); box.href = src; box.target = '_blank'; box.rel = 'noopener noreferrer'; box.title = name + '（点击查看原图）';
      media = el('img'); media.src = src; media.alt = name; media.loading = 'lazy'; box.appendChild(media);
    } else if (isVid) {
      box = el('div', 'att video-box'); wrap.classList.add('is-video');
      media = el('video'); media.src = src; media.controls = true; media.preload = 'metadata'; media.setAttribute('playsinline', ''); box.appendChild(media);
    } else {
      box = el('a', 'att file'); box.href = fileUrl(a, true); box.setAttribute('download', ''); box.rel = 'noopener noreferrer'; box.title = name;
      box.appendChild(icon('file')); box.appendChild(el('span', null, name));
    }
    wrap.appendChild(box);
    function setMissing(text) {
      if (wrap.classList.contains('missing')) return;
      wrap.classList.add('missing');
      var m = el('div', 'att att-missing' + (isVid ? ' video-box' : '')); m.title = name + '：' + text;
      m.appendChild(icon('broken')); m.appendChild(el('span', 'am-t', text)); m.appendChild(el('span', 'am-n', name));
      box.replaceWith(m); box = m;
    }
    wrap._missing = function () { setMissing('附件已丢失'); };
    if (media) {
      var onErr = async function () {
        var st = await probeFile(a);
        if (st === 404) setMissing('附件已丢失');
        else if (st !== 401 && !(st >= 200 && st < 300)) setMissing('无法加载');
        else if (st >= 200 && st < 300 && isImg) setMissing('无法预览');
      };
      media.addEventListener('error', onErr);
    }
    var dl = el('button', 'att-dl'); dl.type = 'button'; dl.title = '下载原文件：' + name; dl.setAttribute('aria-label', '下载 ' + name);
    dl.appendChild(icon('download'));
    dl.addEventListener('click', async function (e) {
      e.preventDefault(); e.stopPropagation();
      dl.disabled = true;
      var r = await downloadOne(a, wrap._missing);
      dl.disabled = false;
      if (r === true) toast('开始下载：' + name);
      else if (r !== 401) toast(probeMsg(r));
    });
    wrap.appendChild(dl);
    return wrap;
  }
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
        copyText(it.link, '已复制链接');
      });
      lk.appendChild(cp); d.appendChild(lk);
    }
    var attList = it.attachments || [];
    if (attList.length) {
      var atts = el('div', 'atts');
      attList.forEach(function (a) { atts.appendChild(attachment(a)); });
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
    var cpy = el('button', 'act-btn'); cpy.type = 'button'; cpy.title = '复制这条反馈的全部信息'; cpy.setAttribute('aria-label', '复制这条反馈的信息');
    cpy.appendChild(icon('copy')); cpy.appendChild(el('span', null, '复制'));
    cpy.addEventListener('click', function () { copyText(summaryText(it), '已复制'); });
    acts.appendChild(cpy);
    if (attList.length >= 2) {
      var all = el('button', 'act-btn'); all.type = 'button'; all.title = '逐个下载全部 ' + attList.length + ' 个附件';
      all.appendChild(icon('download')); all.appendChild(el('span', null, '下载全部'));
      all.addEventListener('click', async function () {
        all.disabled = true;
        var ok = 0, missing = 0, fail = 0, boxes = d.querySelectorAll('.att-item');
        for (var i = 0; i < attList.length; i++) {
          var b = boxes[i];
          toast('正在下载 ' + (i + 1) + ' / ' + attList.length + '…');
          var r = await downloadOne(attList[i], function () { if (b && b._missing) b._missing(); });
          if (r === true) { ok++; await wait(900); } else if (r === 404) missing++; else { fail++; if (r === 401) break; }
        }
        all.disabled = false;
        toast(ok ? '已开始下载 ' + ok + ' 个文件' + (missing ? '，' + missing + ' 个文件不存在' : '') + (fail ? '，' + fail + ' 个失败' : '')
          : (missing && !fail ? '文件不存在' : '下载失败'));
      });
      acts.appendChild(all);
    }
    acts.appendChild(mark); acts.appendChild(del);
    foot.appendChild(acts);
    d.appendChild(foot);
    return d;
  }


  /* ---------- 解析失败（只读） ---------- */
  var pfChart = makeStackChart('pfChart', 'pfChartLegend', { unit: '次', none: '没有失败' });
  function setView(v) {
    state.view = v;
    $('segView').querySelectorAll('button').forEach(function (x) { var on = x.getAttribute('data-v') === v; x.setAttribute('aria-checked', on ? 'true' : 'false'); x.setAttribute('aria-selected', on ? 'true' : 'false'); });
    $('fbView').hidden = v !== 'fb';
    $('pfView').hidden = v !== 'pf';
    try { history.replaceState(null, '', v === 'pf' ? '#failures' : location.pathname); } catch (e) {}
    if (v === 'pf') { pfTitle(); if (state.pf) renderPf(state.pf); loadPf(); }
    else { setSiteTitle(); if (state.stats) renderNav(state.stats); }
  }
  function pfTitle() {
    var s = state.pfSite;
    $('pageTitle').textContent = s ? (SITES[s] || s) + ' 解析失败' : '解析失败';
    $('pageSub').textContent = s ? '只看「' + (SITES[s] || s) + '」解析站的失败记录' : '各解析站解析失败的自动记录（不是用户提交的反馈）';
  }
  function setPfSite(s) {
    state.pfSite = s; pfTitle();
    document.querySelectorAll('.nav-item').forEach(function (b) { b.setAttribute('aria-current', b.getAttribute('data-site') === s ? 'true' : 'false'); });
    loadPf();
  }
  function renderPfKpisLoading() {
    var k = $('pfKpis'); k.textContent = '';
    ['今日失败', '近 7 天', '近 30 天', '失败最多'].forEach(function (x) { k.appendChild(kpi(x, null, '', 'alert')); });
  }
  async function loadPf() {
    var my = ++state.pfSeq;
    if (!state.pf) renderPfKpisLoading();
    var q = '/api/failures?days=' + state.pfRange + (state.pfSite ? '&site=' + encodeURIComponent(state.pfSite) : '');
    var j = await api(q);
    if (my !== state.pfSeq) return;
    if (!j.ok) {
      if (j.status !== 401) { var b = $('pfSamples'); b.textContent = ''; b.appendChild(stateBox('error', '加载失败', j.error || '请稍后重试', '重试', loadPf)); }
      return;
    }
    state.pf = j;
    if (state.view === 'pf') renderPf(j);
  }
  function renderPf(j) {
    if (j.siteNames) SITES = j.siteNames;
    var all = j.sites || [];
    var sel = state.pfSite ? all.filter(function (x) { return x.site === state.pfSite; }) : all;
    var sum = function (k) { return sel.reduce(function (a, x) { return a + (x[k] || 0); }, 0); };
    var worst = all.filter(function (x) { return x.n30 > 0; })[0];
    var k = $('pfKpis'); k.textContent = '';
    k.appendChild(kpi('今日失败', sum('today'), '北京时间 ' + dayCN(Date.now()).slice(5).replace('-', '/'), 'alert'));
    k.appendChild(kpi('近 7 天', sum('n7'), '日均 ' + (sum('n7') / 7).toFixed(1), 'trend'));
    k.appendChild(kpi('近 30 天', sum('n30'), (state.pfSite ? '' : all.filter(function (x) { return x.n30; }).length + ' 个平台有失败'), 'layers'));
    k.appendChild(kpi('失败最多', worst ? worst.label : '—', worst ? '30 天 ' + worst.n30 + ' 次' : '最近 30 天没有失败', 'alert'));
    renderPfNav(j);
    // 图表：按天堆叠
    var byDay = {}; (j.days || []).forEach(function (d) { byDay[d.day] = d; });
    var order = all.map(function (x) { return x.site; });
    pfChart(byDay, order);
    // 各平台
    var dist = $('pfDist'); dist.textContent = '';
    var key = state.pfRange === 7 ? 'n7' : 'n30';
    var rows = all.filter(function (x) { return x[key] > 0 || PF_SITES.indexOf(x.site) < 6; });
    var max = Math.max.apply(null, [1].concat(rows.map(function (x) { return x[key]; })));
    rows.forEach(function (x) {
      var r = el('button', 'dist-row s-' + siteKey(x.site) + (state.pfSite && state.pfSite !== x.site ? ' dim' : '')); r.type = 'button';
      r.title = x.label + '：近 7 天 ' + x.n7 + ' 次，近 30 天 ' + x.n30 + ' 次';
      r.appendChild(el('span', null, x.label));
      var bar = el('span', 'dist-bar'); var f = el('i'); f.style.width = (x[key] ? Math.max(3, Math.round(x[key] / max * 100)) : 0) + '%'; bar.appendChild(f);
      r.appendChild(bar); r.appendChild(el('b', null, x[key]));
      r.addEventListener('click', function () { setPfSite(state.pfSite === x.site ? '' : x.site); });
      dist.appendChild(r);
    });
    // 原因
    var rb = $('pfReasons'); rb.textContent = '';
    $('pfReasonNote').textContent = '近 ' + j.range + ' 天 · 共 ' + (j.total || 0) + ' 次';
    if (!j.reasons || !j.reasons.length) rb.appendChild(el('p', 'muted small', '近 ' + j.range + ' 天没有解析失败'));
    else {
      var rmax = j.reasons[0].n;
      j.reasons.forEach(function (x) {
        var r = el('div', 'dist-row reason'); r.title = x.label + '：' + x.n + ' 次';
        r.appendChild(el('span', null, PF_REASON_LABEL[x.code] || x.label));
        var bar = el('span', 'dist-bar'); var f = el('i'); f.style.width = Math.max(3, Math.round(x.n / rmax * 100)) + '%'; bar.appendChild(f);
        r.appendChild(bar); r.appendChild(el('b', null, x.n));
        rb.appendChild(r);
      });
    }
    var mb = $('pfMsgs'); mb.textContent = '';
    if (!j.msgs || !j.msgs.length) mb.appendChild(el('li', 'muted small empty', '暂无'));
    (j.msgs || []).forEach(function (x) {
      var li = el('li'); li.appendChild(el('span', 'pf-msg', x.msg)); li.appendChild(el('b', null, x.n)); li.title = x.msg; mb.appendChild(li);
    });
    // 最新样本
    var box = $('pfSamples'); box.textContent = '';
    var smp = j.samples || [];
    $('pfSampleNote').textContent = smp.length ? '最近 ' + smp.length + ' 条' : '';
    if (!smp.length) { box.appendChild(stateBox('empty', '没有失败记录', state.pfSite ? '这个平台近 ' + j.range + ' 天没有解析失败' : '近 ' + j.range + ' 天各解析站都没有解析失败')); return; }
    var FIRST = 10;
    smp.slice(0, FIRST).forEach(function (x) { box.appendChild(pfRow(x)); });
    if (smp.length > FIRST) {
      var mw = el('div', 'more'); var mbtn = el('button', 'btn ghost', '显示全部 ' + smp.length + ' 条'); mbtn.type = 'button';
      mbtn.addEventListener('click', function () { mw.remove(); smp.slice(FIRST).forEach(function (x) { box.appendChild(pfRow(x)); }); });
      mw.appendChild(mbtn); box.appendChild(mw);
    }
  }
  var PF_REASON_LABEL = { timeout: '超时', upstream_http: '上游接口报错', upstream_quota: '上游额度 / 限流', no_media: '没找到视频', network: '网络错误', bad_upstream: '上游返回格式异常', config: '站点配置缺失', exception: '程序异常', other: '其他' };
  function pfRow(x) {
    var r = el('div', 'pf-row s-' + siteKey(x.site));
    var head = el('div', 'pf-head');
    head.appendChild(el('span', 'chip site', x.siteLabel || SITES[x.site] || x.site));
    head.appendChild(el('span', 'chip kind', PF_REASON_LABEL[x.code] || x.code));
    var codes = [];
    if (x.up) codes.push('上游 HTTP ' + x.up);
    if (x.st) codes.push('本站返回 ' + x.st);
    if (codes.length) head.appendChild(el('span', 'pf-code', codes.join(' · ')));
    var tm = el('span', 'fb-time');
    if (x.t) { tm.appendChild(el('b', null, fmtRel(x.t))); tm.appendChild(document.createTextNode(' · ' + fmtAbs(x.t))); tm.title = '北京时间 ' + fmtAbs(x.t); }
    head.appendChild(tm);
    r.appendChild(head);
    if (x.msg) r.appendChild(el('div', 'pf-err', x.msg));
    var lk = el('div', 'fb-link'); lk.appendChild(icon('link'));
    var ls = el('span', null, x.url || '（没有识别到链接）'); ls.title = x.url || ''; lk.appendChild(ls);
    if (x.url) {
      var cp = el('button', 'copy'); cp.type = 'button'; cp.title = '复制链接'; cp.setAttribute('aria-label', '复制失败的链接'); cp.appendChild(icon('copy'));
      cp.addEventListener('click', function () { copyText(x.url, '已复制链接'); });
      lk.appendChild(cp);
    }
    r.appendChild(lk);
    return r;
  }
  function renderPfNav(j) {
    if (state.view !== 'pf') return;
    var nav = $('siteNav'); nav.textContent = '';
    nav.appendChild(el('div', 'nav-label', '平台 · 近 30 天失败'));
    var total = (j.sites || []).reduce(function (a, x) { return a + x.n30; }, 0);
    [{ site: '', label: '全部平台', n30: total }].concat(j.sites || []).forEach(function (s) {
      var b = el('button', 'nav-item ' + (s.site ? 's-' + siteKey(s.site) : 's-all')); b.type = 'button';
      b.setAttribute('data-site', s.site);
      b.setAttribute('aria-current', state.pfSite === s.site ? 'true' : 'false');
      b.appendChild(el('span', 'dot'));
      b.appendChild(el('span', 'name', s.label || SITES[s.site] || s.site));
      b.appendChild(el('span', 'count', s.n30));
      b.addEventListener('click', function () { setPfSite(s.site); });
      nav.appendChild(b);
    });
  }
  seg('segView', function (v) { setView(v === 'pf' ? 'pf' : 'fb'); });
  seg('segPfRange', function (v) { state.pfRange = v === '7' ? 7 : 30; loadPf(); });

  function reloadAll() { renderKpisLoading(); loadStats(); loadPage(true); if (state.view === 'pf') loadPf(); }
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
    if (j.ok && j.admin) { showApp(); reloadAll(); if (location.hash === '#failures') setView('pf'); }
    else showLogin(j.ok && j.configured === false ? '本站还没配置管理密码' : '');
  });
})();
