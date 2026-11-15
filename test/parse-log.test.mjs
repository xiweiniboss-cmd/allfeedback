import test from 'node:test';
import assert from 'node:assert/strict';
import { createParseLog, plPass, plCleanUrl, plScrub, plDevice, plFp, plIp64, plIsPreview, PL_WRITE_TIMEOUT_MS } from '../shared/parse-log.js';
import { fakeD1 } from './d1.mjs';

const DEV = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const FP = '0123456789abcdef0123456789abcdef';
const jsonResp = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
function req(u, { ip = '203.0.113.5', dev = DEV, fp, method = 'GET', body, ua = 'UA-test', host = 'https://douyinqushuiyin.pages.dev' } = {}) {
  const h = { 'cf-connecting-ip': ip, 'user-agent': ua };
  if (dev) h['x-device-id'] = dev;
  if (fp) h['x-device-fp'] = fp;
  if (body) h['content-type'] = 'application/json';
  const r = new Request(host + '/api/parse' + (method === 'GET' ? '?url=' + encodeURIComponent(u) : ''), { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  Object.defineProperty(r, 'cf', { value: { country: 'cn', region: '广东', city: '深圳' } });
  return r;
}
// 模拟站点：过了人机验证和频控（plPass）再返回 resp
const passed = (r, make) => async () => { plPass(r); return typeof make === 'function' ? make() : make; };
function ctxs() { const jobs = []; return { ctx: { waitUntil: (p) => jobs.push(p) }, jobs, drain: async () => { while (jobs.length) await jobs.shift(); } }; }
const rows = (d1) => d1.db.prepare('SELECT * FROM parse_log ORDER BY id').all();
async function go(pl, env, ctx, u, resp, o) { const r = req(u, o); return pl.wrap(r, env, ctx, passed(r, () => resp)); }

test('plDevice 只认 UUID；plIp64；plCleanUrl 去令牌；plScrub 去掉原因里链接的令牌', () => {
  const r = (v) => new Request('https://x/', { headers: v == null ? {} : { 'x-device-id': v } });
  assert.equal(plDevice(r(DEV.toUpperCase())), DEV);
  for (const bad of ['', 'abc', DEV + 'x', 'd1abc23xyz', "'; DROP TABLE x;--", DEV.replace(/-/g, '')]) assert.equal(plDevice(r(bad)), '', bad);
  assert.equal(plDevice(r(null)), '');
  assert.equal(plIp64('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64');
  assert.equal(plIp64('1.2.3.4'), '1.2.3.4');
  assert.equal(plCleanUrl('看 https://www.xiaohongshu.com/explore/a?xsec_token=S&x=1 打开'), 'https://www.xiaohongshu.com/explore/a');
  const s = plScrub('上游 HTTP 403：https://api.x.com/p?url=1&token=SECRET1，换 https://cdn.x.com/a.mp4?auth_key=SECRET2。');
  assert.ok(!/SECRET/.test(s), s);
  assert.equal(s, '上游 HTTP 403：https://api.x.com/p，换 https://cdn.x.com/a.mp4。');
});

test('成功 / 失败 / 4xx 都记一行：站点、去令牌链接、IP、归属地、设备、UA、结果；原因里的链接去令牌', async () => {
  const d1 = fakeD1(); const { ctx, drain } = ctxs();
  const pl = createParseLog('douyin');
  const env = { PARSE_DB: d1 };
  const r1 = await go(pl, env, ctx, 'https://v.douyin.com/a/?share_token=SECRET', jsonResp({ ok: true, video: 'x' }));
  assert.equal(r1.status, 200);
  assert.equal((await r1.json()).video, 'x', '响应原样返回');
  await go(pl, env, ctx, 'https://v.douyin.com/b/', jsonResp({ ok: false, error: '上游返回 HTTP 500 https://redfox.hk/x?key=SECRET3' }, 502));
  await go(pl, env, ctx, 'https://v.douyin.com/c/', jsonResp({ code: -1, msg: '视频已删除' }), { dev: 'not-a-uuid' });
  await go(pl, env, ctx, 'https://example.com/x', jsonResp({ ok: false, error: '只支持抖音链接' }, 400));
  await go(pl, env, ctx, 'https://weibo.com/1/a', jsonResp({ code: 200, msg: 'ok', data: {} }));
  await go(pl, env, ctx, 'https://weibo.com/1/b', jsonResp({ code: 400, msg: '没有找到图片或视频' }));
  await drain();
  const rs = rows(d1);
  assert.equal(rs.length, 6);
  assert.deepEqual([rs[4].ok, rs[5].ok, rs[5].reason], [1, 0, '没有找到图片或视频'], '微博：code 200 成功、HTTP 200 + code 400 失败');
  assert.deepEqual([rs[0].site, rs[0].url, rs[0].ok, rs[0].status, rs[0].ip, rs[0].country, rs[0].region, rs[0].city, rs[0].device_id, rs[0].ua],
    ['douyin', 'https://v.douyin.com/a/', 1, 200, '203.0.113.5', 'CN', '广东', '深圳', DEV, 'UA-test']);
  assert.deepEqual([rs[1].ok, rs[1].status, rs[1].reason], [0, 502, '上游返回 HTTP 500 https://redfox.hk/x']);
  assert.deepEqual([rs[2].ok, rs[2].reason, rs[2].device_id], [0, '视频已删除', ''], '200 + code≠0 算失败；非法设备 ID 不存');
  assert.deepEqual([rs[3].ok, rs[3].status], [0, 400]);
  assert.ok(!JSON.stringify(rs).includes('SECRET'));
});

test('没过人机验证 / 频控（站点没调 plPass）：一行都不写，响应照旧', async () => {
  const d1 = fakeD1(); const { ctx, drain } = ctxs();
  const pl = createParseLog('douyin');
  const env = { PARSE_DB: d1 };
  for (let i = 0; i < 200; i++) {
    const r = await pl.wrap(req('https://v.douyin.com/a/'), env, ctx, async () => jsonResp({ ok: false, error: i % 2 ? '请先完成人机验证' : '解析太频繁' }, i % 2 ? 400 : 429));
    assert.ok(r.status === 400 || r.status === 429);
  }
  // 抛异常但还没过关：也不记
  await assert.rejects(pl.wrap(req('https://v.douyin.com/a/'), env, ctx, async () => { throw new Error('before gate'); }));
  await drain();
  assert.equal(rows(d1).length, 0);
  assert.equal(d1.log.filter((q) => q.startsWith('INSERT')).length, 0, '没有任何写入');
});

test('POST JSON（快手）也能取到链接，处理函数照样能读 body', async () => {
  const d1 = fakeD1(); const { ctx, drain } = ctxs();
  const pl = createParseLog('kuaishou');
  const r = req('', { method: 'POST', body: { url: 'https://v.kuaishou.com/x?shareToken=S' } });
  let seen = '';
  await pl.wrap(r, { PARSE_DB: d1 }, ctx, async () => { seen = (await r.json()).url; plPass(r); return jsonResp({ ok: true }); });
  await drain();
  assert.ok(seen.startsWith('https://v.kuaishou.com/x'));
  assert.equal(rows(d1)[0].url, 'https://v.kuaishou.com/x');
});

test('拉黑 IP / IPv6 /64 / 设备：返回 403「访问受限」，不调用解析；同一名单项每分钟只记一行（换设备头也一样）', async () => {
  const d1 = fakeD1(); const { ctx, drain } = ctxs();
  d1.db.prepare("INSERT INTO blocklist (type, value, note, created_at) VALUES ('ip','198.51.100.9','',1), ('ip','2001:db8:1:2::/64','',1), ('device',?, '',1)").run('11111111-2222-4333-8444-555555555555');
  const pl = createParseLog('bilibili');
  const env = { PARSE_DB: d1 };
  let called = 0;
  const run = (r) => passed(r, () => { called++; return jsonResp({ ok: true }); });
  for (const o of [{ ip: '198.51.100.9' }, { ip: '2001:db8:1:2:aaaa:bbbb:cccc:dddd' }, { dev: '11111111-2222-4333-8444-555555555555' }]) {
    const q = req('https://b23.tv/x', o);
    const r = await pl.wrap(q, env, ctx, run(q));
    assert.equal(r.status, 403);
    const j = await r.json();
    assert.equal(j.error, '访问受限');
    assert.equal(j.msg, '访问受限', 'TikTok 前端读 msg');
  }
  // 被拉黑的 IP 换 100 个随机设备 ID / 指纹来刷：仍然只记 1 行
  for (let i = 0; i < 100; i++) {
    const q = req('https://b23.tv/x', { ip: '198.51.100.9', dev: crypto.randomUUID(), fp: i.toString(16).padStart(32, '0') });
    assert.equal((await pl.wrap(q, env, ctx, run(q))).status, 403);
  }
  assert.equal(called, 0);
  const q = req('https://b23.tv/x', { ip: '198.51.100.10' });
  assert.equal((await pl.wrap(q, env, ctx, run(q))).status, 200);
  assert.equal(called, 1);
  await drain();
  const rs = rows(d1);
  assert.equal(rs.filter((x) => x.status === 403).length, 3, '三个名单项各记一行');
});

test('名单缓存 60 秒；过期后先用旧名单、后台刷新（不让用户等），下一次请求用上新名单', async () => {
  const d1 = fakeD1(); const { ctx, drain, jobs } = ctxs();
  let t = 1_000_000;
  const pl = createParseLog('youtube', { now: () => t });
  const env = { PARSE_DB: d1 };
  d1.db.prepare("INSERT INTO blocklist VALUES ('ip','203.0.113.5','',1)").run();
  const g = () => go(pl, env, ctx, 'https://youtu.be/x', jsonResp({ ok: true }));
  assert.equal((await g()).status, 403, '冷启动：等一次名单');
  d1.db.prepare('DELETE FROM blocklist').run();
  t += 30000; assert.equal((await g()).status, 403, '缓存期内');
  t += 31000;
  // 过期：这次用旧名单（仍拦），刷新放进 waitUntil
  const before = jobs.length;
  assert.equal((await g()).status, 403, '过期那一下用旧名单，不等 D1');
  assert.ok(jobs.length > before, '刷新交给 waitUntil');
  await drain();
  assert.equal((await g()).status, 200, '刷新完成后放行');
  await drain();
  assert.equal(d1.log.filter((s) => s.startsWith('SELECT type, value FROM blocklist')).length, 2);
});

test('名单过期时 D1 卡住：用户请求不等（用旧名单立刻返回）', async () => {
  let t = 2_000_000;
  let hang = false;
  const d1 = fakeD1();
  const db = { prepare: (sql) => (hang && sql.startsWith('SELECT type') ? { bind() { return this; }, all: () => new Promise(() => {}) } : d1.prepare(sql)) };
  const pl = createParseLog('douyin', { now: () => t });
  const env = { PARSE_DB: db };
  const ctx = { waitUntil() {} };
  await go(pl, env, ctx, 'https://v.douyin.com/x', jsonResp({ ok: true }));
  hang = true; t += 61000;
  const t0 = Date.now();
  assert.equal((await go(pl, env, ctx, 'https://v.douyin.com/x', jsonResp({ ok: true }))).status, 200);
  assert.ok(Date.now() - t0 < 200, '没等 D1');
});

test('D1 出错 / 超时 / 没绑定：放行（fail open），响应不受影响', async () => {
  const { ctx, drain } = ctxs();
  const d1 = fakeD1(); d1.fail = true;
  const r = await go(createParseLog('tiktok'), { PARSE_DB: d1 }, ctx, 'https://vm.tiktok.com/x', jsonResp({ code: 0 }));
  assert.equal(r.status, 200);
  const hang = { prepare: () => ({ bind() { return this; }, all: () => new Promise(() => {}), run: () => new Promise(() => {}) }) };
  const t0 = Date.now();
  const r2 = await go(createParseLog('tiktok'), { PARSE_DB: hang }, { waitUntil() {} }, 'https://vm.tiktok.com/x', jsonResp({ code: 0 }));
  assert.equal(r2.status, 200);
  assert.ok(Date.now() - t0 < 3000, '冷启动 D1 卡住时 1.5 秒超时放行');
  const r3 = await go(createParseLog('tiktok'), {}, ctx, 'https://vm.tiktok.com/x', jsonResp({ code: 0 }));
  assert.equal(r3.status, 200);
  await drain();
});

test('写入卡住最多等 10 秒', () => { assert.equal(PL_WRITE_TIMEOUT_MS, 10000); });

test('出错时沿用上一次读到的名单（不会因为 D1 抖一下就解封）', async () => {
  const d1 = fakeD1(); const { ctx, drain } = ctxs();
  let t = 5_000_000;
  const pl = createParseLog('douyin', { now: () => t });
  d1.db.prepare("INSERT INTO blocklist VALUES ('ip','203.0.113.5','',1)").run();
  const g = () => go(pl, { PARSE_DB: d1 }, ctx, 'https://v.douyin.com/x', jsonResp({ ok: true }));
  assert.equal((await g()).status, 403);
  d1.fail = true; t += 61000;
  assert.equal((await g()).status, 403);
  await drain();
  assert.equal((await g()).status, 403);
  await drain();
});

test('处理函数过关后抛异常：记一行后照样抛出', async () => {
  const d1 = fakeD1(); const { ctx, drain } = ctxs();
  const r = req('https://xhslink.com/a');
  await assert.rejects(createParseLog('xiaohongshu').wrap(r, { PARSE_DB: d1 }, ctx, async () => { plPass(r); throw new Error('boom https://x.com/a?token=SECRET'); }), /boom/);
  await drain();
  assert.deepEqual([rows(d1)[0].status, rows(d1)[0].reason], [500, 'boom https://x.com/a']);
});

test('不再随机删旧记录（清理交给每日定时任务）；PARSE_LOG_OFF=1 不写但照常拦', async () => {
  const d1 = fakeD1(); const { ctx, drain } = ctxs();
  const t = Date.now();
  d1.db.prepare("INSERT INTO parse_log (ts, site) VALUES (?, 'douyin')").run(t - 40 * 86400000);
  for (let i = 0; i < 300; i++) await go(createParseLog('douyin'), { PARSE_DB: d1 }, ctx, 'https://v.douyin.com/x', jsonResp({ ok: true }));
  await drain();
  assert.equal(rows(d1).length, 301);
  assert.equal(d1.log.filter((q) => q.startsWith('DELETE')).length, 0);
  d1.db.prepare("INSERT INTO blocklist VALUES ('ip','198.51.100.1','',1)").run();
  const off = { PARSE_DB: d1, PARSE_LOG_OFF: '1' };
  await go(createParseLog('douyin'), off, ctx, 'https://v.douyin.com/x', jsonResp({ ok: true }));
  assert.equal((await go(createParseLog('douyin'), off, ctx, 'https://v.douyin.com/x', jsonResp({ ok: true }), { ip: '198.51.100.1' })).status, 403);
  await drain();
  assert.equal(rows(d1).length, 301);
});

test('设备指纹：X-Device-Fp 只认 32 位十六进制，写进 fp 列；拉黑指纹 → 403', async () => {
  const r = (v) => new Request('https://x/', { headers: v == null ? {} : { 'x-device-fp': v } });
  assert.equal(plFp(r(FP.toUpperCase())), FP);
  for (const bad of ['', FP + '0', FP.slice(1), 'g'.repeat(32), "' OR 1=1 --" + 'a'.repeat(21)]) assert.equal(plFp(r(bad)), '', bad);
  const d1 = fakeD1(); const { ctx, drain } = ctxs();
  const pl = createParseLog('douyin');
  const env = { PARSE_DB: d1 };
  await go(pl, env, ctx, 'https://v.douyin.com/a/', jsonResp({ ok: true }), { fp: FP, ip: '203.0.113.7' });
  await go(pl, env, ctx, 'https://v.douyin.com/a/', jsonResp({ ok: true }), { fp: 'nope', ip: '203.0.113.8' });
  await drain();
  assert.deepEqual(rows(d1).map((x) => x.fp), [FP, '']);
  const BAD = 'fedcba9876543210fedcba9876543210';
  d1.db.prepare("INSERT INTO blocklist VALUES ('fp', ?, '', 1)").run(BAD);
  const pl2 = createParseLog('douyin');
  let called = 0;
  const q = req('https://v.douyin.com/a/', { fp: BAD, ip: '198.51.100.50' });
  assert.equal((await pl2.wrap(q, env, ctx, passed(q, () => { called++; return jsonResp({ ok: true }); }))).status, 403);
  assert.equal(called, 0);
  assert.equal((await go(pl2, env, ctx, 'https://v.douyin.com/a/', jsonResp({ ok: true }), { fp: FP, ip: '198.51.100.50' })).status, 200);
  await drain();
});

test('只记有效链接：valid(input) 为 false 时照常处理但不记；拉黑照样生效', async () => {
  const d1 = fakeD1(); const { ctx, drain } = ctxs();
  const isDy = (t) => /^https?:\/\/([a-z0-9-]+\.)*(douyin|iesdouyin)\.com\//i.test((String(t).match(/https?:\/\/\S+/) || [''])[0]);
  const pl = createParseLog('douyin', { valid: isDy });
  const env = { PARSE_DB: d1 };
  let called = 0;
  for (const u of ['', '随便写点字', 'https://example.com/x', 'https://evil.com/douyin.com/x']) {
    const q = req(u);
    assert.equal((await pl.wrap(q, env, ctx, passed(q, () => { called++; return jsonResp({ ok: false, error: '只支持抖音链接' }, 400); }))).status, 400);
  }
  assert.equal(called, 4, '站点自己照常 400');
  await go(pl, env, ctx, '复制 https://v.douyin.com/abc/ 打开', jsonResp({ ok: true }));
  await go(createParseLog('douyin', { valid: () => { throw new Error('x'); } }), env, ctx, 'https://v.douyin.com/z/', jsonResp({ ok: true }));
  await drain();
  assert.deepEqual(rows(d1).map((x) => x.url), ['https://v.douyin.com/abc/']);
  d1.db.prepare("INSERT INTO blocklist VALUES ('ip','198.51.100.77','',1)").run();
  const pl3 = createParseLog('douyin', { valid: isDy });
  assert.equal((await go(pl3, env, ctx, 'https://example.com/x', jsonResp({ ok: false }, 400), { ip: '198.51.100.77' })).status, 403);
});

test('guard（下载 / 媒体代理）：只查黑名单，命中 403，不记', async () => {
  const d1 = fakeD1(); const { ctx, drain } = ctxs();
  d1.db.prepare("INSERT INTO blocklist VALUES ('device',?,'',1)").run(DEV);
  const pl = createParseLog('douyin');
  let called = 0;
  const run = async () => { called++; return new Response('bytes'); };
  const r1 = await pl.guard(new Request('https://douyinqushuiyin.pages.dev/api/dl?url=x', { headers: { 'x-device-id': DEV, 'cf-connecting-ip': '1.1.1.1' } }), { PARSE_DB: d1 }, ctx, run);
  assert.equal(r1.status, 403);
  const r2 = await pl.guard(new Request('https://douyinqushuiyin.pages.dev/api/dl?url=x', { headers: { 'cf-connecting-ip': '1.1.1.1' } }), { PARSE_DB: d1 }, ctx, run);
  assert.equal(await r2.text(), 'bytes');
  const r3 = await pl.guard(new Request('https://douyinqushuiyin.pages.dev/api/dl'), {}, ctx, run);
  assert.equal(r3.status, 200);
  await drain();
  assert.equal(called, 2);
  assert.equal(rows(d1).length, 0);
});

test('预览部署：不解析、不记；生产 / 自定义域名照常', async () => {
  const d1 = fakeD1(); const { ctx, drain } = ctxs();
  const pl = createParseLog('douyin');
  let called = 0;
  for (const host of ['https://feat-parse-log.douyinqushuiyin.pages.dev', 'https://a1b2c3d4.douyinqushuiyin.pages.dev']) {
    const q = req('https://v.douyin.com/x', { host });
    const r = await pl.wrap(q, { PARSE_DB: d1 }, ctx, passed(q, () => { called++; return jsonResp({ ok: true }); }));
    assert.equal(r.status, 403);
    assert.match((await r.json()).error, /预览环境/);
  }
  assert.equal(called, 0);
  assert.equal(plIsPreview(new Request('https://douyinqushuiyin.pages.dev/'), {}), false);
  assert.equal(plIsPreview(new Request('https://dy.example.com/'), {}), false);
  assert.equal(plIsPreview(new Request('https://x.douyinqushuiyin.pages.dev/'), { PARSE_ON_PREVIEW: '1' }), false);
  await drain();
  assert.equal(rows(d1).length, 0);
});
