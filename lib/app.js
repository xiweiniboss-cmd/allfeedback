// allfeedback 统一反馈后台：后端逻辑（Pages Functions 通过 functions/api/[[route]].js 调用）
//
// 安全边界（重要）：FEEDBACK_KV 和 DeepSeek 站共用，里面还有用户账号、会话、聊天记录等。
// 本站对 KV 的所有访问都经过 guardKV()：
//   - 只能 list 前缀 fb_ / feedback_fb_（旧快手）的键；
//   - 只能 get / delete 反馈键（fb_… / feedback_fb_…），以及读写本站自己的状态键 fbstatus_v1 和登录失败计数 admfail_allfeedback_…；
//   - 其他任何键一律抛错，永远不会被读出或返回给前端。
// R2 只允许 fb/ 前缀的对象。

import { pfClassify, PF_SKIP_RE } from '../shared/pf-recorder.js';

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
// 解析失败统计：各解析站把失败写进 D1 parse_log（ok=0，见 shared/pf-recorder.js），本站只读、GROUP BY 统计，不碰 KV
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
      if (!(isFb(k) || k === STATUS_KEY || (typeof k === 'string' && k.startsWith(failPrefix)))) deny('get', k);
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

/* ---------------- 解析失败统计（只读，D1 parse_log） ---------------- */
export function pfDayList(now, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(dayCN(now - i * 86400000));
  return out; // 新 → 旧
}
const num = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Math.floor(Number(x)) : 0);
// 算「失败」的行：ok=0，且不是 3xx/4xx（输入不对、人机验证、频控、拉黑这些不算解析失败）
const PF_WHERE = 'ok = 0 AND (status >= 500 OR status < 300) AND ts >= ?';
const PF_GROUPS_MAX = 5000;
async function handleFailures(request, env, db) {
  const sp = new URL(request.url).searchParams;
  const range = sp.get('days') === '7' ? 7 : 30;
  const only = PF_SITES.includes(sp.get('site') || '') ? sp.get('site') : '';
  const now = Date.now();
  const days = pfDayList(now, PF_DAYS);
  const since = Date.parse(days[days.length - 1] + 'T00:00:00+08:00');
  const since7 = Date.parse(days[6] + 'T00:00:00+08:00');
  const sinceRange = range === 7 ? since7 : since;
  // 按 站点 × 北京日期 × 状态码 × 原因 聚合（走 ts 索引），原因归类在下面用 Map 做（「constructor」这类名字也不会算错）
  const g = await db.prepare('SELECT site, CAST((ts + 28800000) / 86400000 AS INTEGER) AS d, status, reason, COUNT(*) AS n FROM parse_log WHERE ' + PF_WHERE +
    ' GROUP BY site, d, status, reason LIMIT ' + PF_GROUPS_MAX).bind(since).all();
  const sm = await db.prepare('SELECT ts, site, url, status, reason FROM parse_log WHERE ' + PF_WHERE + (only ? ' AND site = ?' : '') + ' ORDER BY ts DESC LIMIT 120')
    .bind(...(only ? [sinceRange, only] : [sinceRange])).all();
  const sites = new Map(PF_SITES.map((s) => [s, { site: s, label: SITES[s] || s, n7: 0, n30: 0, today: 0 }]));
  const byDay = new Map(days.map((d) => [d, new Map()]));
  const reasons = new Map(), msgs = new Map();
  const dayOf = (d) => new Date(Number(d) * 86400000).toISOString().slice(0, 10);
  for (const x of (g && g.results) || []) {
    const site = String(x.site || '');
    const s = sites.get(site);
    if (!s) continue;
    const msg = str(x.reason, 160);
    if (PF_SKIP_RE.test(msg)) continue;
    const n = num(x.n);
    const day = dayOf(x.d);
    const idx = days.indexOf(day);
    if (idx < 0) continue;
    s.n30 += n;
    if (idx < 7) s.n7 += n;
    if (idx === 0) s.today += n;
    if (only && site !== only) continue;
    const bd = byDay.get(day);
    bd.set(site, (bd.get(site) || 0) + n);
    if (idx >= range) continue;
    const code = pfClassify(num(x.status), msg).code;
    const c = Object.prototype.hasOwnProperty.call(PF_REASONS, code) ? code : 'other';
    reasons.set(c, (reasons.get(c) || 0) + n);
    if (msg) msgs.set(msg, (msgs.get(msg) || 0) + n);
  }
  const samples = [];
  for (const x of (sm && sm.results) || []) {
    const msg = str(x.reason, 160);
    if (PF_SKIP_RE.test(msg) || !sites.has(String(x.site))) continue;
    const c = pfClassify(num(x.status), msg);
    samples.push({
      site: x.site, siteLabel: SITES[x.site] || x.site, t: num(x.ts), url: /^https?:\/\//i.test(String(x.url || '')) ? str(x.url, 300) : '',
      code: Object.prototype.hasOwnProperty.call(PF_REASONS, c.code) ? c.code : 'other', msg: str(msg, 120), st: num(x.status), up: c.up,
    });
    if (samples.length >= 50) break;
  }
  const total = [...reasons.values()].reduce((a, b) => a + b, 0);
  const obj = (m) => Object.fromEntries([...m].filter(([k]) => PF_SITES.includes(k)));
  return json({
    ok: true, range, site: only, total,
    sites: [...sites.values()].sort((a, b) => b.n30 - a.n30 || PF_SITES.indexOf(a.site) - PF_SITES.indexOf(b.site)),
    days: days.map((d) => { const m = byDay.get(d); return { day: d, sites: obj(m), total: [...m.values()].reduce((a, b) => a + b, 0) }; }),
    reasons: [...reasons].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([code, n]) => ({ code, label: PF_REASONS[code], n })),
    msgs: [...msgs].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([msg, n]) => ({ msg, n })),
    samples, siteNames: SITES,
  });
}

