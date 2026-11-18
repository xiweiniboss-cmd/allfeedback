-- 2026-11-19：解析记录预览卡片。parse_log 加三列（只做加法，不动已有数据；旧记录三列为空串，后台显示占位）。
-- 在线上 D1 parse_log 执行一次（每条 ADD COLUMN 只能执行一次，重复执行会报 duplicate column，可忽略）：
--   npx wrangler d1 execute parse_log --remote --file shared/migrations/2026-11-19-preview.sql
-- 各解析站的 parse-log v3 在迁移前也能写（缺列时自动退回旧列），但建议先执行本迁移，再合并 / 部署各站和后台。
ALTER TABLE parse_log ADD COLUMN cover TEXT DEFAULT '';
ALTER TABLE parse_log ADD COLUMN title TEXT DEFAULT '';
ALTER TABLE parse_log ADD COLUMN media TEXT DEFAULT '';
