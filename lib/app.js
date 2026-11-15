// allfeedback 统一反馈后台：后端逻辑（Pages Functions 通过 functions/api/[[route]].js 调用）
//
// 安全边界（重要）：FEEDBACK_KV 和 DeepSeek 站共用，里面还有用户账号、会话、聊天记录等。
// 本站对 KV 的所有访问都经过 guardKV()：
//   - 只能 list 前缀 fb_ / feedback_fb_（旧快手）的键；
//   - 只能 get / delete 反馈键（fb_… / feedback_fb_…），以及读写本站自己的状态键 fbstatus_v1 和登录失败计数 admfail_allfeedback_…；
//   - 只能 get（只读）解析失败统计键 pf_<站点>_<YYYY-MM-DD>（各解析站写入，本站绝不写、不删、不 list）；
//   - 其他任何键一律抛错，永远不会被读出或返回给前端。
// R2 只允许 fb/ 前缀的对象。

export const FB_PREFIX = 'fb_';
export const LEGACY_PREFIX = 'feedback_fb_';
export const STATUS_KEY = 'fbstatus_v1';
export const ID_RE = /^fb_[A-Za-z0-9_]{4,80}$/;
export const FILE_KEY_RE = /^fb\/[A-Za-z0-9._\/-]{1,200}$/;
export const SAFE_ATTACH_TYPE = /^(image\/(png|jpe?g|pjpeg|gif|webp|heic|heif|avif|bmp)|video\/[a-z0-9.+-]+)$/i;
export const ADMIN_COOKIE = 'af_admin';
export const ADMIN_SESSION_SECS = 12 * 3600;
export const ADMIN_FAIL_MAX = 10;
export const FAIL_PREFIX = 'admfail_allfeedback_';
export const PAGE_MAX = 50;
export const READ_BUDGET = 300; // 一次列表请求最多读多少条记录（Workers 每次调用 KV 操作上限 1000）
export const STATS_BUDGET = 800;
// 解析失败统计：各解析站按「站点 + 北京日期」写 pf_<site>_<YYYY-MM-DD>（见 shared/pf-recorder.js）
export const PF_KEY_RE = /^pf_[a-z0-9]{2,20}_\d{4}-\d{2}-\d{2}$/;
// 以后新增解析站（比如微博）：站点代码里用同一个名字调用 createPfRecorder('weibo')，这里已经包含就不用改
export const PF_SITES = ['douyin', 'xiaohongshu', 'bilibili', 'youtube', 'tiktok', 'kuaishou', 'weibo'];
export const PF_DAYS = 30;
export const PF_REASONS = {
  timeout: '超时', upstream_http: '上游接口报错', upstream_quota: '上游额度 / 限流', no_media: '没找到视频（已删除 / 私密 / 链接失效）',
  network: '网络错误', bad_upstream: '上游返回格式异常', config: '站点配置缺失', exception: '程序异常', other: '其他',
};

export const SITES = {
  douyin: '抖音', xiaohongshu: '小红书', bilibili: 'B站', youtube: 'YouTube', tiktok: 'TikTok',
  kuaishou: '快手', weibo: '微博', deepseek: 'DeepSeek', zhijia: '智驾模拟器', brake: '刹车模拟器', other: '其他',
};
const TAG_SITE = { '[DeepSeek站]': 'deepseek', '[智驾站]': 'zhijia', '[刹车站]': 'brake' };
const HOST_SITE = [
  ['douyin', 'douyin'], ['xiaohongshu', 'xiaohongshu'], ['bilibili', 'bilibili'], ['youtube', 'youtube'],
  ['tiktok', 'tiktok'], ['kuaishou', 'kuaishou'], ['weibo', 'weibo'], ['deepseek', 'deepseek'], ['zhijia', 'zhijia'],
];

