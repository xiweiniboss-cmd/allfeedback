// 解析记录预览卡片：parse-log v3 的 plMeta（封面 / 标题 / 类型）、迁移前后的写入兼容、/api/parses 返回、CSP、前端渲染约束
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createParseLog, plPass, plMeta, plCleanMeta } from '../shared/parse-log.js';
import { PAGE_CSP, previewCover, previewTitle } from '../lib/app.js';
import { fakeD1 } from './d1.mjs';
import { makeEnv, call, login } from './helpers.mjs';

const DEV = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const OLD_SCHEMA = `CREATE TABLE parse_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, site TEXT NOT NULL, url TEXT NOT NULL DEFAULT '', ok INTEGER NOT NULL DEFAULT 0, status INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL DEFAULT '', ip TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '', region TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', device_id TEXT NOT NULL DEFAULT '', ua TEXT NOT NULL DEFAULT '', fp TEXT NOT NULL DEFAULT '');
CREATE TABLE blocklist (type TEXT NOT NULL CHECK (type IN ('ip','device','fp')), value TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, PRIMARY KEY (type, value));`;
const MIGRATION = readFileSync(new URL('../shared/migrations/2026-11-19-preview.sql', import.meta.url), 'utf8');
const oldD1 = () => { const d1 = fakeD1({ schema: false }); d1.db.exec(OLD_SCHEMA); return d1; };
const jsonResp = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
function req(u = 'https://v.douyin.com/abc/') {
  const r = new Request('https://douyinqushuiyin.pages.dev/api/parse?url=' + encodeURIComponent(u), { headers: { 'cf-connecting-ip': '203.0.113.5', 'x-device-id': DEV, 'user-agent': 'UA' } });
  Object.defineProperty(r, 'cf', { value: { country: 'CN', region: '广东', city: '深圳' } });
  return r;
}
function ctxs() { const jobs = []; return { ctx: { waitUntil: (p) => jobs.push(p) }, drain: async () => { while (jobs.length) await jobs.shift(); } }; }
const rows = (d1) => d1.db.prepare('SELECT * FROM parse_log ORDER BY id').all();
// 模拟站点：过了人机验证 / 频控（plPass），解析成功后 plMeta，再返回
async function parse(pl, env, ctx, meta, resp = jsonResp({ ok: true })) {
  const r = req();
  return pl.wrap(r, env, ctx, async () => { plPass(r); if (meta) plMeta(r, meta); return resp; });
}

test('plCleanMeta：封面只收 https（// 补 https:，http 升 https），≤500 字；标题去控制字符 ≤120 字；类型白名单', () => {
  assert.deepEqual(plCleanMeta({ cover: 'https://p3.douyinpic.com/a.jpg?x=1', title: '标题', media: 'video' }),
    { cover: 'https://p3.douyinpic.com/a.jpg?x=1', title: '标题', media: 'video' });
  assert.equal(plCleanMeta({ cover: '//i0.hdslb.com/bfs/a.jpg' }).cover, 'https://i0.hdslb.com/bfs/a.jpg');
  assert.equal(plCleanMeta({ cover: 'http://i0.hdslb.com/bfs/a.jpg' }).cover, 'https://i0.hdslb.com/bfs/a.jpg');
  for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'ftp://x/a.jpg', '/relative.jpg', 'https://u:p@x.com/a.jpg', 'https://x.com/' + 'a'.repeat(500), 123, null])
    assert.equal(plCleanMeta({ cover: bad }).cover, '', String(bad).slice(0, 40));
  const t = plCleanMeta({ title: 'a\u0000b\nc\u202e\td\u200b' + '字'.repeat(200) }).title;
  assert.ok(!/[\u0000-\u001f\u202e\u200b]/.test(t), t);
  assert.equal(Array.from(t).length, 120);
  assert.ok(t.startsWith('a b c d'));
  assert.equal(plCleanMeta({ title: '😀'.repeat(130) }).title, '😀'.repeat(120), '按字符截断，不切坏表情');
  for (const m of ['video', 'image', 'images', 'mix', 'VIDEO']) assert.equal(plCleanMeta({ media: m }).media, m.toLowerCase());
  for (const m of ['', 'exe', '<b>', 'video ']) assert.equal(plCleanMeta({ media: m }).media, m.trim() === 'video' ? 'video' : '');
  assert.deepEqual(plCleanMeta(null), { cover: '', title: '', media: '' });
});

