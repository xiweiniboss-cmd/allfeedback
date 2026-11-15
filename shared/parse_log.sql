-- D1 数据库 parse_log（id 70f93ce3-4631-4987-ab6b-54188a73a134），绑定名 PARSE_DB
-- 新建库时整份执行；线上库的变更见 shared/migrations/（只做加法 / 索引调整，不丢数据）。
-- 解析失败（ok=0）和解析记录都在这一张表里：失败记录只填 ts/site/url/ok/status/reason，解析记录会再填 IP、归属地、设备。
CREATE TABLE IF NOT EXISTS parse_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,            -- 毫秒时间戳
  site TEXT NOT NULL,             -- douyin / xiaohongshu / bilibili / youtube / tiktok / kuaishou / weibo
  url TEXT NOT NULL DEFAULT '',   -- 去掉令牌类参数后的链接
  ok INTEGER NOT NULL DEFAULT 0,  -- 1 成功 0 失败
  status INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '', -- 失败原因（里面的链接也去掉了令牌）
  ip TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  device_id TEXT NOT NULL DEFAULT '',
  ua TEXT NOT NULL DEFAULT '',
  fp TEXT NOT NULL DEFAULT ''     -- 设备指纹（32 位十六进制）
);
-- 索引只留查询真正用得上的（D1 每多一个索引，每插一行、删一行都多算一次写入）：
--   ts：按日期筛、失败统计、30 天清理；site / ip：后台按站点、IP 筛（索引自带 rowid，按 id 倒序翻页不用再排序）。
--   设备、指纹筛选量小，按 id 倒序扫描即可，不单独建索引。
CREATE INDEX IF NOT EXISTS idx_pl_ts ON parse_log(ts);
CREATE INDEX IF NOT EXISTS idx_pl_site1 ON parse_log(site);
CREATE INDEX IF NOT EXISTS idx_pl_ip1 ON parse_log(ip);
CREATE TABLE IF NOT EXISTS blocklist (
  type TEXT NOT NULL CHECK (type IN ('ip','device','fp')),
  value TEXT NOT NULL,            -- IPv4 原样；IPv6 存 /64 形式（xxxx:xxxx:xxxx:xxxx::/64）；设备存 UUID；指纹存 32 位十六进制
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (type, value)
);
-- 微博站的频控计数（以前写在共用 KV 里）：k = 'wb:<IP 或 IPv6 /64>:<北京日期>'，n 当天次数，last 上次解析时间，exp 过期时间
CREATE TABLE IF NOT EXISTS rate_counter (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL DEFAULT 0,
  last INTEGER NOT NULL DEFAULT 0,
  exp INTEGER NOT NULL
) WITHOUT ROWID;