/* ---------------- KV 访问守卫 ---------------- */
export class KeyNotAllowed extends Error {}
export function guardKV(kv) {
  const failPrefix = FAIL_PREFIX;
  const isFb = (k) => typeof k === 'string' && (k.startsWith(FB_PREFIX) || k.startsWith(LEGACY_PREFIX));
  const deny = (op, k) => { throw new KeyNotAllowed('KV ' + op + ' not allowed: ' + String(k).slice(0, 40)); };
  return {
    async get(k) {
      if (!(isFb(k) || k === STATUS_KEY || (typeof k === 'string' && (k.startsWith(failPrefix) || PF_KEY_RE.test(k))))) deny('get', k);
      return kv.get(k);
    },
    async put(k, v, opts) {
      if (!(k === STATUS_KEY || (typeof k === 'string' && k.startsWith(failPrefix)))) deny('put', k);
      return kv.put(k, v, opts);
    },
    async delete(k) {
      if (!isFb(k)) deny('delete', k);
      return kv.delete(k);
    },
    async list(opts = {}) {
      if (opts.prefix !== FB_PREFIX && opts.prefix !== LEGACY_PREFIX) deny('list', opts.prefix);
      const r = await kv.list({ prefix: opts.prefix, cursor: opts.cursor, limit: opts.limit });
      // 双保险：即使底层返回了别的键也过滤掉
      return { ...r, keys: (r.keys || []).filter((x) => x && isFb(x.name)) };
    },
  };
}

/* ---------------- 通用 ---------------- */
export function json(data, status = 200, extra) {
  const h = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  if (extra) for (const [k, v] of Object.entries(extra)) h.append(k, v);
  return new Response(JSON.stringify(data), { status, headers: h });
}
export function ipLimitKey(ip) {
  ip = String(ip || '').trim().toLowerCase();
  if (!ip.includes(':')) return ip;
  let s = ip.split('%')[0];
  const v4 = s.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4 && /^::(ffff:)?[\d.]+$/.test(s)) return v4[1];
  if (v4) s = s.slice(0, -v4[1].length) + '0:0';
  const halves = s.split('::');
  const head = halves[0] ? halves[0].split(':') : [];
  let parts = head;
  if (halves.length > 1) {
    const tail = halves[1] ? halves[1].split(':') : [];
    parts = head.concat(Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), tail);
  }
  parts = parts.slice(0, 4).map((x) => (parseInt(x || '0', 16) || 0).toString(16));
  while (parts.length < 4) parts.push('0');
  return parts.join(':') + '::/64';
}

/* ---------------- 管理员登录（与加固后的解析站同一套模型） ---------------- */
export function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
async function hmac(secret, msg) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
  let s = '';
  for (const b of sig) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
