import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPfRecorder, pfCleanUrl, pfScrub, pfClassify, pfDay, pfIsPreview, PF_WRITE_TIMEOUT_MS } from '../shared/pf-recorder.js';
import { memKV } from './helpers.mjs';
import { fakeD1 } from './d1.mjs';

function ctxs() {
  const jobs = [];
  return { jobs, ctx: { waitUntil: (p) => jobs.push(p) }, drain: async () => { while (jobs.length) await jobs.shift(); } };
}
const jsonResp = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const T0 = Date.UTC(2026, 10, 15, 4, 0, 0); // 2026-11-15 12:00 北京时间
const PROD = 'https://douyinqushuiyin.pages.dev';
const rows = (d1) => d1.db.prepare('SELECT * FROM parse_log ORDER BY id').all();

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

test('pfScrub：报错文字里的每个链接都去掉令牌，其余文字保留', () => {
  const s = pfScrub('上游 HTTP 403：https://api.example.com/v1/parse?url=x&token=SECRET1&sign=SECRET2，重试 https://u:p@cdn.x.com/a.mp4?expires=1&auth_key=SECRET3。');
  assert.ok(!/SECRET/.test(s), s);
  assert.ok(s.includes('https://api.example.com/v1/parse，'), s);
  assert.ok(s.includes('https://cdn.x.com/a.mp4。'), s);
  assert.ok(s.startsWith('上游 HTTP 403：'));
  assert.equal(pfScrub('a\n\n b'), 'a b');
  assert.ok(pfScrub('x'.repeat(500)).length <= 160);
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
  assert.equal(pfClassify(500, "Cannot read properties of undefined (reading 'x')").code, 'exception');
  assert.equal(pfClassify(502, '解析失败，请稍后重试').code, 'other');
});

test('解析失败：往 D1 parse_log 插一行 ok=0，链接和原因里都没有令牌，不记 IP / 设备，不碰 KV', async () => {
  const kv = memKV();
  const d1 = fakeD1();
  const pf = createPfRecorder('douyin', { now: () => T0 });
  const { ctx, drain } = ctxs();
  const req = new Request(PROD + '/api/parse?url=' + encodeURIComponent('https://v.douyin.com/AbC/?share_token=SECRET'), { headers: { 'cf-connecting-ip': '1.2.3.4', 'x-device-id': '11111111-2222-4333-8444-555555555555' } });
  const r = await pf.wrap(req, { FEEDBACK_KV: kv, PARSE_DB: d1 }, ctx, async () => jsonResp({ ok: false, error: '上游返回 HTTP 500：https://redfox.hk/api?key=SECRET2' }, 502));
  assert.equal(r.status, 502);
  assert.equal((await r.json()).error, '上游返回 HTTP 500：https://redfox.hk/api?key=SECRET2', '响应原样返回给用户');
  await drain();
  const all = rows(d1);
  assert.equal(all.length, 1);
  const x = all[0];
  assert.deepEqual([x.ts, x.site, x.ok, x.status, x.url], [T0, 'douyin', 0, 502, 'https://v.douyin.com/AbC/']);
  assert.equal(x.reason, '上游返回 HTTP 500：https://redfox.hk/api');
  assert.deepEqual([x.ip, x.device_id, x.fp, x.country], ['', '', '', '']);
  assert.ok(!JSON.stringify(all).includes('SECRET'));
  assert.equal(kv.log.length, 0, '一次都没碰共用 KV');
});

