import test from 'node:test';
import assert from 'node:assert/strict';
import { guardKV, KeyNotAllowed, PF_SITES, pfDayList } from '../lib/app.js';
import { makeEnv, call, login, memKV } from './helpers.mjs';

const today = () => pfDayList(Date.now(), 1)[0];
const dayAgo = (n) => pfDayList(Date.now(), n + 1)[n];
function rec(site, day, n, reasons, last = []) {
  return JSON.stringify({ v: 1, site, day, n, reasons, msgs: { '请求超时': n }, last, w: 1, upd: Date.now() });
}

test('guardKV：pf_ 只能按完整键名读；不能 list / 写 / 删，形似的别的键也不行', async () => {
  const raw = memKV({ 'pf_douyin_2026-11-15': '{}', pf_secret: 'S', 'pf_douyin_2026-11-15_x': 'S', 'pfx_douyin_2026-11-15': 'S', sess_a: 'S' });
  const kv = guardKV(raw);
  assert.equal(await kv.get('pf_douyin_2026-11-15'), '{}');
  for (const k of ['pf_secret', 'pf_douyin_2026-11-15_x', 'pfx_douyin_2026-11-15', 'pf_', 'pf_DOUYIN_2026-11-15', 'pf_douyin_2026-11-15\n', 'pf_../sess_a_2026-11-15', 'sess_a']) {
    await assert.rejects(kv.get(k), KeyNotAllowed, k);
  }
  await assert.rejects(kv.put('pf_douyin_2026-11-15', 'x'), KeyNotAllowed);
  await assert.rejects(kv.delete('pf_douyin_2026-11-15'), KeyNotAllowed);
  await assert.rejects(kv.list({ prefix: 'pf_' }), KeyNotAllowed);
  await assert.rejects(kv.list({ prefix: 'pf_douyin_' }), KeyNotAllowed);
});

test('/api/failures：没登录 401', async () => {
  const { env } = makeEnv();
  const r = await call(env, '/api/failures');
  assert.equal(r.status, 401);
});

test('/api/failures：按站点汇总 7/30 天、每天、原因、最新样本', async () => {
  const { env } = makeEnv();
  const kv = env.FEEDBACK_KV;
  const t = Date.now();
  kv.m.set('pf_douyin_' + today(), rec('douyin', today(), 3, { timeout: 2, upstream_http: 1 }, [
    { t: t - 1000, url: 'https://v.douyin.com/a/', code: 'timeout', msg: '请求超时', st: 502, up: 0 },
    { t: t - 5000, url: 'javascript:alert(1)', code: 'evil', msg: '<b>x</b>', st: 502, up: 503 },
  ]));
  kv.m.set('pf_douyin_' + dayAgo(10), rec('douyin', dayAgo(10), 5, { no_media: 5 }));
  kv.m.set('pf_tiktok_' + dayAgo(1), rec('tiktok', dayAgo(1), 2, { no_media: 2 }, [{ t: t - 86400000, url: 'https://vm.tiktok.com/Z', code: 'no_media', msg: '已删除', st: 200 }]));
  kv.m.set('pf_weibo_' + today(), rec('weibo', today(), 1, { other: 1 }));
  kv.m.set('pf_douyin_' + dayAgo(40), rec('douyin', dayAgo(40), 99, { other: 99 })); // 超过 30 天，不计
  const cookie = await login(env);
  const j = await (await call(env, '/api/failures', { cookie })).json();
  assert.equal(j.ok, true);
  assert.equal(j.range, 30);
  const s = Object.fromEntries(j.sites.map((x) => [x.site, x]));
  assert.deepEqual([s.douyin.n7, s.douyin.n30, s.douyin.today], [3, 8, 3]);
  assert.deepEqual([s.tiktok.n7, s.tiktok.n30], [2, 2]);
  assert.equal(s.weibo.n30, 1, '微博站以后接入，不用改后台');
  assert.equal(j.days.length, 30);
  assert.equal(j.days[0].day, today());
  assert.deepEqual(j.days[0].sites, { douyin: 3, weibo: 1 });
  assert.equal(j.total, 11);
  assert.deepEqual(j.reasons.map((r) => [r.code, r.n]), [['no_media', 7], ['timeout', 2], ['upstream_http', 1], ['other', 1]]);
  assert.equal(j.samples[0].url, 'https://v.douyin.com/a/');
  assert.equal(j.samples[1].url, '', '非 http 链接被丢掉');
  assert.equal(j.samples[1].code, 'other', '未知原因代码归到其他');
  const j7 = await (await call(env, '/api/failures?days=7', { cookie })).json();
  assert.equal(j7.total, 6);
  const jt = await (await call(env, '/api/failures?site=tiktok', { cookie })).json();
  assert.equal(jt.total, 2);
  assert.ok(jt.samples.every((x) => x.site === 'tiktok'));
});

test('/api/failures：只读固定的 pf_ 键，不 list、不写，碰不到共用 KV 里的其他数据', async () => {
  const { env } = makeEnv();
  const cookie = await login(env);
  env.FEEDBACK_KV.log.length = 0;
  const body = await (await call(env, '/api/failures?site=../sess&days=x', { cookie })).text();
  assert.ok(!body.includes('SECRET-SESSION') && !body.includes('private chat'));
  const log = env.FEEDBACK_KV.log;
  assert.ok(log.length > 0);
  assert.ok(log.every(([op, k]) => op === 'get' && /^pf_[a-z]+_\d{4}-\d{2}-\d{2}$/.test(k)), JSON.stringify(log.filter(([op, k]) => op !== 'get' || !k.startsWith('pf_')).slice(0, 3)));
  assert.equal(log.length, PF_SITES.length * 30, '7 站 × 30 天');
});
