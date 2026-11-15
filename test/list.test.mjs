import test from 'node:test';
import assert from 'node:assert/strict';
import { keyTime, normalize, siteOf } from '../lib/app.js';
import { makeEnv, call, login } from './helpers.mjs';

const get = async (env, cookie, qs) => (await call(env, '/api/feedback?' + qs, { cookie })).json();

test('keyTime 支持三种键格式', () => {
  const t = Date.UTC(2026, 10, 14);
  assert.equal(keyTime('fb_' + t + 'ab12'), t);
  assert.equal(keyTime('fb_' + t.toString(36) + '_xyz'), t);
  assert.equal(keyTime('feedback_fb_' + t.toString(36) + '_xyz'), t);
  assert.equal(keyTime('fb_' + t.toString(36) + 'abc'), t);
  assert.equal(keyTime('fb_weird'), 0);
});

test('站点识别：DeepSeek / 智驾 / 刹车按标签，解析站按来源页面，旧键为快手', () => {
  assert.equal(siteOf({ site: '[DeepSeek站]' }), 'deepseek');
  assert.equal(siteOf({ site: '[智驾站]' }), 'zhijia');
  assert.equal(siteOf({ site: '[刹车站]' }), 'brake');
  assert.equal(siteOf({ page: 'https://douyinqushuiyintest.pages.dev/' }), 'douyin');
  assert.equal(siteOf({ page: 'https://xiaohongshuqushuiyintest.pages.dev/x' }), 'xiaohongshu');
  assert.equal(siteOf({ page: 'https://tiktokshipingjiexitest.pages.dev/' }), 'tiktok');
  assert.equal(siteOf({ page: 'https://kuaishoujiexi.pages.dev/' }), 'kuaishou');
  assert.equal(siteOf({}, true), 'kuaishou');
  assert.equal(siteOf({ page: 'javascript:alert(1)' }), 'other');
});

test('normalize：两种记录格式统一字段，过滤不安全的附件键和页面链接', () => {
  const ds = normalize('fb_1731000000000ab', { site: '[DeepSeek站]', text: '【解析失败】坏了', files: [{ key: 'fb/1_a.png', name: 'a.png', type: 'image/png' }, { key: '../secret', name: 'x' }, { key: 'sess/x' }], t: 1731000000000, cc: 'CN', city: 'BJ' }, {});
  assert.equal(ds.message, '【解析失败】坏了');
  assert.equal(ds.kind, '解析失败');
  assert.equal(ds.siteLabel, 'DeepSeek');
  assert.equal(ds.time, 1731000000000);
  assert.deepEqual(ds.attachments.map((a) => a.key), ['fb/1_a.png']);
  assert.equal(ds.geo.country, 'CN');
  const p = normalize('fb_abc12345_x', { message: 'm', page: 'javascript:alert(1)', attachments: [{ key: 'fb/../x' }] }, { fb_abc12345_x: { s: 'done', t: 5 } });
  assert.equal(p.page, '');
  assert.equal(p.attachments.length, 0);
  assert.equal(p.status, 'done');
});

test('列表：汇总所有站，默认最新在前，带站名', async () => {
  const { env } = makeEnv();
  const cookie = await login(env);
  const j = await get(env, cookie, 'limit=50');
  assert.equal(j.ok, true);
  assert.equal(j.total, 9);
  assert.equal(j.items.length, 9);
  assert.equal(j.more, false);
  const sites = j.items.map((x) => x.site);
  assert.deepEqual(sites, ['douyin', 'xiaohongshu', 'youtube', 'tiktok', 'kuaishou', 'deepseek', 'zhijia', 'kuaishou', 'bilibili']);
  assert.equal(j.items.find((x) => x.site === 'zhijia').siteLabel, '智驾模拟器');
  const times = j.items.map((x) => x.time);
  assert.deepEqual(times, [...times].sort((a, b) => b - a));
  const asc = await get(env, cookie, 'limit=50&order=asc');
  assert.deepEqual(asc.items.map((x) => x.id), j.items.map((x) => x.id).reverse());
});

test('列表：站点 / 类型 / 状态 / 搜索筛选', async () => {
  const { env } = makeEnv();
  const cookie = await login(env);
  assert.deepEqual((await get(env, cookie, 'site=kuaishou')).items.map((x) => x.site), ['kuaishou', 'kuaishou']);
  assert.deepEqual((await get(env, cookie, 'site=zhijia')).items.map((x) => x.message), ['智驾模拟器 卡顿']);
  assert.deepEqual((await get(env, cookie, 'kind=下载失败')).items.map((x) => x.site), ['bilibili']);
  assert.deepEqual((await get(env, cookie, 'kind=其他')).items.map((x) => x.site), ['deepseek']);
  assert.deepEqual((await get(env, cookie, 'q=' + encodeURIComponent('DEEPSEEK 站'))).items.map((x) => x.site), ['deepseek']);
  assert.equal((await get(env, cookie, 'site=notasite')).items.length, 9, '未知站点参数被忽略');
  const all = await get(env, cookie, 'limit=50');
  const id = all.items[0].id;
  const r = await call(env, '/api/status', { method: 'POST', body: { id, status: 'done' }, cookie });
  assert.equal(r.status, 200);
  assert.deepEqual((await get(env, cookie, 'status=done')).items.map((x) => x.id), [id]);
  assert.equal((await get(env, cookie, 'status=open&limit=50')).items.length, 8);
});

test('列表：游标分页不重不漏，游标那条被删后也能接着翻', async () => {
  const { env } = makeEnv();
  const cookie = await login(env);
  const seen = [];
  let cursor = '', pages = 0;
  do {
    const j = await get(env, cookie, 'limit=4' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
    seen.push(...j.items.map((x) => x.id));
    cursor = j.cursor; pages++;
  } while (cursor && pages < 10);
  assert.equal(pages, 3);
  assert.equal(new Set(seen).size, 9);
  const p1 = await get(env, cookie, 'limit=3');
  const last = p1.items[2].id;
  assert.equal((await call(env, '/api/feedback', { method: 'DELETE', body: { id: last }, cookie })).status, 200);
  const p2 = await get(env, cookie, 'limit=3&cursor=' + encodeURIComponent(p1.cursor));
  assert.equal(p2.items[0].id, seen[3]);
  const bad = await get(env, cookie, 'cursor=%%%garbage');
  assert.equal(bad.ok, true);
});

test('用户内容原样以 JSON 字符串返回（前端用 textContent 渲染）', async () => {
  const { env } = makeEnv();
  const cookie = await login(env);
  const j = await get(env, cookie, 'site=bilibili');
  assert.equal(j.items[0].message, '<img src=x onerror=alert(1)> 下载慢');
});

test('统计：各站数量 / 未处理 / 按天（北京时间）', async () => {
  const { env, seed } = makeEnv();
  const cookie = await login(env);
  const j = await (await call(env, '/api/stats', { cookie })).json();
  assert.equal(j.total, 9);
  assert.equal(j.open, 9);
  const ks = j.sites.find((s) => s.site === 'kuaishou');
  assert.equal(ks.total, 2);
  assert.ok(j.sites.find((s) => s.site === 'zhijia' && s.label === '智驾模拟器'));
  assert.deepEqual(j.days.map((d) => d.day), ['2026-11-14', '2026-11-13']);
  assert.equal(j.days[0].total, 8);
  assert.equal(j.days[1].sites.bilibili, 1);
  assert.equal(j.truncated, false);
  assert.ok(seed);
});