test('迁移后：成功记录带上封面 / 标题 / 类型；失败记录不带；没调 plMeta 的为空串', async () => {
  const d1 = fakeD1(); const { ctx, drain } = ctxs();
  const pl = createParseLog('douyin'); const env = { PARSE_DB: d1 };
  await parse(pl, env, ctx, { cover: 'https://p3.douyinpic.com/c.jpg', title: '  一个\n视频  ', media: 'video' });
  await parse(pl, env, ctx, { cover: 'https://p3.douyinpic.com/c.jpg', title: 't', media: 'video' }, jsonResp({ ok: false, error: '上游挂了' }, 502));
  await parse(pl, env, ctx, null);
  await drain();
  const r = rows(d1);
  assert.equal(r.length, 3);
  assert.deepEqual([r[0].ok, r[0].cover, r[0].title, r[0].media], [1, 'https://p3.douyinpic.com/c.jpg', '一个 视频', 'video']);
  assert.deepEqual([r[1].ok, r[1].cover, r[1].title, r[1].media], [0, '', '', '']);
  assert.deepEqual([r[2].ok, r[2].cover, r[2].title, r[2].media], [1, '', '', '']);
  assert.equal(r[0].ip, '203.0.113.5'); assert.equal(r[0].device_id, DEV);
});

test('迁移前（没有 cover/title/media 列）：退回旧列照样写进去，响应不受影响；之后 10 分钟直接写旧列', async () => {
  const d1 = oldD1(); const { ctx, drain } = ctxs();
  let t = 1_700_000_000_000;
  const pl = createParseLog('douyin', { now: () => t }); const env = { PARSE_DB: d1 };
  const meta = { cover: 'https://p3.douyinpic.com/c.jpg', title: 'x', media: 'video' };
  const resp = await parse(pl, env, ctx, meta);
  assert.equal(resp.status, 200);
  await drain();
  assert.equal(rows(d1).length, 1);
  const metaInserts = () => d1.log.filter((s) => /INSERT INTO parse_log .*cover/.test(s)).length;
  assert.equal(metaInserts(), 1);
  await parse(pl, env, ctx, meta); await drain();
  assert.equal(rows(d1).length, 2);
  assert.equal(metaInserts(), 1, '10 分钟内不再试新列');
  // 用户执行了迁移，10 分钟后自动用上新列
  d1.db.exec(MIGRATION);
  t += 600_001;
  await parse(pl, env, ctx, meta); await drain();
  const r = rows(d1);
  assert.equal(r.length, 3);
  assert.deepEqual([r[0].cover, r[1].cover, r[2].cover], ['', '', 'https://p3.douyinpic.com/c.jpg'], '迁移给旧记录补空串');
});

test('带预览的写入遇到别的错误（超时 / D1 抖动）：不退回重写（避免写两行），也不抛', async () => {
  const d1 = fakeD1(); const { ctx, drain } = ctxs();
  const orig = d1.prepare.bind(d1);
  let legacy = 0;
  d1.prepare = (sql) => {
    if (/cover/.test(sql)) return { bind() { return this; }, async run() { throw new Error('D1_ERROR: network connection lost'); } };
    if (/^INSERT/.test(sql)) legacy++;
    return orig(sql);
  };
  const pl = createParseLog('douyin');
  const resp = await parse(pl, { PARSE_DB: d1 }, ctx, { title: 'x' });
  assert.equal(resp.status, 200);
  await drain();
  assert.equal(legacy, 0);
  assert.equal(rows(d1).length, 0);
});

test('plMeta 出什么错都不影响解析：非对象请求、奇怪的 meta', async () => {
  plMeta(null, { title: 'x' }); plMeta('x', { title: 'x' });
  const d1 = fakeD1(); const { ctx, drain } = ctxs();
  const pl = createParseLog('douyin');
  const evil = { get cover() { throw new Error('boom'); } };
  const resp = await parse(pl, { PARSE_DB: d1 }, ctx, evil);
  assert.equal(resp.status, 200);
  await drain();
  assert.equal(rows(d1).length, 1);
});

test('迁移 SQL 只做加法：三条 ADD COLUMN，没有 DROP / UPDATE / DELETE', () => {
  const sql = MIGRATION.split('\n').filter((l) => !l.startsWith('--')).join('\n');
  assert.equal((sql.match(/ALTER TABLE parse_log ADD COLUMN/g) || []).length, 3);
  assert.ok(!/\b(DROP|DELETE|UPDATE|INSERT)\b/i.test(sql));
  const d1 = oldD1();
  d1.db.prepare("INSERT INTO parse_log (ts, site) VALUES (1, 'douyin')").run();
  d1.db.exec(MIGRATION);
  assert.deepEqual({ ...d1.db.prepare('SELECT cover, title, media FROM parse_log').get() }, { cover: '', title: '', media: '' });
});

