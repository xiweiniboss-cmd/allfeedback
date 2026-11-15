-- D1 数据库 parse_log（id 70f93ce3-4631-4987-ab6b-54188a73a134），绑定名 PARSE_DB
CREATE TABLE IF NOT EXISTS parse_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,            -- 毫秒时间戳
  site TEXT NOT NULL,             -- douyin / xiaohongshu / bilibili / youtube / tiktok / kuaishou / weibo
  url TEXT NOT NULL DEFAULT '',   -- 去掉令牌类参数后的链接
  ok INTEGER NOT NULL DEFAULT 0,  -- 1 成功 0 失败
  status INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  device_id TEXT NOT NULL DEFAULT '',
  ua TEXT NOT NULL DEFAULT '',
  fp TEXT NOT NULL DEFAULT ''     -- 设备指纹（32 位十六进制）；2026-11-15 加的列，线上用 ALTER TABLE ADD COLUMN 补上
);
CREATE INDEX IF NOT EXISTS idx_pl_ts ON parse_log(ts);
CREATE INDEX IF NOT EXISTS idx_pl_ip ON parse_log(ip, ts);
CREATE INDEX IF NOT EXISTS idx_pl_dev ON parse_log(device_id, ts);
CREATE INDEX IF NOT EXISTS idx_pl_site ON parse_log(site, ts);
CREATE INDEX IF NOT EXISTS idx_pl_fp ON parse_log(fp, ts);
CREATE TABLE IF NOT EXISTS blocklist (
  type TEXT NOT NULL CHECK (type IN ('ip','device','fp')),
  value TEXT NOT NULL,            -- IPv4 原样；IPv6 存 /64 形式（xxxx:xxxx:xxxx:xxxx::/64）；设备存 UUID；指纹存 32 位十六进制
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (type, value)
);
