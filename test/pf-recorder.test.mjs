import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPfRecorder, pfCleanUrl, pfClassify, pfDay, PF_SOFT_CAP, PF_MIN_GAP_MS, PF_CAP_GAP_MS, PF_TTL } from '../shared/pf-recorder.js';
import { memKV } from './helpers.mjs';

function clock(t0) {
  const c = { t: t0, now: () => c.t, sleep: async (ms) => { c.t += ms; } };
  return c;
}
function ctxs() {
  const jobs = [];
  return { jobs, ctx: { waitUntil: (p) => jobs.push(p) }, drain: async () => { while (jobs.length) await jobs.shift(); } };
}
const jsonResp = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const T0 = Date.UTC(2026, 10, 15, 4, 0, 0); // 2026-11-15 12:00 北京时间

test('pfDay 按北京时间切天', () => {
  assert.equal(pfDay(Date.UTC(2026, 10, 14, 15, 59, 59)), '2026-11-14');
  assert.equal(pfDay(Date.UTC(2026, 10, 14, 16, 0, 0)), '2026-11-15');
});

test('pfCleanUrl：只留定位参数，去掉令牌、账号、片段，限长', () => {
  assert.equal(pfCleanUrl('看看这个 https://www.xiaohongshu.com/explore/abc?xsec_token=SECRET&xsec_source=pc 复制打开'), 'https://www.xiaohongshu.com/explore/abc');
  assert.equal(pfCleanUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=TRACK&pp=x#t=1'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(pfCleanUrl('https://user:pw@v.douyin.com/AbC/?share_token=t&sign=s，'), 'https://v.douyin.com/AbC/');
  assert.equal(pfCleanUrl('https://www.bilibili.com/video/BV1xx?p=2&spm_id_from=333&vd_source=abc'), 'https://www.bilibili.com/video/BV1xx?p=2');
  assert.equal(pfCleanUrl('没有链接的文字'), '');
  assert.equal(pfCleanUrl('javascript:alert(1)'), '');
  assert.ok(pfCleanUrl('https://a.com/' + 'x'.repeat(1000)).length <= 300);
});

test('pfClassify：常见报错归类', () => {
  assert.deepEqual(pfClassify(502, '请求超时'), { code: 'timeout', up: 0 });
  assert.deepEqual(pfClassify(504, 'x'), { code: 'timeout', up: 0 });
  assert.deepEqual(pfClassify(502, '上游返回 HTTP 503'), { code: 'upstream_http', up: 503 });
  assert.deepEqual(pfClassify(502, 'RedFox 返回 HTTP 429'), { code: 'upstream_quota', up: 429 });
  assert.equal(pfClassify(502, '积分不足').code, 'upstream_quota');
  assert.equal(pfClassify(200, '解析失败：链接无效，或视频已删除/设为私密').code, 'no_media');
  assert.equal(pfClassify(502, '没有找到视频').code, 'no_media');
  assert.equal(pfClassify(500, '未配置 RedFoxHub API Key').code, 'config');
  assert.equal(pfClassify(502, 'fetch failed').code, 'network');
  assert.equal(pfClassify(502, '解析失败，请稍后重试').code, 'other');
});

test('解析失败：写 pf_<站>_<北京日期>，带 35 天过期，样本里没有令牌', async () => {
  const kv = memKV();
  const c = clock(T0);
  const pf = createPfRecorder('douyin', c);
  const { ctx, drain } = ctxs();
  const req = new Request('https://x.pages.dev/api/parse?url=' + encodeURIComponent('https://v.douyin.com/AbC/?share_token=SECRET'));
  const r = await pf.wrap(req, { FEEDBACK_KV: kv }, ctx, async () => jsonResp({ ok: false, error: '上游返回 HTTP 500' }, 502));
  assert.equal(r.status, 502);
  assert.equal((await r.json()).error, '上游返回 HTTP 500', '响应原样返回给用户');
  await drain();
  const puts = kv.log.filter((x) => x[0] === 'put');
  assert.equal(puts.length, 1);
  assert.equal(puts[0][1], 'pf_douyin_2026-11-15');
  assert.equal(puts[0][2].expirationTtl, PF_TTL);
  const rec = JSON.parse(kv.m.get('pf_douyin_2026-11-15'));
  assert.equal(rec.n, 1);
  assert.deepEqual(rec.reasons, { upstream_http: 1 });
  assert.equal(rec.last[0].url, 'https://v.douyin.com/AbC/');
  assert.equal(rec.last[0].up, 500);
  assert.equal(rec.last[0].st, 502);
  assert.ok(!JSON.stringify(rec).includes('SECRET'));
  // 只碰了 pf_ 键
  assert.ok(kv.log.every(([, k]) => k.startsWith('pf_')));
});

test('不记录：成功、4xx（输入错误 / 人机验证 / 频控）、兜底跳过的报错', async () => {
  const kv = memKV();
  const pf = createPfRecorder('xiaohongshu', clock(T0));
  const { ctx, drain } = ctxs();
  const env = { FEEDBACK_KV: kv };
  const req = () => new Request('https://x.pages.dev/api/parse?url=https://xhslink.com/a');
  await pf.wrap(req(), env, ctx, async () => jsonResp({ ok: true, video: 'x' }));
  await pf.wrap(req(), env, ctx, async () => jsonResp({ code: 0, msg: 'success' }));
  await pf.wrap(req(), env, ctx, async () => jsonResp({ ok: false, error: '请先完成人机验证' }, 400));
  await pf.wrap(req(), env, ctx, async () => jsonResp({ ok: false, error: '人机验证未通过，请重试' }, 403));
  await pf.wrap(req(), env, ctx, async () => jsonResp({ ok: false, error: '解析太频繁' }, 429));
  await pf.wrap(req(), env, ctx, async () => jsonResp({ ok: false, error: 'HUMAN_UNAVAILABLE 人机验证服务暂时不可用' }, 503));
  await drain();
  assert.equal(kv.m.size, 0);
  assert.equal(kv.log.length, 0);
});

test('200 + ok:false / code:-1 也算失败（小红书、TikTok 的写法）', async () => {
  const kv = memKV();
  const c = clock(T0);
  const { ctx, drain } = ctxs();
  const a = createPfRecorder('xiaohongshu', c), b = createPfRecorder('tiktok', c);
  await a.wrap(new Request('https://x/api/parse?url=https://xhslink.com/a'), { FEEDBACK_KV: kv }, ctx, async () => jsonResp({ ok: false, error: '没有找到视频' }));
  await b.wrap(new Request('https://x/api/parse?url=https://vm.tiktok.com/Z'), { FEEDBACK_KV: kv }, ctx, async () => jsonResp({ code: -1, msg: '解析失败：链接无效，或视频已删除/设为私密' }));
  await drain();
  assert.equal(JSON.parse(kv.m.get('pf_xiaohongshu_2026-11-15')).reasons.no_media, 1);
  assert.equal(JSON.parse(kv.m.get('pf_tiktok_2026-11-15')).reasons.no_media, 1);
});

test('POST JSON 里的链接也能取到，处理函数照样能读 body', async () => {
  const kv = memKV();
  const pf = createPfRecorder('kuaishou', clock(T0));
  const { ctx, drain } = ctxs();
  const req = new Request('https://x/api/parse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://v.kuaishou.com/abc?cc=share_copylink&shareToken=X' }) });
  let seen = '';
  await pf.wrap(req, { FEEDBACK_KV: kv }, ctx, async () => { seen = (await req.json()).url; return jsonResp({ ok: false, error: '请求超时' }, 502); });
  await drain();
  assert.ok(seen.startsWith('https://v.kuaishou.com/abc'));
  const rec = JSON.parse(kv.m.get('pf_kuaishou_2026-11-15'));
  assert.equal(rec.last[0].url, 'https://v.kuaishou.com/abc');
  assert.equal(rec.reasons.timeout, 1);
});

