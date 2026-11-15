import test from 'node:test';
import assert from 'node:assert/strict';
import { guardKV, KeyNotAllowed } from '../lib/app.js';
import { makeEnv, call, login, memKV } from './helpers.mjs';

test('guardKV：只允许反馈前缀', async () => {
  const raw = memKV({ fb_1: '{}', sess_a: 'S', conv_b: 'C', fbstatus_v1: '{}' });
  const kv = guardKV(raw, 'h.example');
  assert.equal(await kv.get('fb_1'), '{}');
  await assert.rejects(kv.get('sess_a'), KeyNotAllowed);
  await assert.rejects(kv.get('conv_b'), KeyNotAllowed);
  await assert.rejects(kv.get('admfail_other.host_1.2.3.4'), KeyNotAllowed);
  await assert.rejects(kv.delete('sess_a'), KeyNotAllowed);
  await assert.rejects(kv.delete('fbstatus_v1'), KeyNotAllowed);
  await assert.rejects(kv.put('fb_1', 'x'), KeyNotAllowed, '不允许改写原始反馈');
  await assert.rejects(kv.put('sess_a', 'x'), KeyNotAllowed);
  await assert.rejects(kv.list({}), KeyNotAllowed);
  await assert.rejects(kv.list({ prefix: '' }), KeyNotAllowed);
  await assert.rejects(kv.list({ prefix: 'f' }), KeyNotAllowed);
  await assert.rejects(kv.list({ prefix: 'sess_' }), KeyNotAllowed);
  assert.deepEqual((await kv.list({ prefix: 'fb_' })).keys.map((k) => k.name), ['fb_1']);
  assert.ok(raw.m.has('sess_a') && raw.m.has('conv_b'));
});

test('guardKV：底层 list 返回了别的键也会被过滤', async () => {
  const evil = { async list() { return { keys: [{ name: 'fb_ok' }, { name: 'sess_leak' }], list_complete: true }; } };
  const r = await guardKV(evil, 'h').list({ prefix: 'fb_' });
  assert.deepEqual(r.keys.map((k) => k.name), ['fb_ok']);
});

test('整个 API 流程不会碰到非反馈键，响应里也不会出现', async () => {
  const { env } = makeEnv();
  const cookie = await login(env);
  const bodies = [];
  bodies.push(await (await call(env, '/api/feedback?limit=50', { cookie })).text());
  bodies.push(await (await call(env, '/api/stats', { cookie })).text());
  bodies.push(await (await call(env, '/api/feedback?q=secret', { cookie })).text());
  for (const id of ['sess_abcdef', 'conv_123', 'fb_../sess_abcdef', '../sess_abcdef']) {
    const r = await call(env, '/api/feedback', { method: 'DELETE', body: { id }, cookie });
    assert.equal(r.status, 400, id);
    const r2 = await call(env, '/api/status', { method: 'POST', body: { id, status: 'done' }, cookie });
    assert.equal(r2.status, 400, id);
  }
  for (const b of bodies) {
    assert.ok(!b.includes('SECRET-SESSION') && !b.includes('private chat') && !b.includes('sess_') && !b.includes('conv_'), b.slice(0, 200));
  }
  const touched = env.FEEDBACK_KV.log.filter(([op, k]) => op !== 'list' && !(k.startsWith('fb_') || k.startsWith('feedback_fb_') || k === 'fbstatus_v1' || k.startsWith('admfail_allfeedback.pages.dev_')));
  assert.deepEqual(touched, []);
  const lists = new Set(env.FEEDBACK_KV.log.filter((x) => x[0] === 'list').map((x) => x[1]));
  assert.deepEqual([...lists].sort(), ['fb_', 'feedback_fb_']);
  for (const k of ['sess_abcdef', 'conv_123', 'user_alice', 'pricing2']) assert.ok(env.FEEDBACK_KV.m.has(k));
});
