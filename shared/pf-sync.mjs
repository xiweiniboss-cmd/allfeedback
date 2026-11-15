// 把 shared/pf-recorder.js、shared/parse-log.js 里 BEGIN…END 之间的代码同步到各站文件里同样标记的位置。
// 用法：node shared/pf-sync.mjs [--check] <站点文件>...
//   不带 --check：原地替换；带 --check：只检查是否一致（不一致退出码 1）
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MODULES = [['pf-recorder', './pf-recorder.js'], ['parse-log', './parse-log.js']];
export function block(src, name = 'pf-recorder') {
  const BEGIN = '// ==== ' + name + ' v1 BEGIN ====', END = '// ==== ' + name + ' v1 END ====';
  const i = src.indexOf(BEGIN), j = src.indexOf(END);
  if (i < 0 || j < i) return null;
  return src.slice(i, j + END.length);
}
const canon = Object.fromEntries(MODULES.map(([n, f]) => [n, block(readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8'), n)]));
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const check = args[0] === '--check';
  let bad = 0;
  for (const f of check ? args.slice(1) : args) {
    let src = readFileSync(f, 'utf8');
    let found = 0;
    for (const [name] of MODULES) {
      const cur = block(src, name);
      if (!cur) continue;
      found++;
      if (cur === canon[name]) { console.log('一致：' + name + ' ' + f); continue; }
      if (check) { console.error('不一致：' + name + ' ' + f); bad++; continue; }
      src = src.replace(cur, canon[name]);
      writeFileSync(f, src);
      console.log('已同步：' + name + ' ' + f);
    }
    if (!found) { console.error('没有找到任何标记：' + f); bad++; }
  }
  process.exit(bad ? 1 : 0);
}