/* ---------------- 解析记录 / 拉黑（D1 parse_log，绑定名 PARSE_DB；不碰 KV） ---------------- */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const FP_RE = /^[0-9a-f]{32}$/;
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export function normBlockValue(type, value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  if (type === 'device') return UUID_RE.test(v) ? v : '';
  if (type === 'fp') return FP_RE.test(v) ? v : '';
  if (type !== 'ip') return '';
  if (IPV4_RE.test(v)) return v;
  // IPv6：统一按 /64 拉黑（同一用户的 IPv6 后半段经常变）
  if (/^[0-9a-f:.]{2,45}(::\/64)?$/.test(v) && v.includes(':')) {
    const k = ipLimitKey(v.replace(/::\/64$/, '::'));
    return /^[0-9a-f]{1,4}(:[0-9a-f]{1,4}){3}::\/64$/.test(k) ? k : '';
  }
  return '';
}
// 预览卡片：封面只给 https 图片链接（≤500 字），标题去控制字符（≤120 字），类型白名单
export const PREVIEW_MEDIA = ['video', 'image', 'images', 'mix', 'audio', 'live'];
export function previewCover(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s || s.length > 500 || !/^https:\/\//i.test(s)) return '';
  try { const u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password ? u.toString().slice(0, 500) : ''; } catch { return ''; }
}
export function previewTitle(v) {
  return Array.from(String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 120).join('');
}
const bjStart = (day) => Date.parse(day + 'T00:00:00+08:00');
async function blockSet(db) {
  const r = await db.prepare('SELECT type, value FROM blocklist LIMIT 5000').all();
  return new Set(((r && r.results) || []).map((x) => x.type + ':' + x.value));
}
async function handleParses(request, env, db) {
  const sp = new URL(request.url).searchParams;
  const where = [], args = [];
  const site = sp.get('site') || '';
  if (PF_SITES.includes(site)) { where.push('site = ?'); args.push(site); }
  const ip = str(sp.get('ip'), 64).trim().toLowerCase();
  if (ip) { where.push('ip = ?'); args.push(ip); }
  const dev = str(sp.get('device'), 64).trim().toLowerCase();
  if (dev) { where.push('device_id = ?'); args.push(dev); }
  const fp = str(sp.get('fp'), 64).trim().toLowerCase();
  if (fp) { where.push('fp = ?'); args.push(fp); }
  // 日期 → id 区间：id 和 ts 一起递增，先用 ts 索引各查 1 行定出 id 边界，主查询只按 id（rowid）范围 + 倒序走，不用整段重排
  const from = sp.get('from') || '', to = sp.get('to') || '';
  if (DAY_RE.test(from) && bjStart(from)) {
    const r = await db.prepare('SELECT id FROM parse_log WHERE ts >= ? ORDER BY ts LIMIT 1').bind(bjStart(from)).first();
    where.push('id >= ?'); args.push(r ? num(r.id) : Number.MAX_SAFE_INTEGER);
  }
  if (DAY_RE.test(to) && bjStart(to)) {
    const r = await db.prepare('SELECT id FROM parse_log WHERE ts < ? ORDER BY ts DESC LIMIT 1').bind(bjStart(to) + 86400000).first();
    where.push('id <= ?'); args.push(r ? num(r.id) : 0);
  }
  const res = sp.get('result');
  if (res === 'ok') where.push('ok = 1'); else if (res === 'fail') where.push('ok = 0');
  const before = parseInt(sp.get('before') || '', 10);
  if (before > 0) { where.push('id < ?'); args.push(before); }
  const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') || '50', 10) || 50));
  const tail = ' FROM parse_log' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY id DESC LIMIT ?';
  const cols = 'id, ts, site, url, ok, status, reason, ip, country, region, city, device_id, fp, ua';
  let r;
  try {
    r = await db.prepare('SELECT ' + cols + ', cover, title, media' + tail).bind(...args, limit + 1).all();
  } catch (e) {
    // 线上库还没执行 2026-11-19-preview.sql（没有 cover/title/media 列）：按旧列查，卡片显示占位
    if (!/no such column/i.test(String((e && e.message) || e))) throw e;
    r = await db.prepare('SELECT ' + cols + tail).bind(...args, limit + 1).all();
  }
  const list = (r && r.results) || [];
  const more = list.length > limit;
  const blocked = await blockSet(db);
  const items = list.slice(0, limit).map((x) => {
    const ip64 = ipLimitKey(x.ip || '');
    return {
      id: num(x.id), ts: num(x.ts), site: String(x.site || ''), siteLabel: SITES[x.site] || String(x.site || ''),
      url: /^https?:\/\//i.test(String(x.url || '')) ? str(x.url, 300) : '', ok: !!x.ok, status: num(x.status), reason: str(x.reason, 160),
      ip: str(x.ip, 64), ipBlockValue: normBlockValue('ip', x.ip || ''), country: str(x.country, 8), region: str(x.region, 60), city: str(x.city, 60),
      device: UUID_RE.test(String(x.device_id || '')) ? x.device_id : '', fp: FP_RE.test(String(x.fp || '')) ? x.fp : '', ua: str(x.ua, 200),
      cover: previewCover(x.cover), title: previewTitle(x.title), media: PREVIEW_MEDIA.includes(String(x.media || '')) ? String(x.media) : '',
      ipBlocked: !!x.ip && (blocked.has('ip:' + x.ip) || blocked.has('ip:' + ip64)),
      deviceBlocked: !!x.device_id && blocked.has('device:' + x.device_id),
      fpBlocked: !!x.fp && blocked.has('fp:' + x.fp),
    };
  });
  return json({ ok: true, items, more, cursor: more && items.length ? items[items.length - 1].id : null, siteNames: SITES });
}
// 拉黑指纹前的提示：这个指纹最近 30 天出现在多少个不同 IP / 设备上（同型号同浏览器的设备常常共用一个指纹）
async function handleFpStats(request, env, db) {
  const fp = normBlockValue('fp', new URL(request.url).searchParams.get('fp'));
  if (!fp) return json({ ok: false, error: '指纹格式不对（32 位十六进制）' }, 400);
  const r = await db.prepare('SELECT COUNT(*) AS n, COUNT(DISTINCT ip) AS ips, COUNT(DISTINCT device_id) AS devices FROM parse_log WHERE ts >= ? AND fp = ?')
    .bind(Date.now() - 30 * 86400000, fp).first();
  return json({ ok: true, fp, days: 30, n: num(r && r.n), ips: num(r && r.ips), devices: num(r && r.devices) });
}
async function handleBlocklistGet(request, env, db) {
  const r = await db.prepare('SELECT type, value, note, created_at FROM blocklist ORDER BY created_at DESC LIMIT 5000').all();
  return json({ ok: true, items: ((r && r.results) || []).map((x) => ({ type: x.type === 'device' || x.type === 'fp' ? x.type : 'ip', value: str(x.value, 64), note: str(x.note, 100), createdAt: num(x.created_at) })) });
}
async function handleBlock(request, env, db, add) {
  const b = await readBody(request);
  if (!b) return json({ ok: false, error: '请求格式错误' }, 400);
  const type = ['ip', 'device', 'fp'].includes(b.type) ? b.type : '';
  const value = type ? normBlockValue(type, b.value) : '';
  if (!value) return json({ ok: false, error: type === 'device' ? '设备 ID 格式不对' : type === 'fp' ? '指纹格式不对（32 位十六进制）' : 'IP 格式不对' }, 400);
  if (add) {
    const note = str(b.note, 100).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    await db.prepare('INSERT INTO blocklist (type, value, note, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(type, value) DO UPDATE SET note = excluded.note')
      .bind(type, value, note, Date.now()).run();
  } else {
    await db.prepare('DELETE FROM blocklist WHERE type = ? AND value = ?').bind(type, value).run();
  }
  return json({ ok: true, type, value, blocked: add });
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
    if (p === '/api/failures') {
      const db = env.PARSE_DB;
      if (!db || typeof db.prepare !== 'function') return json({ ok: false, error: '未绑定解析记录数据库（D1 PARSE_DB）' }, 500);
      if (request.method !== 'GET') return json({ ok: false, error: '方法不支持' }, 405);
      return await handleFailures(request, env, db);
    }
    if (p === '/api/parses' || p === '/api/fp-stats' || p === '/api/blocklist' || p === '/api/block' || p === '/api/unblock') {
      const db = env.PARSE_DB;
      if (!db || typeof db.prepare !== 'function') return json({ ok: false, error: '未绑定解析记录数据库（D1 PARSE_DB）' }, 500);
      if (p === '/api/parses' && request.method === 'GET') return await handleParses(request, env, db);
      if (p === '/api/fp-stats' && request.method === 'GET') return await handleFpStats(request, env, db);
      if (p === '/api/blocklist' && request.method === 'GET') return await handleBlocklistGet(request, env, db);
      if ((p === '/api/block' || p === '/api/unblock') && request.method === 'POST') {
        if (!isJson(request)) return json({ ok: false, error: '请求格式错误' }, 415);
        if (!sameOrigin(request)) return json({ ok: false, error: '禁止跨站请求' }, 403);
        return await handleBlock(request, env, db, p === '/api/block');
      }
      return json({ ok: false, error: '方法不支持' }, 405);
    }
    if (!kv) return json({ ok: false, error: '未绑定 KV' }, 500);
    if (p === '/api/feedback' && request.method === 'GET') return await handleList(request, env, kv);
    if (p === '/api/stats' && request.method === 'GET') return await handleStats(request, env, kv);
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
export const PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: https:; media-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
export function withSecurityHeaders(resp) {
  const r = new Response(resp.body, resp);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) r.headers.set(k, v);
  // 附件响应自带更严格的 sandbox CSP，不覆盖
  if (!r.headers.has('Content-Security-Policy')) r.headers.set('Content-Security-Policy', PAGE_CSP);
  if ((r.headers.get('Content-Type') || '').includes('text/html')) r.headers.set('Cache-Control', 'no-store');
  return r;
}
