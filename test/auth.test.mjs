import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, call, login, ADMIN_KEY, ORIGIN } from './helpers.mjs';
import { handleApi } from '../lib/app.js';

test('未登录：/api/me 返回 admin=false，其余接口 401', async () => {
  const { env } = makeEnv();
  const me = await (await call(env, '/api/me')).json();
  assert.equal(me.admin, false);
  assert.equal(me.configured, true);
  for (const [p, m] of [['/api/feedback', 'GET'], ['/api/stats', 'GET'], ['/api/file?key=fb/xhs/1.png', 'GET']]) {
    assert.equal((await call(env, p, { method: m })).status, 401, p);
  }
  assert.equal((await call(env, '/api/feedback', { method: 'DELETE', body: { id: 'fb_x1y2z3' } })).status, 401);
  assert.equal((await call(env, '/api/status', { method: 'POST', body: { id: 'fb_x1y2z3', status: 'done' } })).status, 401);
});

test('登录成功：HttpOnly Secure SameSite=Strict 12 小时 Cookie，之后可访问', async () => {
  const { env } = makeEnv();
  const r = await call(env, '/api/login', { method: 'POST', body: { key: ADMIN_KEY } });
  assert.equal(r.status, 200);
  const sc = r.headers.get('set-cookie');
  assert.match(sc, /^af_admin=\d+\.[A-Za-z0-9_-]+;/);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Max-Age=43200', 'Path=/']) assert.ok(sc.includes(flag), flag);
  assert.ok(!sc.includes(ADMIN_KEY), 'cookie 里不能有明文密码');
  const cookie = sc.split(';')[0];
  assert.equal((await (await call(env, '/api/me', { cookie })).json()).admin, true);
  assert.equal((await call(env, '/api/feedback', { cookie })).status, 200);
});

test('登录只接受 JSON + 同源 POST', async () => {
  const { env } = makeEnv();
  assert.equal((await call(env, '/api/login')).status, 405);
  assert.equal((await call(env, '/api/login', { method: 'POST', body: 'key=' + ADMIN_KEY, headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status, 415);
  assert.equal((await call(env, '/api/login', { method: 'POST', body: { key: ADMIN_KEY }, headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call(env, '/api/login', { method: 'POST', body: { key: ADMIN_KEY }, headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await call(env, '/api/login', { method: 'POST', body: { key: ADMIN_KEY }, headers: { 'sec-fetch-site': 'same-origin', origin: ORIGIN } })).status, 200);
});

test('伪造 / 过期 / 其他密钥签名的 Cookie 无效；URL 上的 ?key= 无效', async () => {
  const { env } = makeEnv();
  const exp = Math.floor(Date.now() / 1000) + 3600;
  assert.equal((await call(env, '/api/feedback', { cookie: 'af_admin=' + exp + '.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })).status, 401);
  assert.equal((await call(env, '/api/feedback?key=' + ADMIN_KEY)).status, 401);
  const other = makeEnv({ FEEDBACK_ADMIN_KEY: 'another-key' }).env;
  const lr = await call(other, '/api/login', { method: 'POST', body: { key: 'another-key' } });
  const otherCookie = lr.headers.get('set-cookie').split(';')[0];
  assert.equal((await call(env, '/api/feedback', { cookie: otherCookie })).status, 401);
  const real = await login(env);
  const sig = real.split('.')[1];
  const expired = 'af_admin=' + (Math.floor(Date.now() / 1000) - 10) + '.' + sig;
  assert.equal((await call(env, '/api/feedback', { cookie: expired })).status, 401);
});

test('密码错误 10 次后按 IP（IPv6 按 /64）锁定，所有域名共用一个计数', async () => {
  const { env } = makeEnv();
  for (let i = 0; i < 10; i++) {
    const r = await call(env, '/api/login', { method: 'POST', body: { key: 'wrong' }, ip: '2001:db8:1:2::' + (i + 1) });
    assert.equal(r.status, 403);
  }
  const locked = await call(env, '/api/login', { method: 'POST', body: { key: ADMIN_KEY }, ip: '2001:db8:1:2:ffff::9' });
  assert.equal(locked.status, 429);
  const k = [...env.FEEDBACK_KV.m.keys()].find((x) => x.startsWith('admfail_'));
  assert.equal(k, 'admfail_allfeedback_2001:db8:1:2::/64');
  // 换一个预览域名也一样被锁
  const env2 = env;
  const req = new Request('https://abc123.allfeedback.pages.dev/api/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://abc123.allfeedback.pages.dev', 'cf-connecting-ip': '2001:db8:1:2::77' }, body: JSON.stringify({ key: ADMIN_KEY }) });
  assert.equal((await handleApi(req, env2)).status, 429);
  const put = env.FEEDBACK_KV.log.find((x) => x[0] === 'put' && x[1] === k);
  assert.equal(put[2].expirationTtl, 900);
  // 其他网段不受影响
  assert.equal((await call(env, '/api/login', { method: 'POST', body: { key: ADMIN_KEY }, ip: '2001:db8:9:9::1' })).status, 200);
});

test('没配置密码时拒绝登录', async () => {
  const { env } = makeEnv({ FEEDBACK_ADMIN_KEY: '' });
  assert.equal((await call(env, '/api/login', { method: 'POST', body: { key: '' } })).status, 500);
  assert.equal((await (await call(env, '/api/me')).json()).configured, false);
});

test('退出登录：同源 POST 清除 Cookie', async () => {
  const { env } = makeEnv();
  const r = await call(env, '/api/logout', { method: 'POST', body: {} });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /af_admin=; .*Max-Age=0/);
  assert.equal((await call(env, '/api/logout', { method: 'POST', body: {}, headers: { origin: 'https://evil.example' } })).status, 403);
});
