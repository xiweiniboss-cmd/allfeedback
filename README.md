# allfeedback · 统一反馈后台

汇总所有解析站（抖音、小红书、B站、YouTube、TikTok、快手）以及 DeepSeek 站、智驾模拟器的用户反馈，集中查看、筛选、标记处理和删除。

- 部署：Cloudflare Pages（Functions），项目名 `allfeedback`
- 数据：与各站共用 KV 命名空间 `FEEDBACK_KV` 和 R2 存储桶 `xhs-feedback-files`（`FEEDBACK_BUCKET`）
- 登录：环境变量 `FEEDBACK_ADMIN_KEY`（密钥类型）

功能代码见 PR #1。
