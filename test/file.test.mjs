import test from 'node:test';
import assert from 'node:assert/strict';
import { withSecurityHeaders, PAGE_CSP } from '../lib/app.js';
import { makeEnv, call, login } from './helpers.mjs';

const SANDBOX = "default-src 'none'; sandbox";

test('图片附件：白名单类型内联，nosniff + sandbox CSP + 私有缓存', async () => {
  const { env } = makeEnv();
  const cookie = await login(env);
  const r = await call(env, '/api/file?key=' + encodeURIComponent('fb/xhs/1.png'), { cookie });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('content-security-policy'), SANDBOX);
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  assert.match(r.headers.get('cache-control'), /^private/);
  assert.equal(r.headers.get('content-disposition'), null);
  assert.equal((await r.arrayBuffer()).byteLength, 4);
});

test('SVG / HTML 附件强制下载，不在本站渲染', async () => {
  const { env } = makeEnv();
  const cookie = await login(env);
  for (const key of ['fb/1731_ab_a.svg', 'fb/x.html']) {
    const r = await call(env, '/api/file?key=' + encodeURIComponent(key), { cookie });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/octet-stream');
    assert.match(r.headers.get('content-disposition'), /^attachment; filename="[A-Za-z0-9._-]+"$/);
    assert.equal(r.headers.get('content-security-policy'), SANDBOX);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  }
});

test('视频支持 Range 206', async () => {
  const { env } = makeEnv();
  const cookie = await login(env);
  const r = await call(env, '/api/file?key=fb/v.mp4', { cookie, headers: { range: 'bytes=10-19' } });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('content-range'), 'bytes 10-19/100');
  assert.equal(r.headers.get('content-length'), '10');
  assert.equal(r.headers.get('content-type'), 'video/mp4');
  const s = await call(env, '/api/file?key=fb/v.mp4', { cookie, headers: { range: 'bytes=-5' } });
  assert.equal(s.headers.get('content-range'), 'bytes 95-99/100');
});

test('附件键只允许 fb/ 前缀，禁止路径穿越', async () => {
  const { env } = makeEnv();
  const cookie = await login(env);
  for (const key of ['sess/x', '../fb/x', 'fb/../secret', 'fb/a b', '', 'FB/x']) {
    assert.equal((await call(env, '/api/file?key=' + encodeURIComponent(key), { cookie })).status, 400, key);
  }
  assert.equal((await call(env, '/api/file?key=fb/missing.png', { cookie })).status, 404);
});

test('安全头中间件：页面 CSP / XFO / no-referrer，不覆盖附件 sandbox CSP', async () => {
  const page = withSecurityHeaders(new Response('<html>', { headers: { 'content-type': 'text/html' } }));
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(page.headers.get('content-security-policy'), PAGE_CSP);
  assert.match(PAGE_CSP, /frame-ancestors 'none'/);
  assert.ok(!PAGE_CSP.includes('unsafe-inline'));
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const file = withSecurityHeaders(new Response('x', { headers: { 'content-security-policy': SANDBOX } }));
  assert.equal(file.headers.get('content-security-policy'), SANDBOX);
});