test('处理函数抛异常：记录后照样抛出，不吞错', async () => {
  const kv = memKV();
  const pf = createPfRecorder('bilibili', clock(T0));
  const { ctx, drain } = ctxs();
  await assert.rejects(pf.wrap(new Request('https://x/api/parse?url=https://b23.tv/x'), { FEEDBACK_KV: kv }, ctx, async () => { throw new Error('boom'); }), /boom/);
  await drain();
  assert.equal(JSON.parse(kv.m.get('pf_bilibili_2026-11-15')).reasons.exception, 1);
});

test('KV 出错、没绑定 KV：解析响应完全不受影响', async () => {
  const pf = createPfRecorder('youtube', clock(T0));
  const { ctx, drain } = ctxs();
  const bad = { async get() { throw new Error('kv down'); }, async put() { throw new Error('kv down'); } };
  const r1 = await pf.wrap(new Request('https://x/api/parse?url=https://youtu.be/x'), { FEEDBACK_KV: bad }, ctx, async () => jsonResp({ ok: false, error: 'x' }, 502));
  assert.equal(r1.status, 502);
  await drain();
  const r2 = await pf.wrap(new Request('https://x/api/parse?url=https://youtu.be/x'), {}, ctx, async () => jsonResp({ ok: false, error: 'x' }, 502));
  assert.equal(r2.status, 502);
  await drain();
});

