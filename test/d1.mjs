// 测试用 D1：用 node:sqlite 真跑 SQL，接口模仿 Cloudflare D1（prepare / bind / all / first / run / batch）
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function fakeD1({ schema = true, fail = false } = {}) {
  const db = new DatabaseSync(':memory:');
  if (schema) db.exec(readFileSync(new URL('../shared/parse_log.sql', import.meta.url), 'utf8'));
  const log = [];
  const api = {
    db, log, fail,
    prepare(sql) {
      let args = [];
      const stmt = {
        bind(...a) { args = a; return stmt; },
        async all() { log.push(sql); if (api.fail) throw new Error('D1 down'); return { results: db.prepare(sql).all(...args).map((r) => ({ ...r })), success: true }; },
        async first() { log.push(sql); if (api.fail) throw new Error('D1 down'); const r = db.prepare(sql).get(...args); return r ? { ...r } : null; },
        async run() { log.push(sql); if (api.fail) throw new Error('D1 down'); const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
      };
      return stmt;
    },
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.all()); return out; },
  };
  return api;
}
