import test from 'node:test';
import assert from 'node:assert/strict';
import { withSecurityHeaders, PAGE_CSP, contentDisposition, downloadName, extForType } from '../lib/app.js';
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

const dl = (key, name, extra = {}) => '/api/file?key=' + encodeURIComponent(key) + '&download=1' + (name != null ? '&name=' + encodeURIComponent(name) : '');
const SAFE_CD = /^attachment; filename="[\x20-\x21\x23-\x5b\x5d-\x7e]+"; filename\*=UTF-8''[A-Za-z0-9%._~-]+$/;

test('download=1：强制下载并带原文件名（中文用 filename*=UTF-8）', async () => {
  const { env } = makeEnv();
  const cookie = await login(env);
  const r = await call(env, dl('fb/xhs/1.png', '截图 1.png'), { cookie });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  const cd = r.headers.get('content-disposition');
  assert.match(cd, SAFE_CD);
  assert.ok(cd.endsWith("filename*=UTF-8''" + encodeURIComponent('截图 1.png')));
  assert.equal(r.headers.get('content-security-policy'), SANDBOX);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  // 没有 name 时用存储键的文件名
  const k = await call(env, dl('fb/v.mp4'), { cookie });
  assert.equal(k.headers.get('content-disposition'), 'attachment; filename="v.mp4"; filename*=UTF-8\'\'v.mp4');
  // 不带 download=1 时行为不变（图片内联）
  assert.equal((await call(env, '/api/file?key=fb/xhs/1.png&name=x.png', { cookie })).headers.get('content-disposition'), null);
});

test('download=1 + Range 仍返回 206；危险类型下载仍是 octet-stream', async () => {
  const { env } = makeEnv();
  const cookie = await login(env);
  const r = await call(env, dl('fb/v.mp4', '视频.mp4'), { cookie, headers: { range: 'bytes=0-9' } });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('content-range'), 'bytes 0-9/100');
  assert.match(r.headers.get('content-disposition'), SAFE_CD);
  const s = await call(env, dl('fb/x.html', 'page.html'), { cookie });
  assert.equal(s.headers.get('content-type'), 'application/octet-stream');
  assert.match(s.headers.get('content-disposition'), SAFE_CD);
});