test('不记录：成功、4xx（输入错误 / 人机验证 / 频控）、兜底跳过的报错', async () => {
  const d1 = fakeD1();
  const pf = createPfRecorder('xiaohongshu');
  const { ctx, drain } = ctxs();
  const env = { PARSE_DB: d1 };
  const req = () => new Request(PROD + '/api/parse?url=https://xhslink.com/a');
  await pf.wrap(req(), env, ctx, async () => jsonResp({ ok: true, video: 'x' }));
  await pf.wrap(req(), env, ctx, async () => jsonResp({ code: 0, msg: 'success' }));
  await pf.wrap(req(), env, ctx, async () => jsonResp({ code: 200, msg: 'ok' }));
  await pf.wrap(req(), env, ctx, async () => jsonResp({ ok: false, error: '请先完成人机验证' }, 400));
  await pf.wrap(req(), env, ctx, async () => jsonResp({ ok: false, error: '人机验证未通过，请重试' }, 403));
  await pf.wrap(req(), env, ctx, async () => jsonResp({ ok: false, error: '解析太频繁' }, 429));
  await pf.wrap(req(), env, ctx, async () => jsonResp({ ok: false, error: 'HUMAN_UNAVAILABLE 人机验证服务暂时不可用' }, 503));
  await drain();
  assert.equal(rows(d1).length, 0);
  assert.equal(d1.log.length, 0);
});

test('200 + ok:false / code:-1 也算失败（小红书、TikTok 的写法）', async () => {
  const d1 = fakeD1();
  const { ctx, drain } = ctxs();
  const a = createPfRecorder('xiaohongshu'), b = createPfRecorder('tiktok');
  await a.wrap(new Request(PROD + '/api/parse?url=https://xhslink.com/a'), { PARSE_DB: d1 }, ctx, async () => jsonResp({ ok: false, error: '没有找到视频' }));
  await b.wrap(new Request(PROD + '/api/parse?url=https://vm.tiktok.com/Z'), { PARSE_DB: d1 }, ctx, async () => jsonResp({ code: -1, msg: '解析失败：链接无效，或视频已删除/设为私密' }));
  await drain();
  assert.deepEqual(rows(d1).map((x) => [x.site, x.status, pfClassify(x.status, x.reason).code]), [['xiaohongshu', 200, 'no_media'], ['tiktok', 200, 'no_media']]);
});

test('POST JSON 里的链接也能取到，处理函数照样能读 body', async () => {
  const d1 = fakeD1();
  const pf = createPfRecorder('kuaishou');
  const { ctx, drain } = ctxs();
  const req = new Request(PROD + '/api/parse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://v.kuaishou.com/abc?cc=share_copylink&shareToken=X' }) });
  let seen = '';
  await pf.wrap(req, { PARSE_DB: d1 }, ctx, async () => { seen = (await req.json()).url; return jsonResp({ ok: false, error: '请求超时' }, 502); });
  await drain();
  assert.ok(seen.startsWith('https://v.kuaishou.com/abc'));
  assert.equal(rows(d1)[0].url, 'https://v.kuaishou.com/abc');
});

test('处理函数抛异常：记录后照样抛出，不吞错', async () => {
  const d1 = fakeD1();
  const pf = createPfRecorder('bilibili');
  const { ctx, drain } = ctxs();
  await assert.rejects(pf.wrap(new Request(PROD + '/api/parse?url=https://b23.tv/x'), { PARSE_DB: d1 }, ctx, async () => { throw new Error('boom'); }), /boom/);
  await drain();
  assert.deepEqual([rows(d1)[0].status, rows(d1)[0].reason], [500, 'boom']);
});

test('D1 出错、没绑 D1、开关 PARSE_LOG_OFF=1：解析响应完全不受影响，不写', async () => {
  const pf = createPfRecorder('youtube');
  const { ctx, drain } = ctxs();
  const bad = fakeD1(); bad.fail = true;
  const r1 = await pf.wrap(new Request(PROD + '/api/parse?url=https://youtu.be/x'), { PARSE_DB: bad }, ctx, async () => jsonResp({ ok: false, error: 'x' }, 502));
  assert.equal(r1.status, 502);
  await drain();
  const r2 = await pf.wrap(new Request(PROD + '/api/parse?url=https://youtu.be/x'), {}, ctx, async () => jsonResp({ ok: false, error: 'x' }, 502));
  assert.equal(r2.status, 502);
  const d1 = fakeD1();
  for (const off of ['1', 'true', 'on']) {
    const r3 = await pf.wrap(new Request(PROD + '/api/parse?url=https://youtu.be/x'), { PARSE_DB: d1, PARSE_LOG_OFF: off }, ctx, async () => jsonResp({ ok: false, error: 'x' }, 502));
    assert.equal(r3.status, 502);
  }
  await drain();
  assert.equal(rows(d1).length, 0);
});