test('一波连续失败：同一 isolate 合并成一次写入，计数不丢', async () => {
  const kv = memKV();
  const c = clock(T0);
  const pf = createPfRecorder('douyin', c);
  const { ctx, drain } = ctxs();
  const env = { FEEDBACK_KV: kv };
  // 先来一次，立即写
  await pf.wrap(new Request('https://x/api/parse?url=https://v.douyin.com/0'), env, ctx, async () => jsonResp({ ok: false, error: '请求超时' }, 502));
  await drain();
  // 紧接着 100 次（时钟不走），都攒进同一次延迟写入
  const all = [];
  for (let i = 1; i <= 100; i++) {
    all.push(pf.wrap(new Request('https://x/api/parse?url=https://v.douyin.com/' + i), env, ctx, async () => jsonResp({ ok: false, error: '请求超时' }, 502)));
  }
  await Promise.all(all);
  await drain();
  const puts = kv.log.filter((x) => x[0] === 'put').length;
  assert.equal(puts, 2, '101 次失败只写 2 次');
  const rec = JSON.parse(kv.m.get('pf_douyin_2026-11-15'));
  assert.equal(rec.n, 101);
  assert.equal(rec.last.length, 30, '样本只留最近 30 条');
  assert.equal(rec.w, 2);
  assert.ok(c.t - T0 >= PF_MIN_GAP_MS);
});

test('当天写满上限后，至少隔 30 分钟才写一次，计数在内存里继续累加', async () => {
  const kv = memKV();
  const c = clock(T0);
  const pf = createPfRecorder('bilibili', c);
  const { ctx, drain } = ctxs();
  const env = { FEEDBACK_KV: kv };
  const fail = () => pf.wrap(new Request('https://x/api/parse?url=https://b23.tv/a'), env, ctx, async () => jsonResp({ ok: false, error: 'x' }, 502));
  let n = 0;
  // 每 26 秒失败一次，跑 2 小时
  for (let i = 0; i < (2 * 3600) / 26; i++) { await fail(); n++; await drain(); c.t += 26000; }
  const puts = kv.log.filter((x) => x[0] === 'put').length;
  const rec = JSON.parse(kv.m.get('pf_bilibili_2026-11-15'));
  assert.ok(puts <= PF_SOFT_CAP + Math.ceil((2 * 3600 * 1000) / PF_CAP_GAP_MS) + 1, 'puts=' + puts);
  assert.ok(rec.n >= n - 80 && rec.n <= n, 'n=' + rec.n + ' of ' + n);
  // 再过 30 分钟来一次，内存里攒着的会合并写进去
  c.t += PF_CAP_GAP_MS; await fail(); await drain();
  assert.equal(JSON.parse(kv.m.get('pf_bilibili_2026-11-15')).n, n + 1);
});

test('各站内嵌的代码块和原件一致（有本地 clone 时检查）', async (t) => {
  const { block } = await import('../shared/pf-sync.mjs');
  const canon = block(readFileSync(new URL('../shared/pf-recorder.js', import.meta.url), 'utf8'));
  assert.ok(canon && canon.includes('pf-recorder v1 END'));
  const sites = (process.env.PF_SITE_FILES || '').split(',').filter(Boolean);
  if (!sites.length) return t.skip('没设置 PF_SITE_FILES');
  for (const f of sites) assert.equal(block(readFileSync(f, 'utf8')), canon, f);
});
