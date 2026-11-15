// 把 shared/pf-recorder.js 里 BEGIN…END 之间的代码同步到各站文件里同样标记的位置。
// 用法：node shared/pf-sync.mjs [--check] <站点文件>...
//   不带 --check：原地替换；带 --check：只检查是否一致（不一致退出码 1）
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BEGIN = '// ==== pf-recorder v1 BEGIN ====';
const END = '// ==== pf-recorder v1 END ====';
export function block(src) {
  const i = src.indexOf(BEGIN), j = src.indexOf(END);
  if (i < 0 || j < i) return null;
  return src.slice(i, j + END.length);
}
const canonical = block(readFileSync(fileURLToPath(new URL('./pf-recorder.js', import.meta.url)), 'utf8'));
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const check = args[0] === '--check';
  let bad = 0;
  for (const f of check ? args.slice(1) : args) {
    const src = readFileSync(f, 'utf8');
    const cur = block(src);
    if (!cur) { console.error('没有找到 pf-recorder 标记：' + f); bad++; continue; }
    if (cur === canonical) { console.log('一致：' + f); continue; }
    if (check) { console.error('不一致：' + f); bad++; continue; }
    writeFileSync(f, src.replace(cur, canonical));
    console.log('已同步：' + f);
  }
  process.exit(bad ? 1 : 0);
}