function seed(d1, withMeta) {
  const t = Date.now();
  if (withMeta) {
    const ins = d1.db.prepare('INSERT INTO parse_log (ts, site, url, ok, status, ip, cover, title, media) VALUES (?,?,?,?,?,?,?,?,?)');
    ins.run(t - 2, 'bilibili', 'https://b23.tv/x', 1, 200, '1.1.1.1', 'https://i0.hdslb.com/a.jpg', '标题\u0007<b>x</b>', 'video');
    ins.run(t - 1, 'douyin', 'https://v.douyin.com/y/', 1, 200, '1.1.1.1', 'javascript:alert(1)', 't'.repeat(300), 'exe');
    ins.run(t, 'weibo', 'https://weibo.com/1', 1, 200, '1.1.1.1', 'http://wx1.sinaimg.cn/a.jpg', '', 'images');
  } else {
    d1.db.prepare('INSERT INTO parse_log (ts, site, url, ok, status, ip) VALUES (?,?,?,?,?,?)').run(t, 'douyin', 'https://v.douyin.com/z/', 1, 200, '1.1.1.1');
  }
}
test('/api/parses：返回 cover / title / media（封面只给 https，标题去控制字符，类型白名单）', async () => {
  const d1 = fakeD1(); seed(d1, true);
  const { env } = makeEnv({ PARSE_DB: d1 });
  const j = await (await call(env, '/api/parses', { cookie: await login(env) })).json();
  assert.equal(j.ok, true);
  const [w, dy, bl] = j.items;
  assert.deepEqual([bl.cover, bl.title, bl.media], ['https://i0.hdslb.com/a.jpg', '标题 <b>x</b>', 'video']);
  assert.deepEqual([dy.cover, dy.title.length, dy.media], ['', 120, '']);
  assert.deepEqual([w.cover, w.title, w.media], ['', '', 'images'], 'http 封面不给（存的时候已经升成 https）');
});

test('/api/parses：线上库还没迁移（没有新列）也能查，cover / title / media 为空串', async () => {
  const d1 = oldD1(); seed(d1, false);
  const { env } = makeEnv({ PARSE_DB: d1 });
  const j = await (await call(env, '/api/parses', { cookie: await login(env) })).json();
  assert.equal(j.ok, true);
  assert.equal(j.items.length, 1);
  assert.deepEqual([j.items[0].cover, j.items[0].title, j.items[0].media], ['', '', '']);
});

test('previewCover / previewTitle', () => {
  assert.equal(previewCover('https://a.com/x.jpg'), 'https://a.com/x.jpg');
  for (const bad of ['', 'http://a.com/x.jpg', 'javascript:1', 'https://u:p@a.com/x', 'https://a.com/' + 'x'.repeat(500), null]) assert.equal(previewCover(bad), '');
  assert.equal(previewTitle('a\u0007b\u2066c'), 'a b c');
});

test('CSP：img-src 放开 https: 外链图片，script-src / style-src 仍只允许本站，_headers 和中间件一致', () => {
  const dir = (csp) => Object.fromEntries(csp.split(';').map((x) => x.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  const d = dir(PAGE_CSP);
  assert.deepEqual(d['img-src'], ["'self'", 'blob:', 'https:']);
  assert.deepEqual(d['script-src'], ["'self'"]);
  assert.deepEqual(d['style-src'], ["'self'"]);
  assert.deepEqual(d['default-src'], ["'none'"]);
  const hdr = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8').match(/Content-Security-Policy:\s*(.+)/)[1].trim();
  assert.equal(hdr, PAGE_CSP);
});

test('前端预览卡片：无 referrer、懒加载、新标签打开带 noopener noreferrer、失败占位；不拼 HTML、没有内联脚本 / 样式', () => {
  const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const fn = js.slice(js.indexOf('function plThumb('), js.indexOf('function plRow('));
  assert.match(fn, /referrerPolicy = 'no-referrer'/);
  assert.match(fn, /setAttribute\('referrerpolicy', 'no-referrer'\)/);
  assert.match(fn, /loading = 'lazy'/);
  assert.match(fn, /addEventListener\('error'/);
  assert.equal((fn.match(/rel = 'noopener noreferrer'/g) || []).length, 2);
  assert.equal((fn.match(/target = '_blank'/g) || []).length, 2);
  assert.ok(!/innerHTML|insertAdjacentHTML|\.style\./.test(fn));
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), '没有内联脚本');
  assert.ok(!/<style\b|\sstyle=/i.test(html), '没有内联样式');
});

test('code 200 + msg empty（微博没有图片 / 视频）记成失败，不带预览（原来只在微博站副本里，v3 并入原件）', async () => {
  const d1 = fakeD1(); const { ctx, drain } = ctxs();
  const pl = createParseLog('weibo');
  await parse(pl, { PARSE_DB: d1 }, ctx, { title: 'x' }, jsonResp({ code: 200, msg: 'empty', data: {} }));
  await parse(pl, { PARSE_DB: d1 }, ctx, { title: 'y' }, jsonResp({ code: 200, msg: 'ok', data: {} }));
  await drain();
  const r = rows(d1);
  assert.deepEqual([r[0].ok, r[0].reason, r[0].title], [0, '没有解析到图片或视频', '']);
  assert.deepEqual([r[1].ok, r[1].reason, r[1].title], [1, '', 'y']);
});
