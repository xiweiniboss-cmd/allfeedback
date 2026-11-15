import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, call, login } from './helpers.mjs';

test('删除：同时删附件，返回结果；再次删除 404', async () => {
  const { env } = makeEnv();
  const cookie = await login(env);
  const list = await (await call(env, '/api/feedback?site=xiaohongshu', { cookie })).json();
  const id = list.items[0].id;
  const r = await call(env, '/api/feedback', { method: 'DELETE', body: { id }, cookie });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual([j.ok, j.files, j.fileErrors], [true, 1, 0]);
  assert.ok(!env.FEEDBACK_KV.m.has(id));
  assert.deepEqual(env.FEEDBACK_BUCKET.deleted, ['fb/xhs/1.png']);
  assert.equal((await call(env, '/api/feedback', { method: 'DELETE', body: { id }, cookie })).status, 404);
});

test('删除旧快手键 feedback_fb_…', async () => {
  const { env } = makeEnv();
  const cookie = await login(env);
  const it = (await (await call(env, '/api/feedback?q=' + encodeURIComponent('旧快手'), { cookie })).json()).items[0];
  assert.ok(it.id.startsWith('fb_'));
  assert.equal((await call(env, '/api/feedback', { method: 'DELETE', body: { id: it.id }, cookie })).status, 200);
  assert.ok(![...env.FEEDBACK_KV.m.keys()].some((k) => k.startsWith('feedback_fb_')));
});

test('写操作要求 JSON + 同源', async () => {
  const { env } = makeEnv();
  const cookie = await login(env);
  const id = (await (await call(env, '/api/feedback', { cookie })).json()).items[0].id;
  assert.equal((await call(env, '/api/feedback', { method: 'DELETE', body: JSON.stringify({ id }), cookie, headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await call(env, '/api/feedback', { method: 'DELETE', body: { id }, cookie, headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call(env, '/api/status', { method: 'POST', body: { id, status: 'done' }, cookie, headers: { 'sec-fetch-site': 'same-site' } })).status, 403);
  assert.ok(env.FEEDBACK_KV.m.has(id));
});

test('标记已处理 / 未处理：只写 fbstatus_v1，不改原始记录', async () => {
  const { env } = makeEnv();
  const cookie = await login(env);
  const id = (await (await call(env, '/api/feedback?site=zhijia', { cookie })).json()).items[0].id;
  const before = env.FEEDBACK_KV.m.get(id);
  assert.equal((await call(env, '/api/status', { method: 'POST', body: { id, status: 'done' }, cookie })).status, 200);
  assert.equal(env.FEEDBACK_KV.m.get(id), before);
  assert.equal(JSON.parse(env.FEEDBACK_KV.m.get('fbstatus_v1'))[id].s, 'done');
  let it = (await (await call(env, '/api/feedback?site=zhijia', { cookie })).json()).items[0];
  assert.equal(it.status, 'done');
  assert.ok(it.handledAt > 0);
  assert.equal((await call(env, '/api/status', { method: 'POST', body: { id, status: 'open' }, cookie })).status, 200);
  it = (await (await call(env, '/api/feedback?site=zhijia', { cookie })).json()).items[0];
  assert.equal(it.status, 'open');
  assert.equal((await call(env, '/api/status', { method: 'POST', body: { id, status: 'bogus' }, cookie })).status, 400);
  assert.equal((await call(env, '/api/status', { method: 'POST', body: { id: 'fb_doesnotexist', status: 'done' }, cookie })).status, 404);
  const puts = env.FEEDBACK_KV.log.filter((x) => x[0] === 'put').map((x) => x[1]);
  assert.ok(puts.every((k) => k === 'fbstatus_v1'));
});

test('删除顺序：先删记录再删附件；记录删不掉时附件不动', async () => {
  const { env } = makeEnv();
  const cookie = await login(env);
  const id = (await (await call(env, '/api/feedback?site=xiaohongshu', { cookie })).json()).items[0].id;
  const order = [];
  const kvDel = env.FEEDBACK_KV.delete.bind(env.FEEDBACK_KV);
  const r2Del = env.FEEDBACK_BUCKET.delete.bind(env.FEEDBACK_BUCKET);
  env.FEEDBACK_KV.delete = async (k) => { order.push('kv:' + k); return kvDel(k); };
  env.FEEDBACK_BUCKET.delete = async (k) => { order.push('r2:' + k); return r2Del(k); };
  assert.equal((await call(env, '/api/feedback', { method: 'DELETE', body: { id }, cookie })).status, 200);
  assert.deepEqual(order, ['kv:' + id, 'r2:fb/xhs/1.png']);

  const e2 = makeEnv().env;
  const c2 = await login(e2);
  const id2 = (await (await call(e2, '/api/feedback?site=xiaohongshu', { cookie: c2 })).json()).items[0].id;
  e2.FEEDBACK_KV.delete = async () => { throw new Error('kv down'); };
  const r = await call(e2, '/api/feedback', { method: 'DELETE', body: { id: id2 }, cookie: c2 });
  assert.equal(r.status, 500);
  assert.deepEqual(e2.FEEDBACK_BUCKET.deleted, []);
  assert.ok(e2.FEEDBACK_BUCKET.m.has('fb/xhs/1.png'));
});

test('附件删除失败只记日志，不影响删除结果', async () => {
  const { env } = makeEnv();
  const cookie = await login(env);
  const id = (await (await call(env, '/api/feedback?site=xiaohongshu', { cookie })).json()).items[0].id;
  env.FEEDBACK_BUCKET.delete = async () => { throw new Error('r2 down'); };
  const origErr = console.error; const logged = []; console.error = (...a) => logged.push(a.join(' '));
  try {
    const r = await call(env, '/api/feedback', { method: 'DELETE', body: { id }, cookie });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.deepEqual([j.ok, j.files, j.fileErrors], [true, 0, 1]);
  } finally { console.error = origErr; }
  assert.ok(!env.FEEDBACK_KV.m.has(id));
  assert.ok(logged.some((x) => x.includes('fb/xhs/1.png')));
});
