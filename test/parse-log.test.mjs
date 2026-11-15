import test from 'node:test';
import assert from 'node:assert/strict';
import { createParseLog, plCleanUrl, plDevice, plFp, plIp64, PL_RETENTION_MS } from '../shared/parse-log.js';
import { fakeD1 } from './d1.mjs';

const DEV = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const jsonResp = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
function req(u, { ip = '203.0.113.5', dev = DEV, method = 'GET', body, ua = 'UA-test' } = {}) {
  const h = { 'cf-connecting-ip': ip, 'user-agent': ua };
  if (dev) h['x-device-id'] = dev;
  if (body) h['content-type'] = 'application/json';
  const r = new Request('https://x.pages.dev/api/parse' + (method === 'GET' ? '?url=' + encodeURIComponent(u) : ''), { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  Object.defineProperty(r, 'cf', { value: { country: 'cn', region: '广东', city: '深圳' } });
  return r;
}
function ctxs() { const jobs = []; return { ctx: { waitUntil: (p) => jobs.push(p) }, drain: async () => { while (jobs.length) await jobs.shift(); } }; }
const rows = (d1) => d1.db.prepare('SELECT * FROM parse_log ORDER BY id').all();

test('plDevice 只认 UUID；plIp64；plCleanUrl 去令牌', () => {
  const r = (v) => new Request('https://x/', { headers: v == null ? {} : { 'x-device-id': v } });
  assert.equal(plDevice(r(DEV.toUpperCase())), DEV);
  for (const bad of ['', 'abc', DEV + 'x', 'd1abc23xyz', "'; DROP TABLE x;--", DEV.replace(/-/g, '')]) assert.equal(plDevice(r(bad)), '', bad);
  assert.equal(plDevice(r(null)), '');
  assert.equal(plIp64('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64');
  assert.equal(plIp64('1.2.3.4'), '1.2.3.4');
  assert.equal(plCleanUrl('看 https://www.xiaohongshu.com/explore/a?xsec_token=S&x=1 打开'), 'https://www.xiaohongshu.com/explore/a');
});

test('成功 / 失败 / 4xx 都记一行：站点、去令牌链接、IP、归属地、设备、UA、结果', async () => {
  const d1 = fakeD1(); const { ctx, drain } = ctxs();
  const pl = createParseLog('douyin');
  const env = { PARSE_DB: d1 };
  const r1 = await pl.wrap(req('https://v.douyin.com/a/?share_token=SECRET'), env, ctx, async () => jsonResp({ ok: true, video: 'x' }));
  assert.equal(r1.status, 200);
  assert.equal((await r1.json()).video, 'x', '响应原样返回');
  await pl.wrap(req('https://v.douyin.com/b/'), env, ctx, async () => jsonResp({ ok: false, error: '上游返回 HTTP 500' }, 502));
  await pl.wrap(req('https://v.douyin.com/c/', { dev: 'not-a-uuid' }), env, ctx, async () => jsonResp({ code: -1, msg: '视频已删除' }));
  await pl.wrap(req('https://example.com/x'), env, ctx, async () => jsonResp({ ok: false, error: '只支持抖音链接' }, 400));
  await pl.wrap(req('https://weibo.com/1/a'), env, ctx, async () => jsonResp({ code: 200, msg: 'ok', data: {} }));
  await pl.wrap(req('https://weibo.com/1/b'), env, ctx, async () => jsonResp({ code: 400, msg: '没有找到图片或视频' }));
  await drain();
  const rs = rows(d1);
  assert.equal(rs.length, 6);
  assert.deepEqual([rs[4].ok, rs[5].ok, rs[5].reason], [1, 0, '没有找到图片或视频'], '微博：code 200 成功、HTTP 200 + code 400 失败');
  assert.deepEqual([rs[0].site, rs[0].url, rs[0].ok, rs[0].status, rs[0].ip, rs[0].country, rs[0].region, rs[0].city, rs[0].device_id, rs[0].ua],
    ['douyin', 'https://v.douyin.com/a/', 1, 200, '203.0.113.5', 'CN', '广东', '深圳', DEV, 'UA-test']);
  assert.deepEqual([rs[1].ok, rs[1].status, rs[1].reason], [0, 502, '上游返回 HTTP 500']);
  assert.deepEqual([rs[2].ok, rs[2].reason, rs[2].device_id], [0, '视频已删除', ''], '200 + code≠0 算失败；非法设备 ID 不存');
  assert.deepEqual([rs[3].ok, rs[3].status], [0, 400]);
  assert.ok(!JSON.stringify(rs).includes('SECRET'));
});

test('POST JSON（快手）也能取到链接，处理函数照样能读 body', async () => {
  const d1 = fakeD1(); const { ctx, drain } = ctxs();
  const pl = createParseLog('kuaishou');
  const r = req('', { method: 'POST', body: { url: 'https://v.kuaishou.com/x?shareToken=S' } });
  let seen = '';
  await pl.wrap(r, { PARSE_DB: d1 }, ctx, async () => { seen = (await r.json()).url; return jsonResp({ ok: true }); });
  await drain();
  assert.ok(seen.startsWith('https://v.kuaishou.com/x'));
  assert.equal(rows(d1)[0].url, 'https://v.kuaishou.com/x');
});

test('拉黑 IP / IPv6 /64 / 设备：返回 403「访问受限」，不调用解析', async () => {
  const d1 = fakeD1(); const { ctx, drain } = ctxs();
  d1.db.prepare("INSERT INTO blocklist (type, value, note, created_at) VALUES ('ip','198.51.100.9','',1), ('ip','2001:db8:1:2::/64','',1), ('device',?, '',1)").run('11111111-2222-4333-8444-555555555555');
  const pl = createParseLog('bilibili');
  const env = { PARSE_DB: d1 };
  let called = 0;
  const run = async () => { called++; return jsonResp({ ok: true }); };
  for (const o of [{ ip: '198.51.100.9' }, { ip: '2001:db8:1:2:aaaa:bbbb:cccc:dddd' }, { dev: '11111111-2222-4333-8444-555555555555' }]) {
    const r = await pl.wrap(req('https://b23.tv/x', o), env, ctx, run);
    assert.equal(r.status, 403);
    const j = await r.json();
    assert.equal(j.error, '访问受限');
    assert.equal(j.msg, '访问受限', 'TikTok 前端读 msg');
  }
  assert.equal(called, 0);
  const ok = await pl.wrap(req('https://b23.tv/x', { ip: '198.51.100.10' }), env, ctx, run);
  assert.equal(ok.status, 200);
  assert.equal(called, 1);
  await drain();
  const rs = rows(d1);
  assert.equal(rs.filter((x) => x.status === 403).length, 3, '被拦的也记一行');
});

test('名单每 60 秒才读一次 D1；解除拉黑最多 60 秒后生效', async () => {
  const d1 = fakeD1(); const { ctx, drain } = ctxs();
  let t = 1_000_000;
  const pl = createParseLog('youtube', { now: () => t, random: () => 1 });
  const env = { PARSE_DB: d1 };
  d1.db.prepare("INSERT INTO blocklist VALUES ('ip','203.0.113.5','',1)").run();
  const go = () => pl.wrap(req('https://youtu.be/x'), env, ctx, async () => jsonResp({ ok: true }));
  assert.equal((await go()).status, 403);
  d1.db.prepare('DELETE FROM blocklist').run();
  t += 30000; assert.equal((await go()).status, 403, '缓存期内');
  t += 31000; assert.equal((await go()).status, 200, '过期后重新读');
  await drain();
  assert.equal(d1.log.filter((s) => s.startsWith('SELECT type, value FROM blocklist')).length, 2);
});

test('D1 出错 / 超时 / 没绑定：放行（fail open），响应不受影响', async () => {
  const { ctx, drain } = ctxs();
  const d1 = fakeD1(); d1.fail = true;
  const pl = createParseLog('tiktok');
  const r = await pl.wrap(req('https://vm.tiktok.com/x'), { PARSE_DB: d1 }, ctx, async () => jsonResp({ code: 0 }));
  assert.equal(r.status, 200);
  const hang = { prepare: () => ({ bind() { return this; }, all: () => new Promise(() => {}), run: () => new Promise(() => {}) }) };
  const t0 = Date.now();
  const r2 = await createParseLog('tiktok').wrap(req('https://vm.tiktok.com/x'), { PARSE_DB: hang }, { waitUntil() {} }, async () => jsonResp({ code: 0 }));
  assert.equal(r2.status, 200);
  assert.ok(Date.now() - t0 < 3000, 'D1 卡住时 1.5 秒超时放行');
  const r3 = await createParseLog('tiktok').wrap(req('https://vm.tiktok.com/x'), {}, ctx, async () => jsonResp({ code: 0 }));
  assert.equal(r3.status, 200);
  await drain();
});

test('出错时沿用上一次读到的名单（不会因为 D1 抖一下就解封）', async () => {
  const d1 = fakeD1(); const { ctx, drain } = ctxs();
  let t = 5_000_000;
  const pl = createParseLog('douyin', { now: () => t });
  d1.db.prepare("INSERT INTO blocklist VALUES ('ip','203.0.113.5','',1)").run();
  const go = () => pl.wrap(req('https://v.douyin.com/x'), { PARSE_DB: d1 }, ctx, async () => jsonResp({ ok: true }));
  assert.equal((await go()).status, 403);
  d1.fail = true; t += 61000;
  assert.equal((await go()).status, 403);
  await drain();
});

test('处理函数抛异常：记一行后照样抛出', async () => {
  const d1 = fakeD1(); const { ctx, drain } = ctxs();
  await assert.rejects(createParseLog('xiaohongshu').wrap(req('https://xhslink.com/a'), { PARSE_DB: d1 }, ctx, async () => { throw new Error('boom'); }), /boom/);
  await drain();
  assert.deepEqual([rows(d1)[0].status, rows(d1)[0].reason], [500, 'boom']);
});

test('约 1% 的写入顺手删除 30 天前的记录', async () => {
  const d1 = fakeD1(); const { ctx, drain } = ctxs();
  const t = Date.now();
  d1.db.prepare("INSERT INTO parse_log (ts, site) VALUES (?, 'douyin'), (?, 'douyin')").run(t - PL_RETENTION_MS - 1000, t - 1000);
  await createParseLog('douyin', { random: () => 0.5 }).wrap(req('https://v.douyin.com/x'), { PARSE_DB: d1 }, ctx, async () => jsonResp({ ok: true }));
  await drain();
  assert.equal(rows(d1).length, 3, 'random=0.5 不清理');
  await createParseLog('douyin', { random: () => 0.001 }).wrap(req('https://v.douyin.com/x'), { PARSE_DB: d1 }, ctx, async () => jsonResp({ ok: true }));
  await drain();
  assert.equal(rows(d1).length, 3, '删掉 1 条旧的，新增 1 条');
  assert.ok(rows(d1).every((r) => r.ts >= t - PL_RETENTION_MS));
});

const FP = '0123456789abcdef0123456789abcdef';
test('设备指纹：X-Device-Fp 只认 32 位十六进制，写进 fp 列；拉黑指纹 → 403', async () => {
  const r = (v) => new Request('https://x/', { headers: v == null ? {} : { 'x-device-fp': v } });
  assert.equal(plFp(r(FP.toUpperCase())), FP);
  for (const bad of ['', FP + '0', FP.slice(1), 'g'.repeat(32), "' OR 1=1 --" + 'a'.repeat(21)]) assert.equal(plFp(r(bad)), '', bad);
  const d1 = fakeD1(); const { ctx, drain } = ctxs();
  const withFp = (fp, ip) => { const q = req('https://v.douyin.com/a/', { ip }); q.headers.set('x-device-fp', fp); return q; };
  const pl = createParseLog('douyin');
  const env = { PARSE_DB: d1 };
  await pl.wrap(withFp(FP, '203.0.113.7'), env, ctx, async () => jsonResp({ ok: true }));
  await pl.wrap(withFp('nope', '203.0.113.8'), env, ctx, async () => jsonResp({ ok: true }));
  await drain();
  assert.deepEqual(rows(d1).map((x) => x.fp), [FP, '']);
  const BAD = 'fedcba9876543210fedcba9876543210';
  d1.db.prepare("INSERT INTO blocklist VALUES ('fp', ?, '', 1)").run(BAD);
  const pl2 = createParseLog('douyin');
  let called = 0;
  const rb = await pl2.wrap(withFp(BAD, '198.51.100.50'), env, ctx, async () => { called++; return jsonResp({ ok: true }); });
  assert.equal(rb.status, 403);
  assert.equal(called, 0);
  assert.equal((await pl2.wrap(withFp(FP, '198.51.100.50'), env, ctx, async () => jsonResp({ ok: true }))).status, 200);
  await drain();
});

test('只记有效链接：valid(input) 为 false 时照常处理但不记；拉黑照样生效', async () => {
  const d1 = fakeD1(); const { ctx, drain } = ctxs();
  const isDy = (t) => /^https?:\/\/([a-z0-9-]+\.)*(douyin|iesdouyin)\.com\//i.test((String(t).match(/https?:\/\/\S+/) || [''])[0]);
  const pl = createParseLog('douyin', { valid: isDy });
  const env = { PARSE_DB: d1 };
  let called = 0;
  const run = async () => { called++; return jsonResp({ ok: false, error: '只支持抖音链接' }, 400); };
  for (const u of ['', '随便写点字', 'https://example.com/x', 'https://evil.com/douyin.com/x']) assert.equal((await pl.wrap(req(u), env, ctx, run)).status, 400);
  assert.equal(called, 4, '站点自己照常 400');
  await pl.wrap(req('复制 https://v.douyin.com/abc/ 打开'), env, ctx, async () => jsonResp({ ok: true }));
  // valid 抛异常：当无效，不记
  await createParseLog('douyin', { valid: () => { throw new Error('x'); } }).wrap(req('https://v.douyin.com/z/'), env, ctx, async () => jsonResp({ ok: true }));
  await drain();
  assert.deepEqual(rows(d1).map((x) => x.url), ['https://v.douyin.com/abc/']);
  // 被拉黑的人发无效链接也拦
  d1.db.prepare("INSERT INTO blocklist VALUES ('ip','198.51.100.77','',1)").run();
  const pl3 = createParseLog('douyin', { valid: isDy });
  assert.equal((await pl3.wrap(req('https://example.com/x', { ip: '198.51.100.77' }), env, ctx, run)).status, 403);
});
