import { handleApi } from '../lib/app.js';

export const ADMIN_KEY = 'test-admin-key-not-real';
export const ORIGIN = 'https://allfeedback.pages.dev';

export function memKV(init = {}) {
  const m = new Map(Object.entries(init));
  const log = [];
  return {
    m, log,
    async get(k) { log.push(['get', k]); return m.has(k) ? m.get(k) : null; },
    async put(k, v, o) { log.push(['put', k, o]); m.set(k, String(v)); },
    async delete(k) { log.push(['delete', k]); m.delete(k); },
    async list({ prefix = '', cursor, limit = 1000 } = {}) {
      log.push(['list', prefix]);
      const all = [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const keys = all.slice(start, start + limit).map((name) => ({ name }));
      const done = start + limit >= all.length;
      return { keys, list_complete: done, cursor: done ? undefined : String(start + limit) };
    },
  };
}
export function memR2(init = {}) {
  const m = new Map(Object.entries(init)); // key -> {data: Uint8Array, type}
  const deleted = [];
  return {
    m, deleted,
    async get(k, opts) {
      const o = m.get(k);
      if (!o) return null;
      let data = o.data, range;
      if (opts && opts.range) {
        range = opts.range;
        const start = range.suffix !== undefined ? o.data.length - range.suffix : range.offset;
        const len = range.suffix !== undefined ? range.suffix : (range.length ?? o.data.length - start);
        data = o.data.slice(start, start + len);
      }
      return { body: data, size: o.data.length, httpMetadata: { contentType: o.type }, range };
    },
    async delete(k) { deleted.push(k); m.delete(k); },
  };
}

export function seed() {
  const now = Date.UTC(2026, 10, 14, 4, 0, 0); // 2026-11-14 12:00 UTC+8
  const b36 = (t) => t.toString(36);
  const parse = (site, t, extra = {}) => ['fb_' + b36(t) + '_abc' + site.slice(0, 3), JSON.stringify({
    id: 'fb_' + b36(t) + '_abc' + site.slice(0, 3), message: site + ' 解析不了', kind: '解析失败',
    link: 'https://v.example/' + site, contact: 'qq123', page: 'https://' + site + 'jiexi.pages.dev/',
    attachments: [], ua: 'UA', ip: '1.2.3.4', geo: { country: 'CN', region: 'GD', city: 'SZ' }, time: new Date(t).toISOString(), ...extra,
  })];
  const ds = (tag, t, text, extra = {}) => ['fb_' + t + 'x1y2', JSON.stringify({ id: 'fb_' + t + 'x1y2', site: tag, text, contact: '', files: [], ip: '5.6.7.8', cc: 'CN', region: 'BJ', city: 'BJ', t, ...extra })];
  const kv = Object.fromEntries([
    parse('douyin', now - 1000),
    parse('xiaohongshu', now - 2000, { attachments: [{ key: 'fb/xhs/1.png', type: 'image/png', name: '截图.png', size: 4 }] }),
    parse('bilibili', now - 86400000, { kind: '下载失败', message: '<img src=x onerror=alert(1)> 下载慢' }),
    parse('youtube', now - 3000),
    parse('tiktok', now - 4000),
    parse('kuaishou', now - 5000),
    ds('[DeepSeek站]', now - 6000, '【其他】DeepSeek 站反馈', { files: [{ key: 'fb/1731_ab_a.svg', name: 'a.svg', type: 'image/svg+xml' }] }),
    ds('[智驾站]', now - 7000, '智驾模拟器 卡顿'),
    ['feedback_fb_' + b36(now - 8000) + '_old', JSON.stringify({ message: '旧快手', time: new Date(now - 8000).toISOString() })],
    // 共用 KV 里的非反馈数据：绝不能被列出 / 读取 / 删除
    ['sess_abcdef', JSON.stringify({ user: 'alice', token: 'SECRET-SESSION' })],
    ['conv_123', JSON.stringify({ messages: ['private chat'] })],
    ['user_alice', JSON.stringify({ pw: 'hash' })],
    ['pricing2', '{}'],
  ]);
  const r2 = {
    'fb/xhs/1.png': { data: new Uint8Array([1, 2, 3, 4]), type: 'image/png' },
    'fb/1731_ab_a.svg': { data: new TextEncoder().encode('<svg onload=alert(1)>'), type: 'image/svg+xml' },
    'fb/v.mp4': { data: new Uint8Array(100), type: 'video/mp4' },
    'fb/x.html': { data: new TextEncoder().encode('<script>alert(1)</script>'), type: 'text/html' },
  };
  return { now, kv, r2 };
}

export function makeEnv(opts = {}) {
  const s = seed();
  return { env: { FEEDBACK_ADMIN_KEY: ADMIN_KEY, FEEDBACK_KV: memKV(s.kv), FEEDBACK_BUCKET: memR2(s.r2), ...opts }, seed: s };
}

export async function call(env, path, { method = 'GET', body, cookie, headers = {}, ip = '9.9.9.9' } = {}) {
  const h = new Headers({ 'cf-connecting-ip': ip, ...headers });
  if (body !== undefined && !h.has('content-type')) h.set('content-type', 'application/json');
  if (body !== undefined && !h.has('origin')) h.set('origin', ORIGIN);
  if (cookie) h.set('cookie', cookie);
  const req = new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const res = await handleApi(req, env);
  return res;
}

export async function login(env) {
  const r = await call(env, '/api/login', { method: 'POST', body: { key: ADMIN_KEY } });
  if (r.status !== 200) throw new Error('login failed ' + r.status);
  return r.headers.get('set-cookie').split(';')[0];
}