// 签名内容带上站点名，本站 Cookie 拿到别的站无效
const adminSig = (secret, exp) => hmac(secret, 'allfeedback|' + exp);
function cookieValue(request) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === ADMIN_COOKIE) return part.slice(i + 1).trim();
  }
  return '';
}
export async function isAdmin(request, env) {
  const secret = String((env && env.FEEDBACK_ADMIN_KEY) || '');
  if (!secret) return false;
  const m = cookieValue(request).match(/^(\d{9,11})\.([A-Za-z0-9_-]{20,})$/);
  if (!m || Number(m[1]) < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(m[2], await adminSig(secret, m[1]));
}
export async function makeCookie(env) {
  const exp = Math.floor(Date.now() / 1000) + ADMIN_SESSION_SECS;
  return ADMIN_COOKIE + '=' + exp + '.' + (await adminSig(String(env.FEEDBACK_ADMIN_KEY), exp)) +
    '; Path=/; Max-Age=' + ADMIN_SESSION_SECS + '; HttpOnly; Secure; SameSite=Strict';
}
const clearCookie = () => ADMIN_COOKIE + '=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict';
// 写操作：必须同源（有 Sec-Fetch-Site 就得是 same-origin；有 Origin 就得是本站）
export function sameOrigin(request) {
  const sfs = request.headers.get('Sec-Fetch-Site');
  if (sfs && sfs !== 'same-origin') return false;
  const o = request.headers.get('Origin');
  if (o && o !== new URL(request.url).origin) return false;
  return true;
}
const isJson = (request) => (request.headers.get('content-type') || '').toLowerCase().includes('application/json');

async function handleLogin(request, env, kv) {
  if (request.method !== 'POST') return json({ ok: false, error: '方法不支持' }, 405);
  if (!isJson(request)) return json({ ok: false, error: '请求格式错误' }, 415);
  if (!sameOrigin(request)) return json({ ok: false, error: '禁止跨站登录' }, 403);
  const secret = String(env.FEEDBACK_ADMIN_KEY || '');
  if (!secret) return json({ ok: false, error: '未配置管理密码' }, 500);
  let key = '';
  try { key = String(((await request.json()) || {}).key || ''); } catch {}
  const ipk = ipLimitKey(request.headers.get('cf-connecting-ip') || '');
  // 计数键不带域名：每个预览部署的域名都不一样，按域名分开会让锁定形同虚设
  const fk = FAIL_PREFIX + ipk;
  let fails = 0;
  if (kv && ipk) {
    try { fails = Number((await kv.get(fk)) || 0); } catch {}
    if (fails >= ADMIN_FAIL_MAX) return json({ ok: false, error: '密码错误次数过多，请 15 分钟后再试' }, 429);
  }
  if (!safeEqual(key, secret)) {
    if (kv && ipk) { try { await kv.put(fk, String(fails + 1), { expirationTtl: 900 }); } catch {} }
    return json({ ok: false, error: '密码错误' }, 403);
  }
  return json({ ok: true }, 200, { 'Set-Cookie': await makeCookie(env) });
}
function handleLogout(request) {
  if (request.method !== 'POST') return json({ ok: false, error: '方法不支持' }, 405);
  if (!sameOrigin(request)) return json({ ok: false, error: '禁止跨站请求' }, 403);
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
}

/* ---------------- 记录归一化 ---------------- */
export function keyTime(key) {
  const k = key.startsWith(LEGACY_PREFIX) ? key.slice('feedback_'.length) : key;
  let m = k.match(/^fb_(\d{13})/); // DeepSeek / 智驾：fb_<毫秒><随机>
  if (m) return Number(m[1]);
  m = k.match(/^fb_([0-9a-z]{7,9})(?:_|$)/); // 解析站：fb_<36 进制毫秒>_<随机>
  if (m) { const t = parseInt(m[1], 36); if (t > 1.5e12 && t < 4.2e12) return t; }
  m = k.match(/^fb_([0-9a-z]{8})/); // 快手旧版：fb_<36 进制毫秒><随机>（无下划线）
  if (m) { const t = parseInt(m[1], 36); if (t > 1.5e12 && t < 4.2e12) return t; }
  return 0;
}
export function siteOf(v, legacy) {
  if (v && TAG_SITE[v.site]) return TAG_SITE[v.site];
  if (legacy) return 'kuaishou';
  let h = '';
  try { h = new URL(String((v && v.page) || '')).hostname.toLowerCase(); } catch {}
  for (const [needle, site] of HOST_SITE) if (h.includes(needle)) return site;
  return 'other';
}
const str = (x, n) => (x == null ? '' : String(x)).slice(0, n);
export function normalize(key, v, status) {
  const legacy = key.startsWith(LEGACY_PREFIX);
  const id = legacy ? key.slice('feedback_'.length) : key;
  let time = 0;
  if (v.time) time = Date.parse(v.time) || 0;
  if (!time && v.t) time = Number(v.t) || 0;
  if (!time && v.ts) time = Number(v.ts) || 0;
  if (!time) time = keyTime(key);
  let message = str(v.message != null ? v.message : v.text, 4000);
  let kind = str(v.kind, 40);
  if (!kind) { const m = message.match(/^【([^】]{1,20})】/); if (m) kind = m[1]; }
  const atts = Array.isArray(v.attachments) ? v.attachments : Array.isArray(v.files) ? v.files : [];
  const geo = v.geo && typeof v.geo === 'object' ? v.geo : { country: v.cc || '', region: v.region || '', city: v.city || '' };
  const site = siteOf(v, legacy);
  const st = status && status[id];
  return {
    id, site, siteLabel: SITES[site], time,
    kind, message, link: str(v.link, 1000), contact: str(v.contact, 200),
    page: /^https?:\/\//i.test(String(v.page || '')) ? str(v.page, 300) : '',
    ip: str(v.ip, 64), ua: str(v.ua, 300),
    geo: { country: str(geo.country, 8), region: str(geo.region, 60), city: str(geo.city, 60) },
    attachments: atts.filter((a) => a && typeof a.key === 'string' && FILE_KEY_RE.test(a.key) && !a.key.includes('..'))
      .map((a) => ({ key: a.key, name: str(a.name || a.key.split('/').pop(), 120), type: str(a.type, 80), size: Number(a.size) || 0 })),
    status: st && st.s === 'done' ? 'done' : 'open',
    handledAt: st && st.s === 'done' ? Number(st.t) || 0 : 0,
  };
}
export function matches(it, f) {
  if (f.site && it.site !== f.site) return false;
  if (f.kind && it.kind !== f.kind) return false;
  if (f.status && it.status !== f.status) return false;
  if (f.q) {
    const hay = [it.message, it.contact, it.link, it.kind, it.ip, it.id, it.page].join('\n').toLowerCase();
    if (!hay.includes(f.q)) return false;
  }
  return true;
}

/* ---------------- 列表：KV cursor 枚举全部键 → 按时间排序 → 逐页读值 ---------------- */
async function listAllKeys(kv) {
  const out = [];
  for (const prefix of [FB_PREFIX, LEGACY_PREFIX]) {
    let cursor;
    for (let page = 0; page < 30; page++) {
      const r = await kv.list({ prefix, cursor, limit: 1000 });
      for (const k of r.keys) out.push({ name: k.name, t: keyTime(k.name) });
      if (r.list_complete || !r.cursor) break;
      cursor = r.cursor;
    }
  }
  return out;
}
async function readStatus(kv) {
  try { const s = JSON.parse((await kv.get(STATUS_KEY)) || '{}'); return s && typeof s === 'object' ? s : {}; } catch { return {}; }
}
async function readRecord(kv, key) {
  try {
    const raw = await kv.get(key);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : null;
  } catch (e) {
    if (e instanceof KeyNotAllowed) throw e;
    return null;
  }
}
const encCursor = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/=+$/, '');
function decCursor(s) {
  try { const o = JSON.parse(decodeURIComponent(escape(atob(s)))); return o && typeof o.k === 'string' ? o : null; } catch { return null; }
}
export function filtersFrom(url) {
  const p = url.searchParams;
  const site = p.get('site') || '';
  const status = p.get('status') || '';
  return {
    site: Object.prototype.hasOwnProperty.call(SITES, site) ? site : '',
    kind: str(p.get('kind'), 40).trim(),
    status: status === 'done' || status === 'open' ? status : '',
    q: str(p.get('q'), 100).trim().toLowerCase(),
    order: p.get('order') === 'asc' ? 'asc' : 'desc',
    limit: Math.min(PAGE_MAX, Math.max(1, parseInt(p.get('limit') || '20', 10) || 20)),
    cursor: p.get('cursor') ? decCursor(p.get('cursor')) : null,
  };
}
async function handleList(request, env, kv) {
  const f = filtersFrom(new URL(request.url));
  const keys = await listAllKeys(kv);
  const dir = f.order === 'asc' ? 1 : -1;
  keys.sort((a, b) => (a.t - b.t) * dir || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) * dir);
  let start = 0;
  if (f.cursor) {
    const i = keys.findIndex((k) => k.name === f.cursor.k);
    if (i >= 0) start = i + 1;
    else {
      // 游标那条已被删除：按同样的排序规则找到它之后的第一条，而不是从头开始
      const ct = keyTime(f.cursor.k), cn = f.cursor.k;
      const j = keys.findIndex((k) => ((k.t - ct) * dir || (k.name < cn ? -1 : k.name > cn ? 1 : 0) * dir) > 0);
      start = j >= 0 ? j : keys.length;
    }
  }
  const status = await readStatus(kv);
  const items = [];
  let reads = 0, i = start;
  for (; i < keys.length && items.length < f.limit && reads < READ_BUDGET; i++) {
    reads++;
    const v = await readRecord(kv, keys[i].name);
    if (!v) continue;
    const it = normalize(keys[i].name, v, status);
    if (matches(it, f)) items.push(it);
  }
  const more = i < keys.length;
  return json({
    ok: true, items, total: keys.length, scanned: reads,
    cursor: more ? encCursor({ k: keys[i - 1].name }) : null,
    more,
  });
}

