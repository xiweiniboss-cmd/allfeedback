# allfeedback · 统一反馈后台

汇总所有解析站（抖音、小红书、B站、YouTube、TikTok、快手）以及 DeepSeek 站、智驾模拟器的用户反馈，集中查看、筛选、标记处理和删除。

- 部署：Cloudflare Pages（Functions），项目名 `allfeedback`，输出目录 `public`
- 数据：与各站共用 KV 命名空间 `FEEDBACK_KV` 和 R2 存储桶 `xhs-feedback-files`（`FEEDBACK_BUCKET`）
- 登录：环境变量 `FEEDBACK_ADMIN_KEY`（密钥类型）

## 目录

| 路径 | 说明 |
| --- | --- |
| `public/` | 静态页面（index.html / app.js / app.css / theme.js / _headers），无内联脚本和内联样式，图表用原生 SVG 绘制，不依赖外部库 |
| `functions/api/[[route]].js` | 所有 `/api/*` 接口入口 |
| `functions/_middleware.js` | 给所有响应加安全头 |
| `lib/app.js` | 后端逻辑（不在 `public/` 里，不会被当静态文件公开） |
| `shared/pf-recorder.js` | 解析失败记录器原件（各解析站内嵌同一份，见下文） |
| `shared/pf-sync.mjs` | 把记录器同步到某个站点文件 / 检查是否一致 |
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
| `GET /api/failures` | 解析失败统计（只读）：`days`(7/30) `site`；各站近 7 / 30 天次数、每天次数、主要原因、常见报错、最新 50 条样本 |

## 安全边界

`FEEDBACK_KV` 同时存着 DeepSeek 站的账号、会话、聊天记录。本站所有 KV 访问都经过 `guardKV()`：

- 只能 `list` 前缀 `fb_` 和 `feedback_fb_`（旧版快手）；
- 只能读 / 删反馈键；只能按完整键名 **读** 解析失败统计 `pf_<站点>_<YYYY-MM-DD>`（不能 list、写、删）；只能写本站自己的 `fbstatus_v1`（处理状态）和 `admfail_allfeedback_…`（登录失败计数，所有预览域名共用一个计数）；
- 其他任何键直接拒绝，底层 list 返回的非反馈键也会被过滤。

R2 只允许 `fb/` 前缀；附件响应带 `nosniff` 和 `Content-Security-Policy: default-src 'none'; sandbox`，不在白名单内的类型（SVG、HTML 等）一律按下载处理。

处理状态单独存在 `fbstatus_v1`，不改动原始反馈记录（DeepSeek / 智驾站的记录带 90 天过期时间，重写会丢掉）。

## 解析失败记录

各解析站的 `/api/parse` 外面包了一层 `createPfRecorder('<站点>').wrap(...)`：

- **记什么**：本站返回 5xx，或返回 200 但 `ok:false` / `code≠0` 时记一次；4xx（输入不对、人机验证、频率限制、次数用完）不记。
  记录站点、时间、原因代码（超时 / 上游报错 / 上游额度 / 没找到视频 / 网络 / 配置缺失 / 程序异常…）、报错原文（≤120 字）、本站状态码、能识别时的上游 HTTP 状态码，
  以及用户输入的链接（只保留 `v` `p` `id` 这类定位参数，`xsec_token`、`share_token`、`sign` 等全部去掉，≤300 字）。
- **怎么存**：每个站每个北京日一个键 `pf_<站点>_<YYYY-MM-DD>`，里面是计数 + 最近 30 条样本，35 天自动过期。
- **省写入**：同一 isolate 同一站点两次写入至少隔 25 秒，中间的失败攒在内存里合并写；当天已写 30 次后改为至少隔 30 分钟写一次。
  读-改-写不是原子的，并发时可能丢几条计数，统计数据可以接受。
- **不影响解析**：全部在 `waitUntil` 里跑，异常全部吞掉。

站点名：`douyin` `xiaohongshu` `bilibili` `youtube` `tiktok` `kuaishou` `weibo`（后台已包含微博）。

**新增一个解析站**（例如微博）：把 `shared/pf-recorder.js` 里 `BEGIN … END` 之间的代码贴进站点的 `_worker.js`
（或 `node shared/pf-sync.mjs <文件>` 更新已有的块），然后：

```js
const pf = createPfRecorder('weibo');
// 路由里：
if (url.pathname === '/api/parse') return pf.wrap(request, env, ctx, () => handleParse(request, env));
```

站点名不在上面的列表里时，再把它加进 `lib/app.js` 的 `PF_SITES` 和 `SITES`。检查各站内嵌代码是否和原件一致：
`node shared/pf-sync.mjs --check ../douyinqushuiyintest/_worker.js …`
