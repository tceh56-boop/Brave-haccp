// Депонируемые материалы для заявки в Роспатент: фрагмент исходного текста — первые и последние 25 страниц
// по 50 строк, с номерами страниц и названиями файлов. Плюс сведения для реферата: объём, число файлов.
// Результат — docs/юридическое/роспатент/. Запуск: npm run legal:listing
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.resolve(ROOT, '../docs/юридическое/роспатент');
const PAGES = 25, LINES = 50, WIDTH = 100;

const walk = (d) => readdirSync(d).sort().flatMap((f) => {
  const p = path.join(d, f);
  return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|sql|css)$/.test(f) ? [p] : [];
});
// порядок: схема базы → серверная логика → API → интерфейс
const files = [...walk(path.join(ROOT, 'migrations')), ...walk(path.join(ROOT, 'src/server')), ...walk(path.join(ROOT, 'src/app/api')),
  ...walk(path.join(ROOT, 'src')).filter((f) => !f.includes('/src/server/') && !f.includes('/src/app/api/'))];
const lines = [];
let bytes = 0;
for (const f of files) {
  const text = readFileSync(f, 'utf8'); bytes += Buffer.byteLength(text);
  lines.push(`// ===== ${path.relative(ROOT, f)} =====`);
  for (const l of text.replace(/\t/g, '  ').split('\n')) for (let i = 0; i < Math.max(1, l.length); i += WIDTH) lines.push(l.slice(i, i + WIDTH));
}
const total = Math.ceil(lines.length / LINES);
const page = (n) => lines.slice((n - 1) * LINES, n * LINES);
const numbers = total <= PAGES * 2 ? [...Array(total).keys()].map((i) => i + 1)
  : [...[...Array(PAGES).keys()].map((i) => i + 1), ...[...Array(PAGES).keys()].map((i) => total - PAGES + 1 + i)];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><style>
@page{size:A4;margin:12mm 14mm 14mm 20mm} body{margin:0;font:8.2pt/1.32 'DejaVu Sans Mono',monospace}
.pg{page-break-after:always;white-space:pre} .h{font:bold 9pt Arial;margin-bottom:3mm;display:flex;justify-content:space-between}
.gap{font:italic 9pt Arial;margin:4mm 0}</style>
${numbers.map((n, i) => `<div class="pg"><div class="h"><span>Программа для ЭВМ «ЦЕХ». Исходный текст (фрагмент)</span><span>Лист ${i + 1} · стр. ${n} из ${total}</span></div>${
  i === PAGES && total > PAGES * 2 ? `<div class="gap">… страницы ${PAGES + 1}–${total - PAGES} не приводятся …</div>` : ''}${esc(page(n).join('\n'))}</div>`).join('')}
</html>`;
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch(); const p = await b.newPage();
await p.setContent(html, { waitUntil: 'load' });
await p.pdf({ path: path.join(OUT, 'депонируемые_материалы_исходный_текст.pdf'), format: 'A4', printBackground: true });
await b.close();
const facts = { files: files.length, sourceKB: Math.round(bytes / 1024), lines: lines.length, pagesTotal: total, pagesDeposited: numbers.length, languages: 'TypeScript, SQL (PostgreSQL), CSS' };
writeFileSync(path.join(OUT, 'сведения_для_реферата.json'), JSON.stringify(facts, null, 1));
console.log(facts);