/* ---------------- 统计：各站 / 每天 ---------------- */
function dayCN(ms) { return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10); }
async function handleStats(request, env, kv) {
  const keys = await listAllKeys(kv);
  keys.sort((a, b) => b.t - a.t);
  const status = await readStatus(kv);
  const bySite = {}, byDay = {}, kinds = {};
  let open = 0, done = 0, read = 0;
  for (const k of keys.slice(0, STATS_BUDGET)) {
    const v = await readRecord(kv, k.name);
    read++;
    if (!v) continue;
    const it = normalize(k.name, v, status);
    const s = (bySite[it.site] = bySite[it.site] || { site: it.site, label: it.siteLabel, total: 0, open: 0 });
    s.total++;
    if (it.status === 'open') { s.open++; open++; } else done++;
    if (it.time) { const d = dayCN(it.time); byDay[d] = byDay[d] || {}; byDay[d][it.site] = (byDay[d][it.site] || 0) + 1; }
    if (it.kind) kinds[it.kind] = (kinds[it.kind] || 0) + 1;
  }
  return json({
    ok: true, total: keys.length, counted: read, truncated: keys.length > STATS_BUDGET,
    open, done, sites: Object.values(bySite).sort((a, b) => b.total - a.total),
    days: Object.keys(byDay).sort().reverse().slice(0, 30).map((d) => ({ day: d, sites: byDay[d], total: Object.values(byDay[d]).reduce((a, b) => a + b, 0) })),
    kinds: Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([kind, n]) => ({ kind, n })),
    siteNames: SITES,
  });
}

