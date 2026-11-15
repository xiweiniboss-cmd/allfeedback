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

## 安全边界

`FEEDBACK_KV` 同时存着 DeepSeek 站的账号、会话、聊天记录。本站所有 KV 访问都经过 `guardKV()`：

- 只能 `list` 前缀 `fb_` 和 `feedback_fb_`（旧版快手）；
- 只能读 / 删反馈键；只能写本站自己的 `fbstatus_v1`（处理状态）和 `admfail_allfeedback_…`（登录失败计数，所有预览域名共用一个计数）；
- 其他任何键直接拒绝，底层 list 返回的非反馈键也会被过滤。

R2 只允许 `fb/` 前缀；附件响应带 `nosniff` 和 `Content-Security-Policy: default-src 'none'; sandbox`，不在白名单内的类型（SVG、HTML 等）一律按下载处理。

处理状态单独存在 `fbstatus_v1`，不改动原始反馈记录（DeepSeek / 智驾站的记录带 90 天过期时间，重写会丢掉）。