test('写入卡住：最多等 10 秒就放弃（离 30 秒的时限很远）', async () => {
  assert.equal(PF_WRITE_TIMEOUT_MS, 10000);
  const pf = createPfRecorder('douyin');
  const hang = { prepare: () => ({ bind() { return this; }, run: () => new Promise(() => {}) }) };
  const { ctx, jobs } = ctxs();
  const t = Date.now();
  const orig = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...a) => orig(fn, ms === PF_WRITE_TIMEOUT_MS ? 5 : ms, ...a);
  try {
    await pf.wrap(new Request(PROD + '/api/parse?url=https://v.douyin.com/x'), { PARSE_DB: hang }, ctx, async () => jsonResp({ ok: false, error: 'x' }, 502));
    while (jobs.length) await jobs.shift();
  } finally { globalThis.setTimeout = orig; }
  assert.ok(Date.now() - t < 2000);
});

test('一波连续失败：每次一行，没有内存攒批 / 延迟写', async () => {
  const d1 = fakeD1();
  const pf = createPfRecorder('douyin');
  const { ctx, drain } = ctxs();
  const all = [];
  for (let i = 0; i < 50; i++) all.push(pf.wrap(new Request(PROD + '/api/parse?url=https://v.douyin.com/' + i), { PARSE_DB: d1 }, ctx, async () => jsonResp({ ok: false, error: '请求超时' }, 502)));
  await Promise.all(all);
  await drain();
  assert.equal(rows(d1).length, 50);
});

test('预览部署不提供解析：直接 403，不调处理函数、不写；生产域名 / 自定义域名照常；PARSE_ON_PREVIEW=1 可放开', async () => {
  const d1 = fakeD1();
  const pf = createPfRecorder('kuaishou');
  const { ctx, drain } = ctxs();
  let called = 0;
  const run = async () => { called++; return jsonResp({ ok: false, error: 'x' }, 502); };
  for (const host of ['https://feat-parse-failure-log.kuaishoujiexi.pages.dev', 'https://3f2a1b9c.kuaishoujiexi.pages.dev']) {
    const r = await pf.wrap(new Request(host + '/api/parse?url=https://v.kuaishou.com/x'), { PARSE_DB: d1 }, ctx, run);
    assert.equal(r.status, 403);
    assert.match((await r.json()).error, /预览环境/);
  }
  assert.equal(called, 0);
  assert.equal(pfIsPreview(new Request('https://kuaishoujiexi.pages.dev/api/parse'), {}), false);
  assert.equal(pfIsPreview(new Request('https://jiexi.example.com/api/parse'), {}), false);
  assert.equal(pfIsPreview(new Request('https://abc.kuaishoujiexi.pages.dev/api/parse'), { PARSE_ON_PREVIEW: '1' }), false);
  await pf.wrap(new Request('https://kuaishoujiexi.pages.dev/api/parse?url=https://v.kuaishou.com/x'), { PARSE_DB: d1 }, ctx, run);
  await drain();
  assert.equal(called, 1);
  assert.equal(rows(d1).length, 1);
});

test('各站内嵌的代码块和原件一致（有本地 clone 时检查）', async (t) => {
  const { block } = await import('../shared/pf-sync.mjs');
  const canon = block(readFileSync(new URL('../shared/pf-recorder.js', import.meta.url), 'utf8'));
  assert.ok(canon && canon.includes('pf-recorder v2 END'));
  const sites = (process.env.PF_SITE_FILES || '').split(',').filter(Boolean);
  if (!sites.length) return t.skip('没设置 PF_SITE_FILES');
  for (const f of sites) assert.equal(block(readFileSync(f, 'utf8')), canon, f);
});