/* ---------------- 解析失败统计（只读） ---------------- */
// 键名固定（站点 × 日期），直接 get，不需要 list：7 站 × 30 天 = 210 次读
async function readPf(kv, site, day) {
  try {
    const raw = await kv.get('pf_' + site + '_' + day);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : null;
  } catch (e) {
    if (e instanceof KeyNotAllowed) throw e;
    return null;
  }
}
export function pfDayList(now, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(dayCN(now - i * 86400000));
  return out; // 新 → 旧
}
const num = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Math.floor(Number(x)) : 0);
async function handleFailures(request, env, kv) {
  const sp = new URL(request.url).searchParams;
  const range = sp.get('days') === '7' ? 7 : 30;
  const only = PF_SITES.includes(sp.get('site') || '') ? sp.get('site') : '';
  const days = pfDayList(Date.now(), PF_DAYS);
  const jobs = [];
  for (const site of PF_SITES) for (let i = 0; i < days.length; i++) jobs.push({ site, day: days[i], i });
  const recs = [];
  for (let i = 0; i < jobs.length; i += 50) {
    const part = jobs.slice(i, i + 50);
    const got = await Promise.all(part.map((j) => readPf(kv, j.site, j.day)));
    got.forEach((v, k) => { if (v) recs.push({ ...part[k], v }); });
  }
  const sites = Object.fromEntries(PF_SITES.map((s) => [s, { site: s, label: SITES[s] || s, n7: 0, n30: 0, today: 0 }]));
  const byDay = Object.fromEntries(days.map((d) => [d, {}]));
  const reasons = {}, msgs = {};
  let samples = [];
  for (const { site, day, i, v } of recs) {
    const n = num(v.n);
    const s = sites[site];
    s.n30 += n;
    if (i < 7) s.n7 += n;
    if (i === 0) s.today = n;
    if (only && site !== only) continue;
    if (n) byDay[day][site] = n;
    if (i >= range) continue;
    if (v.reasons && typeof v.reasons === 'object') {
      for (const [k, c] of Object.entries(v.reasons)) {
        const code = Object.prototype.hasOwnProperty.call(PF_REASONS, k) ? k : 'other';
        reasons[code] = (reasons[code] || 0) + num(c);
      }
    }
    if (v.msgs && typeof v.msgs === 'object') {
      for (const [k, c] of Object.entries(v.msgs).slice(0, 50)) {
        const m = str(k, 120);
        if (m) msgs[m] = (msgs[m] || 0) + num(c);
      }
    }
    if (Array.isArray(v.last)) {
      for (const x of v.last.slice(0, 50)) {
        if (!x || typeof x !== 'object') continue;
        const url = /^https?:\/\//i.test(String(x.url || '')) ? str(x.url, 300) : '';
        const code = Object.prototype.hasOwnProperty.call(PF_REASONS, x.code) ? x.code : 'other';
        samples.push({ site, siteLabel: SITES[site] || site, t: num(x.t), url, code, msg: str(x.msg, 120), st: num(x.st), up: num(x.up) });
      }
    }
  }
  samples = samples.sort((a, b) => b.t - a.t).slice(0, 50);
  const total = Object.values(reasons).reduce((a, b) => a + b, 0);
  return json({
    ok: true, range, site: only, total,
    sites: Object.values(sites).sort((a, b) => b.n30 - a.n30 || PF_SITES.indexOf(a.site) - PF_SITES.indexOf(b.site)),
    days: days.map((d) => ({ day: d, sites: byDay[d], total: Object.values(byDay[d]).reduce((a, b) => a + b, 0) })),
    reasons: Object.entries(reasons).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([code, n]) => ({ code, label: PF_REASONS[code], n })),
    msgs: Object.entries(msgs).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([msg, n]) => ({ msg, n })),
    samples, siteNames: SITES,
  });
}

