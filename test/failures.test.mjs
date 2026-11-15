import test from 'node:test';
import assert from 'node:assert/strict';
import { guardKV, KeyNotAllowed, pfDayList } from '../lib/app.js';
import { makeEnv, call, login, memKV } from './helpers.mjs';
import { fakeD1 } from './d1.mjs';

const DAY = 86400000;
function seedFail(d1, rows) {
  const st = d1.db.prepare('INSERT INTO parse_log (ts, site, url, ok, status, reason) VALUES (?, ?, ?, ?, ?, ?)');
  for (const r of rows) st.run(r.ts, r.site, r.url || '', r.ok ? 1 : 0, r.status ?? 502, r.reason ?? '请求超时');
}
async function mkEnv() {
  const { env } = makeEnv();
  env.PARSE_DB = fakeD1();
  return { env, cookie: await login(env) };
}

test('guardKV：以前的 pf_ 键已经不能读了（失败统计改在 D1）', async () => {
  const kv = guardKV(memKV({ 'pf_douyin_2026-11-15': '{}' }));
  await assert.rejects(kv.get('pf_douyin_2026-11-15'), KeyNotAllowed);
  await assert.rejects(kv.list({ prefix: 'pf_' }), KeyNotAllowed);
});

test('/api/failures：没登录 401；没绑 D1 给出提示', async () => {
  const { env } = makeEnv();
  assert.equal((await call(env, '/api/failures')).status, 401);
  const cookie = await login(env);
  const r = await call(env, '/api/failures', { cookie });
  assert.equal(r.status, 500);
  assert.match((await r.json()).error, /PARSE_DB/);
});

test('/api/failures：按站点汇总 7/30 天、每天、原因、最新样本（D1 GROUP BY）', async () => {
  const { env, cookie } = await mkEnv();
  const t = Date.now();
  const today = pfDayList(t, 1)[0];
  const midday = (n) => Date.parse(pfDayList(t, n + 1)[n] + 'T12:00:00+08:00');
  seedFail(env.PARSE_DB, [
    { ts: t - 1000, site: 'douyin', url: 'https://v.douyin.com/a/', reason: '请求超时' },
    { ts: t - 2000, site: 'douyin', url: 'javascript:alert(1)', reason: '<b>x</b> 上游返回 HTTP 503', status: 502 },
    { ts: t - 3000, site: 'douyin', reason: '请求超时', status: 504 },
    ...Array.from({ length: 5 }, () => ({ ts: midday(10), site: 'douyin', reason: '视频已删除', status: 200 })),
    { ts: midday(1), site: 'tiktok', url: 'https://vm.tiktok.com/Z', reason: '已删除', status: 200 },
    { ts: midday(1), site: 'tiktok', reason: '已删除', status: 200 },
    { ts: t - 4000, site: 'weibo', reason: 'constructor', status: 200 },
    { ts: t - 5000, site: 'weibo', reason: '__proto__', status: 200 },
    { ts: midday(40), site: 'douyin', reason: 'x' }, // 超过 30 天，不计
    // 不算失败：成功、4xx、拉黑、人机验证类报错、不认识的站
    { ts: t, site: 'douyin', ok: 1, status: 200, reason: '' },
    { ts: t, site: 'douyin', status: 400, reason: '只支持抖音链接' },
    { ts: t, site: 'douyin', status: 403, reason: '已拉黑，拒绝解析' },
    { ts: t, site: 'douyin', status: 503, reason: '人机验证服务暂时不可用' },
    { ts: t, site: 'evil', status: 502, reason: 'x' },
  ]);
  const j = await (await call(env, '/api/failures', { cookie })).json();
  assert.equal(j.ok, true);
  assert.equal(j.range, 30);
  const s = Object.fromEntries(j.sites.map((x) => [x.site, x]));
  assert.deepEqual([s.douyin.n7, s.douyin.n30, s.douyin.today], [3, 8, 3]);
  assert.deepEqual([s.tiktok.n7, s.tiktok.n30], [2, 2]);
  assert.equal(s.weibo.n30, 2);
  assert.equal(j.days.length, 30);
  assert.equal(j.days[0].day, today);
  assert.deepEqual(j.days[0].sites, { douyin: 3, weibo: 2 });
  assert.equal(j.total, 12);
  assert.deepEqual(j.reasons.map((r) => [r.code, r.n]), [['no_media', 7], ['timeout', 2], ['other', 2], ['upstream_http', 1]]);
  const m = Object.fromEntries(j.msgs.map((x) => [x.msg, x.n]));
  assert.equal(m.constructor, 1, '叫 constructor 的原因按 1 次算');
  assert.equal(m.__proto__, 1);
  assert.equal(j.samples[0].url, 'https://v.douyin.com/a/');
  assert.equal(j.samples[1].url, '', '非 http 链接被丢掉');
  assert.equal(j.samples[1].up, 503);
  assert.ok(j.samples.every((x) => x.site !== 'evil'));
  const j7 = await (await call(env, '/api/failures?days=7', { cookie })).json();
  assert.equal(j7.total, 7);
  const jt = await (await call(env, '/api/failures?site=tiktok', { cookie })).json();
  assert.equal(jt.total, 2);
  assert.ok(jt.samples.length && jt.samples.every((x) => x.site === 'tiktok'));
});

test('/api/failures：只读 D1（两条 SELECT，走 ts 索引），不碰共用 KV', async () => {
  const { env, cookie } = await mkEnv();
  env.FEEDBACK_KV.log.length = 0;
  env.PARSE_DB.log.length = 0;
  const r = await call(env, '/api/failures?site=../sess&days=x', { cookie });
  assert.equal(r.status, 200);
  const body = await r.text();
  assert.ok(!body.includes('SECRET-SESSION') && !body.includes('private chat'));
  assert.equal(env.FEEDBACK_KV.log.filter(([op]) => op !== 'get' || true).filter(([, k]) => !String(k).startsWith('afsess') && !String(k).startsWith('admfail')).length, 0, JSON.stringify(env.FEEDBACK_KV.log.slice(0, 3)));
  assert.equal(env.PARSE_DB.log.length, 2);
  assert.ok(env.PARSE_DB.log.every((q) => /^SELECT /.test(q)));
  for (const q of env.PARSE_DB.log) {
    const plan = env.PARSE_DB.db.prepare('EXPLAIN QUERY PLAN ' + q).all(...(q.includes('site = ?') ? [0, 'x'] : [0])).map((x) => x.detail).join(' | ');
    assert.match(plan, /idx_pl_ts/, plan);
  }
});
