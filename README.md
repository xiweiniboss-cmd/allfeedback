# allfeedback · 统一反馈后台

汇总所有解析站（抖音、小红书、B站、YouTube、TikTok、快手）以及 DeepSeek 站、智驾模拟器的用户反馈，集中查看、筛选、标记处理和删除。

- 部署：Cloudflare Pages（Functions），项目名 `allfeedback`，输出目录 `public`
- 数据：与各站共用 KV 命名空间 `FEEDBACK_KV` 和 R2 存储桶 `xhs-feedback-files`（`FEEDBACK_BUCKET`）；解析失败统计读 D1 数据库 `parse_log`（`PARSE_DB`）
- 登录：环境变量 `FEEDBACK_ADMIN_KEY`（密钥类型）

## 目录

| 路径 | 说明 |
| --- | --- |
| `public/` | 静态页面（index.html / app.js / app.css / theme.js / _headers），无内联脚本和内联样式，图表用原生 SVG 绘制，不依赖外部库 |
| `functions/api/[[route]].js` | 所有 `/api/*` 接口入口 |
| `functions/_middleware.js` | 给所有响应加安全头 |
| `lib/app.js` | 后端逻辑（不在 `public/` 里，不会被当静态文件公开） |
| `shared/pf-recorder.js` | 解析失败记录器原件（各解析站内嵌同一份，见下文） |
| `shared/parse-log.js` | 解析记录 + 拉黑检查原件（各解析站内嵌同一份） |
| `shared/parse_log.sql` | D1 `parse_log` 建表语句；`shared/migrations/` 是线上库的变更 |
| `shared/pf-sync.mjs` | 把 pf-recorder / parse-log 同步到某个站点文件 / 检查是否一致 |
| `test/` | Node 测试：`npm test` |

## 接口

| 接口 | 说明 |
| --- | --- |
| `POST /api/login` | JSON `{key}`，同源，成功后下发 12 小时 HttpOnly Cookie；同一 IP（IPv6 按 /64）错 10 次锁 15 分钟（正式域名和所有预览域名共用计数） |
| `POST /api/logout` | 清除 Cookie |
| `GET /api/me` | 是否已登录 |
| `GET /api/feedback` | 列表：`site` `kind` `status`(open/done) `q` `order`(desc/asc) `limit`(≤50) `cursor` |
| `GET /api/stats` | 各站数量、未处理数、最近 30 天按天统计（北京时间） |
| `DELETE /api/feedback` | JSON `{id}`，连同附件一起删除 |
| `POST /api/status` | JSON `{id, status: "done"|"open"}` |
| `GET /api/file?key=fb/...` | 查看附件 |
| `GET /api/parses` | 解析记录（D1）：`site` `ip` `device` `fp` `from` `to`(北京日期) `result`(ok/fail) `before`(分页) `limit`(≤100)，最新在前 |
| `GET /api/blocklist` | 黑名单 |
| `POST /api/block` / `POST /api/unblock` | JSON `{type: "ip"|"device"|"fp", value, note}`，同源；IPv6 统一按 /64 存 |
| `GET /api/failures` | 解析失败统计（只读）：`days`(7/30) `site`；各站近 7 / 30 天次数、每天次数、主要原因、常见报错、最新 50 条样本 |

## 安全边界

`FEEDBACK_KV` 同时存着 DeepSeek 站的账号、会话、聊天记录。本站所有 KV 访问都经过 `guardKV()`：

- 只能 `list` 前缀 `fb_` 和 `feedback_fb_`（旧版快手）；
- 只能读 / 删反馈键；只能写本站自己的 `fbstatus_v1`（处理状态）和 `admfail_allfeedback_…`（登录失败计数，所有预览域名共用一个计数）；
- 其他任何键直接拒绝，底层 list 返回的非反馈键也会被过滤。

R2 只允许 `fb/` 前缀；附件响应带 `nosniff` 和 `Content-Security-Policy: default-src 'none'; sandbox`，不在白名单内的类型（SVG、HTML 等）一律按下载处理。

处理状态单独存在 `fbstatus_v1`，不改动原始反馈记录（DeepSeek / 智驾站的记录带 90 天过期时间，重写会丢掉）。

## 解析失败记录

各解析站的 `/api/parse` 外面包了一层 `createPfRecorder('<站点>').wrap(...)`：