/* ---------------- 写操作：删除 / 标记 ---------------- */
async function readBody(request) {
  try { const b = await request.json(); return b && typeof b === 'object' ? b : {}; } catch { return null; }
}
async function findRecordKey(kv, id) {
  if (await kv.get(id)) return id;
  if (await kv.get('feedback_' + id)) return 'feedback_' + id;
  return null;
}
async function handleDelete(request, env, kv) {
  const b = await readBody(request);
  if (!b) return json({ ok: false, error: '请求格式错误' }, 400);
  const id = String(b.id || '');
  if (!ID_RE.test(id)) return json({ ok: false, error: '参数错误' }, 400);
  const key = await findRecordKey(kv, id);
  if (!key) return json({ ok: false, error: '这条反馈不存在（可能已被删除）' }, 404);
  const v = await readRecord(kv, key);
  const it = v ? normalize(key, v, {}) : null;
  // 先删记录：记录删不掉就整体失败，附件原样保留；记录删掉后再删附件，附件删失败只记日志，不影响结果
  try { await kv.delete(key); } catch { return json({ ok: false, error: '删除失败，请稍后重试' }, 500); }
  let files = 0, fileErrors = 0;
  if (it && it.attachments.length && env.FEEDBACK_BUCKET) {
    for (const a of it.attachments) {
      try { await env.FEEDBACK_BUCKET.delete(a.key); files++; }
      catch (e) { fileErrors++; console.error('allfeedback: attachment delete failed', a.key, String((e && e.message) || e)); }
    }
  }
  try {
    const st = await readStatus(kv);
    if (st[id]) { delete st[id]; await kv.put(STATUS_KEY, JSON.stringify(st)); }
  } catch {}
  return json({ ok: true, id, files, fileErrors });
}
async function handleStatus(request, env, kv) {
  const b = await readBody(request);
  if (!b) return json({ ok: false, error: '请求格式错误' }, 400);
  const id = String(b.id || '');
  const s = b.status === 'done' ? 'done' : b.status === 'open' ? 'open' : '';
  if (!ID_RE.test(id) || !s) return json({ ok: false, error: '参数错误' }, 400);
  if (!(await findRecordKey(kv, id))) return json({ ok: false, error: '这条反馈不存在（可能已被删除）' }, 404);
  // 状态单独存在 fbstatus_v1，不改动原始反馈记录（DeepSeek 站的记录带 90 天过期，重写会丢掉过期时间）
  const st = await readStatus(kv);
  if (s === 'done') st[id] = { s: 'done', t: Date.now() };
  else delete st[id];
  try { await kv.put(STATUS_KEY, JSON.stringify(st)); } catch { return json({ ok: false, error: '保存失败，请稍后重试' }, 500); }
  return json({ ok: true, id, status: s });
}

