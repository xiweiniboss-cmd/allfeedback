-- 2026-11-16：精简 parse_log 索引（每插 / 删一行的写入次数从 6 降到 4），加微博频控表。不动任何数据。
DROP INDEX IF EXISTS idx_pl_dev;
DROP INDEX IF EXISTS idx_pl_fp;
DROP INDEX IF EXISTS idx_pl_site;
DROP INDEX IF EXISTS idx_pl_ip;
CREATE INDEX IF NOT EXISTS idx_pl_ts ON parse_log(ts);
CREATE INDEX IF NOT EXISTS idx_pl_site1 ON parse_log(site);
CREATE INDEX IF NOT EXISTS idx_pl_ip1 ON parse_log(ip);
CREATE TABLE IF NOT EXISTS rate_counter (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL DEFAULT 0,
  last INTEGER NOT NULL DEFAULT 0,
  exp INTEGER NOT NULL
) WITHOUT ROWID;
