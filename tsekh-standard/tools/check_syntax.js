// Проверка синтаксиса: все .gs и встроенные <script> в .html (node tools/check_syntax.js app)
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = process.argv[2]; let bad = 0, n = 0;
for (const f of fs.readdirSync(dir).sort()) {
  const p = path.join(dir, f), src = fs.readFileSync(p, 'utf8');
  const chunks = f.endsWith('.gs') ? [src] : f.endsWith('.html') ? [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]) : [];
  chunks.forEach((c, i) => {
    n++;
    // шаблоны HtmlService (<?= ?>) в скриптах страниц заменяем заглушкой
    c = c.replace(/<\?!?=?[\s\S]*?\?>/g, '0');
    try { new vm.Script(c, { filename: f + '#' + i }); } catch (e) { bad++; console.log('FAIL', f, '#' + i, e.message); }
  });
}
console.log(bad ? `ОШИБОК: ${bad} из ${n}` : `OK: ${n} фрагментов без ошибок`);
process.exit(bad ? 1 : 0);