/* ---------------- 附件 ---------------- */
// 下载文件名：只用来生成 Content-Disposition。去掉路径、控制字符、双向控制符和对文件系统 / 头部有特殊含义的字符，
// 再分别生成 ASCII 回退名（filename=）和 RFC 5987 编码名（filename*=），两者都不可能含 CR/LF、引号或分号。
// 扩展名只看对象真实存储的 Content-Type（R2 httpMetadata.contentType），不信上传时的文件名或存储键
const TYPE_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/pjpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/heic': 'heic', 'image/heif': 'heif', 'image/avif': 'avif', 'image/bmp': 'bmp',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/ogg': 'ogv', 'video/x-matroska': 'mkv',
  'video/x-msvideo': 'avi', 'video/3gpp': '3gp', 'video/3gpp2': '3g2', 'video/mpeg': 'mpg', 'video/mp2t': 'ts',
  'video/x-m4v': 'm4v', 'video/x-flv': 'flv', 'video/x-ms-wmv': 'wmv',
};
// 绝不能作为最终扩展名的类型（可执行 / 脚本 / 网页 / 快捷方式等）
const DANGEROUS_EXT = new Set(('exe com scr pif bat cmd msi msp dll cpl sys drv ocx js mjs cjs jse vbs vbe wsf wsh hta ps1 psm1 sh bash zsh ' +
  'command app dmg pkg apk jar class py pl rb php phtml asp aspx jsp cgi html htm xhtml shtml mht mhtml svg svgz xml xsl swf ' +
  'lnk url desktop reg inf scf iso img vhd chm hlp gadget appx msix').split(' '));
