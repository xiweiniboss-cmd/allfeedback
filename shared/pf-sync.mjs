// 把 shared/ 里共用模块 BEGIN…END 之间的代码同步到各站文件里同样标记的位置（标记里的版本号 vN 不限，整块替换）。
// 用法：node shared/pf-sync.mjs [--check] <站点文件>...
//   不带 --check：原地替换；带 --check：只检查是否一致（不一致退出码 1）
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MODULES = [['pf-recorder', './pf-recorder.js'], ['parse-log', './parse-log.js']];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function block(src, name = 'pf-recorder') {
  const re = new RegExp('// ==== ' + esc(name) + ' v\\d+ BEGIN ====[\\s\\S]*?// ==== ' + esc(name) + ' v\\d+ END ====');
  const m = String(src).match(re);
  return m ? m[0] : null;
}
const canon = {};
for (const [n, f] of MODULES) {
  const p = fileURLToPath(new URL(f, import.meta.url));
  if (existsSync(p)) canon[n] = block(readFileSync(p, 'utf8'), n);
}
export { canon };
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const check = args[0] === '--check';
  let bad = 0;
  for (const f of check ? args.slice(1) : args) {
    let src = readFileSync(f, 'utf8');
    let found = 0;
    for (const name of Object.keys(canon)) {
      const cur = block(src, name);
      if (!cur) continue;
      found++;
      if (cur === canon[name]) { console.log('一致：' + name + ' ' + f); continue; }
      if (check) { console.error('不一致：' + name + ' ' + f); bad++; continue; }
      src = src.replace(cur, () => canon[name]);
      writeFileSync(f, src);
      console.log('已同步：' + name + ' ' + f);
    }
    if (!found) { console.error('没有找到任何标记：' + f); bad++; }
  }
  process.exit(bad ? 1 : 0);
}