- **记什么**：本站返回 5xx，或返回 200 但 `ok:false` / `code` 不是 0、200 时记一次；4xx（输入不对、人机验证、频率限制、次数用完）不记。
  记录站点、时间、本站状态码、报错原文（≤160 字，**里面出现的链接也去掉令牌**），以及用户输入的链接（只保留 `v` `p` `id` 这类定位参数，
  `xsec_token`、`share_token`、`sign` 等全部去掉，≤300 字）。不记 IP 和设备。
- **怎么存**：每次失败往 D1 `parse_log` 表插一行 `ok=0`（建表见 `shared/parse_log.sql`）。**不再写共用的 `FEEDBACK_KV`**，
  所以不会占 DeepSeek 那个 KV 的写入额度。D1 免费版每天 10 万行写入，失败记录用不了多少；保留 30 天，由微博 Worker 的每日定时任务分批删除。
- **后台统计**：`/api/failures` 对 `parse_log` 做 `GROUP BY 站点 × 北京日期 × 状态码 × 原因`（走 `ts` 索引），原因归类用 `Map` 在服务端做。
- **不影响解析**：写入在 `waitUntil` 里跑，最多等 10 秒，异常全部吞掉；没绑 D1 就什么都不做。
- **开关**：站点环境变量 `PARSE_LOG_OFF=1` 时不写。
- **预览部署不提供解析**：`<分支或哈希>.<项目>.pages.dev` 上 `/api/parse` 直接返回 403（预览环境没有人机验证，避免变成公开解析接口）；
  确实要测，给预览环境加 `PARSE_ON_PREVIEW=1`。

站点名：`douyin` `xiaohongshu` `bilibili` `youtube` `tiktok` `kuaishou` `weibo`（后台已包含微博）。

**新增一个解析站**（例如微博）：把 `shared/pf-recorder.js` 里 `BEGIN … END` 之间的代码贴进站点的 `_worker.js`
（或 `node shared/pf-sync.mjs <文件>` 更新已有的块），然后：

```js
const pf = createPfRecorder('weibo');
// 路由里：
if (url.pathname === '/api/parse') return pf.wrap(request, env, ctx, () => handleParse(request, env));
```

并给站点的 Pages 项目（生产环境）绑定 D1 `parse_log`，绑定名 `PARSE_DB`。

站点名不在上面的列表里时，再把它加进 `lib/app.js` 的 `PF_SITES` 和 `SITES`。检查各站内嵌代码是否和原件一致：
`node shared/pf-sync.mjs --check ../douyinqushuiyintest/_worker.js …`

## 解析记录与拉黑（D1）

- 数据库：D1 `parse_log`（id `70f93ce3-4631-4987-ab6b-54188a73a134`），绑定名 `PARSE_DB`，各解析站生产环境和本站都要绑定。建表见 `shared/parse_log.sql`。
- 各解析站 `/api/parse` 外面再包一层 `createParseLog('<站点>').wrap(...)`（见 `shared/parse-log.js`）：
  - 先查黑名单（每个 isolate 缓存 60 秒，读 D1 超时 1.5 秒），命中返回 403 `{"error":"访问受限"}`；D1 不可用时放行。
  - 先查黑名单：IP（IPv6 按 /64）、设备 ID、设备指纹任一命中都拦。
  - 只记有效链接（站点传 `valid(input)`，和它自己的本地校验同一套；空 / 不是本站链接 / 格式不对不记）。每条记：站点、链接（去掉令牌类参数）、结果、状态码、原因、IP、归属地（request.cf）、设备 ID（请求头 `X-Device-Id`，必须是 UUID）、设备指纹（请求头 `X-Device-Fp`，32 位十六进制）、UA（≤200 字）。被拉黑的请求每分钟最多记一行。
  - 设备指纹：前端用 canvas 渲染、屏幕尺寸/色深、时区、语言、CPU 核数、平台、UA 算 SHA-256 取前 32 位。尽力而为：清浏览器数据不变，但换浏览器、升级浏览器、改分辨率会变；同型号同配置的设备可能撞同一个指纹（拉黑指纹前先看看这个指纹下有哪些记录）。Safari 隐私模式等会给 canvas 加噪声，指纹每次都变。
  - 写入在 `waitUntil` 里；约 1% 的写入顺手 `DELETE … WHERE ts < 30 天前`。
- 2026-11-15 加 `fp` 列：线上已执行 `ALTER TABLE parse_log ADD COLUMN fp …`、建 `idx_pl_fp`，并重建 `blocklist`（CHECK 加 `fp`，当时表是空的）。
- 不用 KV：解析记录和黑名单都在 D1，KV 写入一次都不增加。