export function extForType(type) {
  const t = String(type || '').trim().toLowerCase();
  if (!SAFE_ATTACH_TYPE.test(t)) return 'bin';
  if (TYPE_EXT[t]) return TYPE_EXT[t];
  if (t.startsWith('video/')) {
    const sub = t.slice(6).replace(/^x-/, '').split('+')[0];
    if (/^[a-z0-9]{1,6}$/.test(sub) && !DANGEROUS_EXT.has(sub)) return sub;
  }
  return 'bin';
}
export function downloadName(name, key, type) {
  const fromKey = String(key || '').split('/').pop() || '';
  const clean = (v) => {
    let t = String(v == null ? '' : v).normalize('NFC');
    t = t.split(/[\/\\]/).pop();
    t = t.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, '');
    t = t.replace(/["*:<>?|;,%`$]/g, '_').replace(/\s+/g, ' ').trim().replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
    const cps = Array.from(t);
    if (cps.length > 120) {
      const m = t.match(/(\.[A-Za-z0-9]{1,8})$/); const ext = m ? m[1] : '';
      t = cps.slice(0, 120 - ext.length).join('') + ext;
    }
    return t;
  };
  let out = clean(name);
  if (!out) out = clean(fromKey);
  if (!out) out = 'attachment';
  // 最终扩展名一定是真实类型对应的扩展名：不一致就追加（保留原名信息，例如 x.html → x.html.png）
  const ext = extForType(type);
  const norm = (e) => { e = String(e || '').toLowerCase(); return e === 'jpeg' ? 'jpg' : e; };
  const cur = (out.match(/\.([A-Za-z0-9]{1,8})$/) || [])[1];
  if (norm(cur) !== ext) out += '.' + ext;
  return out;
}
export function contentDisposition(name, key, type) {
  const n = downloadName(name, key, type);
  let ascii = n.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  if (!/[A-Za-z0-9]/.test(ascii.replace(/\.[A-Za-z0-9]+$/, ''))) ascii = 'attachment' + ((n.match(/\.[A-Za-z0-9]{1,8}$/) || [''])[0]);
  const enc = encodeURIComponent(n).replace(/['()*!]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return 'attachment; filename="' + ascii + '"; filename*=UTF-8\'\'' + enc;
}
async function handleFile(request, env) {
  if (!env.FEEDBACK_BUCKET) return new Response('未绑定存储', { status: 500 });
  const sp = new URL(request.url).searchParams;
  const key = sp.get('key') || '';
  const wantDownload = sp.get('download') === '1';
  if (!FILE_KEY_RE.test(key) || key.includes('..')) return new Response('参数错误', { status: 400 });
  // 支持 Range（iOS Safari 播放视频需要 206 分段响应）
  let range = null;
  const rm = (request.headers.get('Range') || '').match(/^bytes=(\d*)-(\d*)$/);
  if (rm && (rm[1] || rm[2])) {
    if (rm[1]) { range = { offset: Number(rm[1]) }; if (rm[2]) range.length = Number(rm[2]) - Number(rm[1]) + 1; }
    else range = { suffix: Number(rm[2]) };
    if (range.length !== undefined && !(range.length > 0)) range = null;
  }
  let obj;
  try { obj = await env.FEEDBACK_BUCKET.get(key, range ? { range } : undefined); }
  catch { range = null; obj = await env.FEEDBACK_BUCKET.get(key); }
  if (!obj) return new Response('文件不存在', { status: 404 });
  const h = new Headers();
  h.set('Accept-Ranges', 'bytes');
  const type = (obj.httpMetadata && obj.httpMetadata.contentType) || '';
  if (SAFE_ATTACH_TYPE.test(type)) {
    h.set('Content-Type', type);
  } else {
    // 不在白名单的类型（SVG、HTML 等）一律按下载处理，不在本站域名下渲染
    h.set('Content-Type', 'application/octet-stream');
    h.set('Content-Disposition', 'attachment; filename="' + key.split('/').pop().replace(/[^A-Za-z0-9._-]/g, '_') + '"');
  }
  // ?download=1：强制下载并带上原文件名（name 参数可选，缺省用存储键的文件名）
  if (wantDownload) h.set('Content-Disposition', contentDisposition(sp.get('name'), key, type));
  let status = 200;
  if (range && obj.range && obj.size) {
    const r = obj.range;
    const start = r.suffix !== undefined ? Math.max(0, obj.size - r.suffix) : (r.offset || 0);
    const len = r.suffix !== undefined ? obj.size - start : (r.length !== undefined ? r.length : obj.size - start);
    const end = Math.min(obj.size - 1, start + len - 1);
    if (start >= obj.size) return new Response('范围无效', { status: 416, headers: { 'Content-Range': 'bytes */' + obj.size } });
    status = 206;
    h.set('Content-Range', 'bytes ' + start + '-' + end + '/' + obj.size);
    h.set('Content-Length', String(end - start + 1));
  } else if (obj.size) h.set('Content-Length', String(obj.size));
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Content-Security-Policy', "default-src 'none'; sandbox");
  h.set('Referrer-Policy', 'no-referrer');
  h.set('Cache-Control', 'private, max-age=300');
  return new Response(obj.body, { status, headers: h });
}

/* ---------------- 路由 ---------------- */
export async function handleApi(request, env) {
  const url = new URL(request.url);
  const p = url.pathname;
  const kv = env.FEEDBACK_KV ? guardKV(env.FEEDBACK_KV) : null;
  try {
    if (p === '/api/login') return await handleLogin(request, env, kv);
    if (p === '/api/logout') return handleLogout(request);
    const admin = await isAdmin(request, env);
    if (p === '/api/me') return json({ ok: true, admin, configured: !!env.FEEDBACK_ADMIN_KEY });
    if (!admin) return json({ ok: false, code: 'NEED_LOGIN', error: '请先登录' }, 401);
    if (p === '/api/file' && request.method === 'GET') return await handleFile(request, env);
    if (!kv) return json({ ok: false, error: '未绑定 KV' }, 500);
    if (p === '/api/feedback' && request.method === 'GET') return await handleList(request, env, kv);
    if (p === '/api/stats' && request.method === 'GET') return await handleStats(request, env, kv);
    if (p === '/api/failures' && request.method === 'GET') return await handleFailures(request, env, kv);
    if ((p === '/api/feedback' && request.method === 'DELETE') || (p === '/api/status' && request.method === 'POST')) {
      if (!isJson(request)) return json({ ok: false, error: '请求格式错误' }, 415);
      if (!sameOrigin(request)) return json({ ok: false, error: '禁止跨站请求' }, 403);
      return p === '/api/status' ? await handleStatus(request, env, kv) : await handleDelete(request, env, kv);
    }
    return json({ ok: false, error: '接口不存在' }, 404);
  } catch (e) {
    if (e instanceof KeyNotAllowed) return json({ ok: false, error: '禁止访问' }, 403);
    return json({ ok: false, error: '服务器出错，请稍后重试' }, 500);
  }
}

// 所有响应统一加的安全头
export const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
export const PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
export function withSecurityHeaders(resp) {
  const r = new Response(resp.body, resp);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) r.headers.set(k, v);
  // 附件响应自带更严格的 sandbox CSP，不覆盖
  if (!r.headers.has('Content-Security-Policy')) r.headers.set('Content-Security-Policy', PAGE_CSP);
  if ((r.headers.get('Content-Type') || '').includes('text/html')) r.headers.set('Cache-Control', 'no-store');
  return r;
}