test('download=1：恶意文件名不能注入头部 / 穿越路径 / 伪装扩展名', async () => {
  const { env } = makeEnv();
  const cookie = await login(env);
  const evil = [
    'a"\r\nSet-Cookie: x=1.png', 'a\nb.png', '../../etc/passwd', '..\\..\\win.ini', '"; filename=evil.exe',
    '\u202egnp.exe', 'x\u0000y.png', "it's (1)*.png", '%0d%0aX: y.png', '..', '   ', '.'.repeat(300), '长'.repeat(500) + '.png',
  ];
  for (const name of evil) {
    const r = await call(env, dl('fb/xhs/1.png', name), { cookie });
    assert.equal(r.status, 200, name);
    const cd = r.headers.get('content-disposition');
    assert.match(cd, SAFE_CD, JSON.stringify(name));
    assert.ok(!/[\r\n]/.test(cd));
    assert.equal(r.headers.get('set-cookie'), null);
    const fname = downloadName(name, 'fb/xhs/1.png', 'image/png');
    assert.ok(!/[\/\\"\r\n\u0000\u202e]/.test(fname), fname);
    assert.ok(fname.endsWith('.png'), fname);
    assert.ok(Array.from(fname).length <= 125, fname);
    assert.ok(!fname.startsWith('.'), fname);
  }
  assert.equal(downloadName('\u202egnp.exe', 'fb/z.png', 'image/png'), 'gnp.exe.png');
  assert.equal(downloadName('图.JPEG', 'fb/k.jpg', 'image/jpeg'), '图.JPEG');
  assert.equal(downloadName('../../etc/passwd', 'fb/x.bin', 'application/octet-stream'), 'passwd.bin');
  assert.equal(downloadName('', 'fb/1791_ab_tiktok_76.mp4', 'video/mp4'), '1791_ab_tiktok_76.mp4');
  assert.match(contentDisposition('视频', 'fb/q.mp4', 'video/mp4'), /^attachment; filename="attachment\.mp4"; filename\*=UTF-8''%E8%A7%86%E9%A2%91\.mp4$/);
});

test('download=1：仍需登录、仍校验键、文件不存在返回 404', async () => {
  const { env } = makeEnv();
  assert.equal((await call(env, dl('fb/xhs/1.png', 'a.png'))).status, 401);
  const cookie = await login(env);
  assert.equal((await call(env, dl('../fb/x', 'a.png'), { cookie })).status, 400);
  assert.equal((await call(env, dl('sess_abcdef', 'a.png'), { cookie })).status, 400);
  const m = await call(env, dl('fb/1791364929190_b4mjlb_tiktok_7682383659151707399.mp4', 'v.mp4'), { cookie });
  assert.equal(m.status, 404);
  assert.equal(m.headers.get('content-disposition'), null);
});

test('下载扩展名以真实 Content-Type 为准：伪装的 .html / .exe 图片 → .png，未知类型 → .bin', async () => {
  const map = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/pjpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/heic': 'heic',
    'image/heif': 'heif', 'image/avif': 'avif', 'image/bmp': 'bmp', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
    'VIDEO/MP4': 'mp4', 'video/x-matroska': 'mkv', 'video/ogg': 'ogv', 'video/h264': 'h264',
    'video/html': 'bin', 'video/x-exe': 'bin', 'video/svg+xml': 'bin', 'video/a.b': 'bin',
    'image/svg+xml': 'bin', 'text/html': 'bin', 'application/x-msdownload': 'bin', 'video/mp4; codecs=avc1': 'bin', '': 'bin', undefined: 'bin',
  };
  for (const [t, e] of Object.entries(map)) assert.equal(extForType(t === 'undefined' ? undefined : t), e, t);
  // 名字 / 存储键里的扩展名都不算数
  assert.equal(downloadName('x.html', 'fb/a.html', 'image/png'), 'x.html.png');
  assert.equal(downloadName('setup.exe', 'fb/a.exe', 'image/png'), 'setup.exe.png');
  assert.equal(downloadName('照片.png', 'fb/a.png', 'image/jpeg'), '照片.png.jpg');
  assert.equal(downloadName('照片.jpeg', 'fb/a', 'image/jpeg'), '照片.jpeg');
  assert.equal(downloadName('录屏.MOV', 'fb/a.mp4', 'video/quicktime'), '录屏.MOV');
  assert.equal(downloadName('page.png', 'fb/x.png', 'text/html'), 'page.png.bin');
  assert.equal(downloadName('', 'fb/x.html', 'text/html'), 'x.html.bin');
  assert.equal(downloadName('截图 1', 'fb/a.png', 'image/png'), '截图 1.png');
  for (const n of ['a.html', 'a.exe', 'a.svg', 'a.js', 'a.bat', 'a.HTM']) {
    for (const t of ['image/png', 'video/html', 'text/html', 'application/octet-stream', 'image/svg+xml']) {
      const out = downloadName(n, 'fb/' + n, t);
      assert.ok(/\.(png|bin)$/.test(out), out);
    }
  }
  // 经过 handleFile：类型来自 R2 元数据，而不是 name / key
  const { env } = makeEnv();
  env.FEEDBACK_BUCKET.m.set('fb/disguised.html', { data: new Uint8Array([1]), type: 'image/png' });
  env.FEEDBACK_BUCKET.m.set('fb/weird.png', { data: new Uint8Array([1]), type: 'application/x-msdownload' });
  const cookie = await login(env);
  const a = await call(env, '/api/file?key=fb/disguised.html&download=1&name=' + encodeURIComponent('报告.html'), { cookie });
  assert.equal(a.headers.get('content-type'), 'image/png');
  assert.ok(a.headers.get('content-disposition').endsWith("filename*=UTF-8''" + encodeURIComponent('报告.html.png')));
  const b = await call(env, '/api/file?key=fb/weird.png&download=1&name=photo.png', { cookie });
  assert.equal(b.headers.get('content-type'), 'application/octet-stream');
  assert.equal(b.headers.get('content-disposition'), 'attachment; filename="photo.png.bin"; filename*=UTF-8\'\'photo.png.bin');
  const c = await call(env, '/api/file?key=fb/xhs/1.png&download=1&name=' + encodeURIComponent('截图.png'), { cookie });
  assert.ok(c.headers.get('content-disposition').endsWith("filename*=UTF-8''" + encodeURIComponent('截图.png')));
});
