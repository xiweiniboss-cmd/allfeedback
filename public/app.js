// 统一反馈后台前端：所有用户提交的内容都用 textContent / 属性赋值渲染，不拼 HTML
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var KINDS = ['解析失败', '下载失败', '还有水印', '视频有问题', '图片有问题', '其他'];
  var SITES = {};
  var state = { cursor: null, loading: false };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = String(text);
    return e;
  }
  function toast(t) {
    var e = $('toast'); e.textContent = t; e.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { e.hidden = true; }, 2200);
  }
  function fmt(ms) {
    if (!ms) return '时间未知';
    var d = new Date(ms);
    return d.toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
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
    if (r.status === 401) showLogin('登录已过期，请重新登录');
    return j;
  }

  /* ---------- 登录 ---------- */
  function showLogin(msg) {
    $('app').hidden = true; $('login').hidden = false;
    $('loginErr').textContent = msg || '';
    setTimeout(function () { $('loginKey').focus(); }, 30);
  }
  function showApp() { $('login').hidden = true; $('app').hidden = false; }
  $('loginForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var btn = $('loginBtn'); btn.disabled = true; $('loginErr').textContent = '';
    var j = await api('/api/login', { method: 'POST', body: { key: $('loginKey').value } });
    btn.disabled = false;
    if (j.ok) { $('loginKey').value = ''; showApp(); reloadAll(); }
    else $('loginErr').textContent = j.error || '登录失败';
  });
  $('logoutBtn').addEventListener('click', async function () {
    await api('/api/logout', { method: 'POST', body: {} });
    showLogin('已退出登录');
  });

  /* ---------- 统计 ---------- */
  async function loadStats() {
    var j = await api('/api/stats');
    if (!j.ok) { $('statNote').textContent = '统计加载失败：' + (j.error || ''); return; }
    SITES = j.siteNames || SITES;
    fillSelects(j);
    var box = $('statCards'); box.textContent = '';
    var all = el('button', 'stat' + ($('fSite').value ? '' : ' on')); all.type = 'button';
    all.appendChild(el('b', null, j.total)); all.appendChild(el('span', null, '全部 · 未处理 ' + j.open));
    all.addEventListener('click', function () { $('fSite').value = ''; search(); });
    box.appendChild(all);
    j.sites.forEach(function (s) {
      var c = el('button', 'stat' + ($('fSite').value === s.site ? ' on' : '')); c.type = 'button';
      c.appendChild(el('b', null, s.total)); c.appendChild(el('span', null, s.label + ' · 未处理 ' + s.open));
      c.addEventListener('click', function () { $('fSite').value = s.site; search(); });
      box.appendChild(c);
    });
    var t = $('dayTable'); t.textContent = '';
    var sites = j.sites.map(function (s) { return s.site; });
    var hr = el('tr'); hr.appendChild(el('th', null, '日期'));
    sites.forEach(function (s) { hr.appendChild(el('th', null, SITES[s] || s)); });
    hr.appendChild(el('th', null, '合计')); t.appendChild(hr);
    j.days.forEach(function (d) {
      var tr = el('tr'); tr.appendChild(el('td', null, d.day));
      sites.forEach(function (s) { tr.appendChild(el('td', null, d.sites[s] || '')); });
      tr.appendChild(el('td', null, d.total)); t.appendChild(tr);
    });
    $('statNote').textContent = j.truncated ? '记录较多，统计只算了最新 ' + j.counted + ' 条。' : '';
  }
  function fillSelects(j) {
    var fs = $('fSite');
    if (fs.options.length <= 1) Object.keys(SITES).forEach(function (k) { var o = el('option', null, SITES[k]); o.value = k; fs.appendChild(o); });
    var fk = $('fKind'); var have = {};
    for (var i = 1; i < fk.options.length; i++) have[fk.options[i].value] = 1;
    KINDS.concat((j.kinds || []).map(function (x) { return x.kind; })).forEach(function (k) {
      if (!k || have[k]) return; have[k] = 1; var o = el('option', null, k); o.value = k; fk.appendChild(o);
    });
  }

  /* ---------- 列表 ---------- */
  function query() {
    var p = new URLSearchParams();
    if ($('fSite').value) p.set('site', $('fSite').value);
    if ($('fKind').value) p.set('kind', $('fKind').value);
    if ($('fStatus').value) p.set('status', $('fStatus').value);
    if ($('fQ').value.trim()) p.set('q', $('fQ').value.trim());
    p.set('order', $('fOrder').value);
    p.set('limit', '20');
    if (state.cursor) p.set('cursor', state.cursor);
    return '/api/feedback?' + p.toString();
  }
  async function loadPage(reset) {
    if (state.loading) return;
    state.loading = true;
    if (reset) { state.cursor = null; $('list').textContent = ''; }
    $('listErr').textContent = ''; $('moreBtn').disabled = true;
    var j = await api(query());
    state.loading = false; $('moreBtn').disabled = false;
    if (!j.ok) { if (j.status !== 401) $('listErr').textContent = '加载失败：' + (j.error || ''); return; }
    j.items.forEach(function (it) { $('list').appendChild(card(it)); });
    state.cursor = j.cursor; state.total = j.total; state.more = j.more;
    $('moreBtn').hidden = !j.more;
    if (!$('list').children.length) $('list').appendChild(el('div', 'empty', j.more ? '这一批没有匹配的反馈，点「加载更多」继续找' : '没有匹配的反馈'));
    updateNote();
  }
  function updateNote() { $('listNote').textContent = '全部站点共 ' + state.total + ' 条反馈' + (state.more ? '，还有更多' : ''); }
  function card(it) {
    var d = el('article', 'fb' + (it.status === 'done' ? ' done' : ''));
    var head = el('div', 'head');
    head.appendChild(el('span', 'chip site', it.siteLabel || it.site));
    if (it.kind) head.appendChild(el('span', 'chip kind', it.kind));
    var st = el('span', 'chip st-' + it.status, it.status === 'done' ? '已处理' : '未处理'); head.appendChild(st);
    head.appendChild(el('span', null, fmt(it.time)));
    d.appendChild(head);
    d.appendChild(el('div', 'msg', it.message || '（无内容）'));
    if (it.link) d.appendChild(el('div', 'link', '当前输入：' + it.link));
    var meta = [];
    if (it.contact) meta.push('联系方式：' + it.contact);
    if (it.ip) meta.push('IP：' + it.ip);
    var g = it.geo || {}; var geo = [g.country, g.region, g.city].filter(Boolean).join(' · ');
    if (geo) meta.push('地区：' + geo);
    if (it.page) meta.push('来源页面：' + it.page);
    meta.push('编号：' + it.id);
    d.appendChild(el('div', 'meta', meta.join('\n')));
    if (it.attachments && it.attachments.length) {
      var atts = el('div', 'atts');
      it.attachments.forEach(function (a) {
        var src = '/api/file?key=' + encodeURIComponent(a.key);
        var box = el('div', 'att');
        if (/^image\/(png|jpe?g|pjpeg|gif|webp|heic|heif|avif|bmp)$/i.test(a.type)) {
          var img = el('img'); img.src = src; img.alt = a.name || '图片附件'; img.loading = 'lazy'; box.appendChild(img);
        } else if (/^video\//i.test(a.type)) {
          var v = el('video'); v.src = src; v.controls = true; v.preload = 'metadata'; v.setAttribute('playsinline', ''); box.appendChild(v);
        }
        var dl = el('a', null, '⬇ ' + (a.name || '下载附件')); dl.href = src; dl.setAttribute('download', a.name || 'attachment'); dl.rel = 'noopener noreferrer';
        box.appendChild(dl);
        atts.appendChild(box);
      });
      d.appendChild(atts);
    }
    var acts = el('div', 'actions');
    var mark = el('button', 'btn', it.status === 'done' ? '标为未处理' : '标为已处理'); mark.type = 'button';
    mark.addEventListener('click', async function () {
      mark.disabled = true;
      var want = it.status === 'done' ? 'open' : 'done';
      var j = await api('/api/status', { method: 'POST', body: { id: it.id, status: want } });
      mark.disabled = false;
      if (!j.ok) { if (j.status !== 401) alert('操作失败：' + (j.error || '')); return; }
      it.status = want;
      d.replaceWith(card(it));
      toast(want === 'done' ? '已标为已处理' : '已标为未处理');
      loadStats();
    });
    var del = el('button', 'btn danger', '删除'); del.type = 'button';
    del.addEventListener('click', async function () {
      if (!confirm('确定删除这条反馈吗？附件会一起删除，删除后无法恢复。')) return;
      del.disabled = true;
      var j = await api('/api/feedback', { method: 'DELETE', body: { id: it.id } });
      del.disabled = false;
      if (!j.ok) { if (j.status !== 401) alert('删除失败：' + (j.error || '')); return; }
      d.remove();
      state.total = Math.max(0, (state.total || 1) - 1); updateNote();
      if (!$('list').querySelector('article')) $('list').appendChild(el('div', 'empty', state.more ? '这一批已清空，点「加载更多」继续' : '没有匹配的反馈'));
      toast('已删除' + (j.files ? '（含 ' + j.files + ' 个附件）' : '') + (j.fileErrors ? '，有 ' + j.fileErrors + ' 个附件没删掉' : ''));
      loadStats();
    });
    acts.appendChild(mark); acts.appendChild(del);
    d.appendChild(acts);
    return d;
  }
  function search() { loadPage(true); loadStats(); }
  function reloadAll() { loadStats(); loadPage(true); }
  $('searchBtn').addEventListener('click', search);
  ['fSite', 'fKind', 'fStatus', 'fOrder'].forEach(function (id) { $(id).addEventListener('change', search); });
  $('fQ').addEventListener('keydown', function (e) { if (e.key === 'Enter') search(); });
  $('moreBtn').addEventListener('click', function () { loadPage(false); });
  $('refreshBtn').addEventListener('click', reloadAll);

  api('/api/me').then(function (j) {
    if (j.ok && j.admin) { showApp(); reloadAll(); }
    else showLogin(j.ok && j.configured === false ? '本站还没配置管理密码' : '');
  });
})();
