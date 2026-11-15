import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, call, login } from './helpers.mjs';
import { fakeD1 } from './d1.mjs';
import { createParseLog } from '../shared/parse-log.js';

const DEV = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
function seedD1() {
  const d1 = fakeD1();
  const ins = d1.db.prepare('INSERT INTO parse_log (ts, site, url, ok, status, reason, ip, country, region, city, device_id, ua) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  const t = Date.parse('2026-11-15T12:00:00+08:00');
  ins.run(t - 86400000 * 2, 'bilibili', 'https://b23.tv/old', 1, 200, '', '1.1.1.1', 'CN', '北京', '北京', '', 'UA');
  ins.run(t - 3600000, 'douyin', 'https://v.douyin.com/a/', 0, 502, '上游返回 HTTP 500', '203.0.113.5', 'CN', '广东', '深圳', DEV, 'UA');
  ins.run(t, 'douyin', 'javascript:alert(1)', 1, 200, '', '2001:db8:1:2:3:4:5:6', 'US', '', '', 'bad', '<script>');
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
  assert.equal(j.items[0].ipBlockValue, '2001:db8:1:2::/64');
  assert.equal(j.items[1].region, '广东');
  const q = async (s) => (await (await call(env, '/api/parses?' + s, { cookie })).json()).items.length;
  assert.equal(await q('site=douyin'), 2);
  assert.equal(await q('site=evil'), 3, '未知站点忽略');
  assert.equal(await q('ip=203.0.113.5'), 1);
  assert.equal(await q('device=' + DEV), 1);
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
  const bl = await (await call(env, '/api/blocklist', { cookie })).json();
  assert.equal(bl.items.length, 3);
  assert.equal(bl.items.find((x) => x.value === '203.0.113.5').note, '刷接口');
  const j = await (await call(env, '/api/parses', { cookie })).json();
  assert.deepEqual(j.items.map((x) => [x.ipBlocked, x.deviceBlocked]), [[true, false], [true, true], [false, false]]);
  // 解析站那边立刻能拦（新 isolate）
  const pl = createParseLog('douyin');
  const req = new Request('https://x/api/parse?url=https://v.douyin.com/z', { headers: { 'cf-connecting-ip': '198.51.100.1', 'x-device-id': DEV } });
  assert.equal((await pl.wrap(req, env, { waitUntil() {} }, async () => new Response('{}'))).status, 403);
  r = await (await post('/api/unblock', { type: 'device', value: DEV })).json();
  assert.equal(r.ok, true);
  assert.equal((await (await call(env, '/api/blocklist', { cookie })).json()).items.length, 2);
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
