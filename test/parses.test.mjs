import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, call, login } from './helpers.mjs';
import { fakeD1 } from './d1.mjs';
import { createParseLog } from '../shared/parse-log.js';

const DEV = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const FP = '0123456789abcdef0123456789abcdef';
function seedD1() {
  const d1 = fakeD1();
  const ins = d1.db.prepare('INSERT INTO parse_log (ts, site, url, ok, status, reason, ip, country, region, city, device_id, ua, fp) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const t = Date.parse('2026-11-15T12:00:00+08:00');
  ins.run(t - 86400000 * 2, 'bilibili', 'https://b23.tv/old', 1, 200, '', '1.1.1.1', 'CN', '北京', '北京', '', 'UA', '');
  ins.run(t - 3600000, 'douyin', 'https://v.douyin.com/a/', 0, 502, '上游返回 HTTP 500', '203.0.113.5', 'CN', '广东', '深圳', DEV, 'UA', FP);
  ins.run(t, 'douyin', 'javascript:alert(1)', 1, 200, '', '2001:db8:1:2:3:4:5:6', 'US', '', '', 'bad', '<script>', 'zz<b>');
  return d1;
}
async function setup() {
  const { env } = makeEnv({ PARSE_DB: seedD1() });
  return { env, cookie: await login(env) };
}

test('解析记录 / 拉黑接口：没登录 401', async () => {
  const { env } = makeEnv({ PARSE_DB: seedD1() });
  for (const [p, m] of [['/api/parses', 'GET'], ['/api/blocklist', 'GET'], ['/api/block', 'POST'], ['/api/unblock', 'POST']]) {
    const r = await call(env, p, { method: m, body: m === 'POST' ? { type: 'ip', value: '1.2.3.4' } : undefined });
    assert.equal(r.status, 401, p);
  }
  assert.equal(env.PARSE_DB.db.prepare('SELECT COUNT(*) n FROM blocklist').get().n, 0);
});

test('/api/parses：最新在前，筛选站点 / IP / 设备 / 日期 / 结果，分页', async () => {
  const { env, cookie } = await setup();
  const j = await (await call(env, '/api/parses', { cookie })).json();
  assert.equal(j.ok, true);
  assert.deepEqual(j.items.map((x) => x.site), ['douyin', 'douyin', 'bilibili']);
  assert.equal(j.items[0].url, '', '非 http 链接不返回');
  assert.equal(j.items[0].device, '', '非法设备 ID 不返回');
  assert.equal(j.items[0].fp, '', '非法指纹不返回');
  assert.equal(j.items[1].fp, FP);
  assert.equal(j.items[0].ipBlockValue, '2001:db8:1:2::/64');
  assert.equal(j.items[1].region, '广东');
  const q = async (s) => (await (await call(env, '/api/parses?' + s, { cookie })).json()).items.length;
  assert.equal(await q('site=douyin'), 2);
  assert.equal(await q('site=evil'), 3, '未知站点忽略');
  assert.equal(await q('ip=203.0.113.5'), 1);
  assert.equal(await q('device=' + DEV), 1);
  assert.equal(await q('fp=' + FP), 1);
  assert.equal(await q('fp=' + FP.toUpperCase()), 1);
  assert.equal(await q('from=2026-11-15&to=2026-11-15'), 2);
  assert.equal(await q('to=2026-11-14'), 1);
  assert.equal(await q('result=fail'), 1);
  assert.equal(await q("ip=' OR 1=1 --"), 0, '参数绑定，不能注入');
  const p1 = await (await call(env, '/api/parses?limit=2', { cookie })).json();
  assert.equal(p1.more, true);
  const p2 = await (await call(env, '/api/parses?limit=2&before=' + p1.cursor, { cookie })).json();
  assert.deepEqual(p2.items.map((x) => x.site), ['bilibili']);
  assert.equal(p2.more, false);
});

test('拉黑 / 解除：校验格式、IPv6 按 /64、同源 + JSON，列表能看到，记录里标出已拉黑', async () => {
  const { env, cookie } = await setup();
  const post = (p, body, extra = {}) => call(env, p, { method: 'POST', body, cookie, ...extra });
  assert.equal((await post('/api/block', { type: 'ip', value: 'x' })).status, 400);
  assert.equal((await post('/api/block', { type: 'device', value: 'abc' })).status, 400);
  assert.equal((await post('/api/block', { type: 'sess', value: '1.2.3.4' })).status, 400);
  assert.equal((await post('/api/block', { type: 'ip', value: '1.2.3.4' }, { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await post('/api/block', 'type=ip', { headers: { 'content-type': 'text/plain' } })).status, 415);
  let r = await (await post('/api/block', { type: 'ip', value: '203.0.113.5', note: '刷接口\n' })).json();
  assert.deepEqual([r.ok, r.value], [true, '203.0.113.5']);
  r = await (await post('/api/block', { type: 'ip', value: '2001:db8:1:2:9:9:9:9' })).json();
  assert.equal(r.value, '2001:db8:1:2::/64');
  r = await (await post('/api/block', { type: 'device', value: DEV.toUpperCase() })).json();
  assert.equal(r.value, DEV);
  assert.equal((await post('/api/block', { type: 'fp', value: 'abc' })).status, 400);
  r = await (await post('/api/block', { type: 'fp', value: FP.toUpperCase() })).json();
  assert.deepEqual([r.ok, r.type, r.value], [true, 'fp', FP]);
  const bl = await (await call(env, '/api/blocklist', { cookie })).json();
  assert.equal(bl.items.length, 4);
  assert.equal(bl.items.find((x) => x.value === FP).type, 'fp');
  assert.equal(bl.items.find((x) => x.value === '203.0.113.5').note, '刷接口');
  const j = await (await call(env, '/api/parses', { cookie })).json();
  assert.deepEqual(j.items.map((x) => [x.ipBlocked, x.deviceBlocked, x.fpBlocked]), [[true, false, false], [true, true, true], [false, false, false]]);
  // 解析站那边立刻能拦（新 isolate）
  const pl = createParseLog('douyin');
  const req = new Request('https://x/api/parse?url=https://v.douyin.com/z', { headers: { 'cf-connecting-ip': '198.51.100.1', 'x-device-id': DEV } });
  assert.equal((await pl.wrap(req, env, { waitUntil() {} }, async () => new Response('{}'))).status, 403);
  r = await (await post('/api/unblock', { type: 'device', value: DEV })).json();
  assert.equal(r.ok, true);
  assert.equal((await (await call(env, '/api/blocklist', { cookie })).json()).items.length, 3);
  // 拉黑指纹：只带指纹的请求也拦
  const reqFp = new Request('https://x/api/parse?url=https://v.douyin.com/z', { headers: { 'cf-connecting-ip': '198.51.100.2', 'x-device-fp': FP } });
  assert.equal((await createParseLog('douyin').wrap(reqFp, env, { waitUntil() {} }, async () => new Response('{}'))).status, 403);
  r = await (await post('/api/unblock', { type: 'fp', value: FP })).json();
  assert.equal(r.ok, true);
});

test('没绑定 D1：提示未绑定，其他功能不受影响；整个流程不碰 KV 非反馈键', async () => {
  const { env } = makeEnv();
  const cookie = await login(env);
  const r = await call(env, '/api/parses', { cookie });
  assert.equal(r.status, 500);
  assert.match((await r.json()).error, /D1/);
  assert.equal((await call(env, '/api/feedback', { cookie })).status, 200);
  const { env: env2, cookie: c2 } = await setup();
  env2.FEEDBACK_KV.log.length = 0;
  await call(env2, '/api/parses', { cookie: c2 });
  await call(env2, '/api/block', { method: 'POST', body: { type: 'ip', value: '1.2.3.4' }, cookie: c2 });
  assert.deepEqual(env2.FEEDBACK_KV.log, [], '解析记录 / 拉黑只用 D1，不读写 KV');
});

test('/api/parses：按站点 / IP / 日期 / 翻页查询都不整段重排（EXPLAIN 里没有 TEMP B-TREE），日期先换成 id 区间', async () => {
  const { env, cookie } = await setup();
  const d1 = env.PARSE_DB;
  const ins = d1.db.prepare('INSERT INTO parse_log (ts, site, ip) VALUES (?, ?, ?)');
  const base = Date.parse('2026-11-01T00:00:00+08:00');
  for (let i = 0; i < 300; i++) ins.run(base + i * 3600000, ['douyin', 'weibo', 'tiktok'][i % 3], '10.0.0.' + (i % 7));
  for (const q of ['', '?site=weibo', '?ip=10.0.0.3', '?from=2026-11-05&to=2026-11-06', '?site=tiktok&from=2026-11-03', '?result=fail', '?before=200', '?device=' + DEV, '?fp=' + FP]) {
    d1.log.length = 0;
    const j = await (await call(env, '/api/parses' + q, { cookie })).json();
    assert.equal(j.ok, true, q);
    const main = d1.log.find((s) => s.startsWith('SELECT id, ts, site'));
    const plan = d1.db.prepare('EXPLAIN QUERY PLAN ' + main).all(...Array((main.match(/\?/g) || []).length).fill(1)).map((x) => x.detail).join(' | ');
    assert.ok(!/TEMP B-TREE/.test(plan), q + ' → ' + plan);
  }
  const j = await (await call(env, '/api/parses?from=2026-11-05&to=2026-11-05&limit=100', { cookie })).json();
  assert.equal(j.items.length, 24);
  assert.ok(j.items.every((x) => x.ts >= Date.parse('2026-11-05T00:00:00+08:00') && x.ts < Date.parse('2026-11-06T00:00:00+08:00')));
  const e = await (await call(env, '/api/parses?from=2030-01-01', { cookie })).json();
  assert.equal(e.items.length, 0, '起始日期之后没数据 → 空');
});

test('/api/fp-stats：拉黑指纹前给出最近 30 天的不同 IP / 设备数；要登录、格式校验', async () => {
  const { env, cookie } = await setup();
  const ins = env.PARSE_DB.db.prepare('INSERT INTO parse_log (ts, site, ip, device_id, fp) VALUES (?, ?, ?, ?, ?)');
  const t = Date.now();
  ins.run(t - 1000, 'douyin', '198.51.100.1', DEV, FP);
  ins.run(t - 2000, 'douyin', '198.51.100.2', '', FP);
  ins.run(t - 3000, 'weibo', '198.51.100.2', '', FP);
  ins.run(t - 40 * 86400000, 'weibo', '198.51.100.9', '', FP); // 30 天前不算
  ins.run(t - 1000, 'weibo', '198.51.100.3', '', 'f'.repeat(32));
  const j = await (await call(env, '/api/fp-stats?fp=' + FP.toUpperCase(), { cookie })).json();
  assert.deepEqual([j.ok, j.fp, j.n, j.ips, j.devices], [true, FP, 4, 3, 2], '含 seed 里那一行（203.0.113.5）');
  assert.equal((await call(env, '/api/fp-stats?fp=xyz', { cookie })).status, 400);
  assert.equal((await call(env, '/api/fp-stats?fp=' + FP)).status, 401);
});

test('解析统计按北京时间汇总全部记录，支持站点筛选并要求登录', async () => {
  const d1 = fakeD1();
  const ins = d1.db.prepare('INSERT INTO parse_log (ts, site, ok) VALUES (?, ?, ?)');
  const now = Date.now();
  ins.run(now, 'douyin', 1);
  ins.run(now, 'douyin', 0);
  ins.run(now - 86400000, 'bilibili', 1);
  ins.run(now - 31 * 86400000, 'douyin', 0);
  const { env } = makeEnv({ PARSE_DB: d1 });
  assert.equal((await call(env, '/api/parse-stats')).status, 401);
  const cookie = await login(env);
  const all = await (await call(env, '/api/parse-stats', { cookie })).json();
  assert.equal(all.days.length, 30);
  assert.equal(all.days.reduce((n, d) => n + d.total, 0), 3);
  assert.equal(all.days.reduce((n, d) => n + d.fail, 0), 1);
  const one = await (await call(env, '/api/parse-stats?site=douyin', { cookie })).json();
  assert.equal(one.days.reduce((n, d) => n + d.total, 0), 2);
  assert.deepEqual(one.sites.map(s => [s.site, s.n]), [['douyin', 2]]);
});
