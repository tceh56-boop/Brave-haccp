// Сборка инструкции: content.mjs + снимки shots/ → manual.html → PDF (два прохода: номера страниц в содержании).
// Запуск: node tools/manual/build.mjs [выходной.pdf]  (снимки — tools/manual/tour.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { SECTIONS, ROLES, PATH, TROUBLE, RULES, MEMO, INTRO, FORMS } from './content.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DATE = new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' });
const OUT = process.argv[2] || path.join(DIR, '../../../docs/ЦЕХ_инструкция_для_персонала.pdf');
const SPLIT = 2.75, PIECE = 2.4, OVERLAP = 24;
const LAST = SECTIONS.length, NT = LAST + 1, NR = LAST + 2;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (s) => esc(s)
  .replace(/\[\[!(.+?)\]\]/g, '<span class="chip main">$1</span>')
  .replace(/\[\[(.+?)\]\]/g, '<span class="chip">$1</span>')
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  .replace(/\{(\d+)\}/g, '<span class="num inl">$1</span>')
  .replace(/ → /g, ' <span class="arr">→</span> ');
const imgSize = (f) => { const b = fs.readFileSync(path.join(DIR, 'shots', f + '.png')); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };
const steps = (arr, dark) => '<ol class="steps' + (dark ? ' dark' : '') + '">' + arr.map((t, i) => '<li><span class="num">' + (i + 1) + '</span><div>' + fmt(t) + '</div></li>').join('') + '</ol>';

function block(b) {
  if (b.h) return '<h3>' + fmt(b.h) + '</h3>';
  if (b.p) return '<p>' + fmt(b.p) + '</p>';
  if (b.call) return '<div class="call ' + b.call + '"><div class="ct">' + fmt(b.t) + '</div>' + (b.x ? '<div>' + fmt(b.x) + '</div>' : '') + (b.list ? '<ul>' + b.list.map((x) => '<li>' + fmt(x) + '</li>').join('') + '</ul>' : '') + '</div>';
  if (b.tbl) return '<table class="t"><tr>' + b.tbl[0].map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr>' + b.tbl.slice(1).map((r) => '<tr><td><b>' + fmt(r[0]) + '</b></td>' + r.slice(1).map((c) => '<td>' + fmt(c) + '</td>').join('') + '</tr>').join('') + '</table>';
  if (b.list) return '<ul class="list">' + b.list.map((x) => '<li>' + fmt(x) + '</li>').join('') + '</ul>';
  if (b.shot) {
    // снимки телефона (390 px × 2). Невысокие — рядом с шагами; длинные режутся на 2–3 колонки (pieces()).
    const s = imgSize(b.shot), ratio = s.h / s.w;
    const st = b.steps ? steps(b.steps) : '';
    if (ratio <= SPLIT) {
      const wmm = Math.min(76, Math.max(58, Math.round(170 / ratio)));
      return '<div class="fig side"><div class="shot" style="width:' + wmm + 'mm"><img src="shots/' + b.shot + '.jpg"></div><div class="txt">' + st + '</div></div>';
    }
    const k = Math.ceil(ratio / PIECE), pr = s.h / k / s.w, cw = k === 2 ? Math.min(54, Math.round(165 / pr)) : 56;
    const cols = Array.from({ length: k }, (_, i) => '<div class="shot" style="width:' + cw + 'mm"><img src="shots/' + b.shot + '-' + (i + 1) + '.jpg"></div>').join('');
    return k === 2 ? '<div class="fig side">' + cols + '<div class="txt">' + st + '</div></div>'
      : '<div class="fig"><div class="cols">' + cols + '</div>' + st + '</div>';
  }
  if (b.steps) return steps(b.steps, true);
  return '';
}

const section = (s) => '<section class="sec" id="s' + s.n + '"><h1><span class="sn">' + s.n + '.</span> ' + esc(s.title) + '</h1>' +
  '<div class="who"><span><b>Кто:</b> ' + esc(s.who) + '</span>' + (s.where ? '<span><b>Где:</b> ' + fmt(s.where) + '</span>' : '') + '</div>' +
  (s.intro ? '<p class="intro">' + fmt(s.intro) + '</p>' : '') + s.blocks.map(block).join('') + '</section>';

const LOGO = fs.readFileSync(path.join(DIR, 'logo.svg'), 'utf8').replace('fill="currentColor"', 'fill="#3B2A20" style="width:95mm"');

function html(tocPages) {
  const tp = (n) => (tocPages && tocPages[n]) || '';
  const body = [];
  body.push('<section class="cover"><div class="cv">' + LOGO + '<div class="rule"></div><h1 class="ct1">Инструкция для персонала</h1><div class="sub">Кухня · склад · ХАССП · касса · руководство<br>Новая версия системы</div><div class="line"></div>' +
    '<div class="meta">Версия от ' + DATE + '<br>Снимки экранов сделаны в демо-организации «Кафе «Демо»»: сотрудники, продукты и цифры — условные.<br>Правообладатель системы — Слепцов Денис Владимирович</div></div></section>');
  body.push('<section class="sec" id="sintro"><h1>Введение. Что такое ЦЕХ и зачем он нужен</h1>' + INTRO.map(block).join('') + '</section>');
  body.push('<section class="sec"><h1>Как пользоваться инструкцией</h1><p class="intro">Найдите свою роль в таблице и прочитайте отмеченные для неё разделы. Раздел 1 и разделы ' + NT + '–' + NR + ' обязательны для всех.</p>' +
    '<table class="t"><tr><th>Роль</th><th>Главное в работе</th><th>Разделы</th></tr>' + ROLES.map((r) => '<tr><td><b>' + r[0] + '</b></td><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>').join('') + '</table>' +
    '<h3>Как читать снимки</h3><p>Оранжевая рамка и номер <span class="num inl">1</span> на снимке — то же, что шаг <span class="num inl">1</span> в тексте рядом. Кнопки в тексте выглядят так: <span class="chip">Подтвердить</span>, главная кнопка — <span class="chip main">Принять</span>. Путь к экрану записан через стрелку: <b>Склад <span class="arr">→</span> Расход</b>.</p>' +
    block({ call: 'info', t: 'Вы видите не все разделы?', x: 'Так и должно быть: система показывает только разделы и кнопки вашей роли. Нужен доступ — обратитесь к руководителю.' }) +
    block({ call: 'ok', t: 'Три правила системы', list: ['Ничего не придумывается: неизвестное значение остаётся пустым, а не 0.', 'Записи не стираются: исправление сохраняется рядом с исходной записью.', 'AI только подсказывает — решает и подтверждает человек.'] }) + '</section>');
  body.push('<section class="sec"><h1 class="h1s">Путь продукта в системе</h1><p class="intro">Каждый шаг оставляет запись: кто, когда, что измерил. Операция вносится один раз — журналы, себестоимость и пакет для проверки собираются из неё.</p><div class="path">' +
    PATH.map((x, i) => '<div class="pb' + (x[3] ? ' ctl' : '') + '"><div class="pn">' + x[2] + '</div><div class="pt">' + x[0] + '</div><div class="pd">' + x[1] + '</div>' + (i % 4 < 3 ? '<div class="pa">→</div>' : '') + '</div>').join('') + '</div>' +
    '<div class="legend"><span class="lg"></span> действие сотрудника <span class="lg ctl"></span> контроль: без него дальше нельзя <span class="muted">цифра в углу — номер раздела</span></div></section>');
  const toc = SECTIONS.map((s) => [s.n, s.title, s.toc]).concat([[NT, 'Если что-то пошло не так', 'все'], [NR, 'Правила честных записей', 'все'], ['—', 'Памятка на смену (повесить на кухне)', 'все'], ['П', 'Печатные формы', 'все']]);
  body.push('<section class="sec"><h1>Содержание</h1><div class="toc">' + toc.map((r) => '<div class="tr"><span class="tn">' + r[0] + '</span><span class="tt">' + esc(r[1]) + '</span><span class="tw">' + esc(r[2]) + '</span><span class="tpg">' + tp(r[0]) + '</span></div>').join('') + '</div></section>');
  SECTIONS.forEach((s) => body.push(section(s)));
  body.push('<section class="sec" id="s' + NT + '"><h1><span class="sn">' + NT + '.</span> Если что-то пошло не так</h1><table class="t"><tr><th>Что видите</th><th>Что это значит</th><th>Что делать</th></tr>' + TROUBLE.map((r) => '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td><td>' + fmt(r[2]) + '</td></tr>').join('') + '</table>' +
    block({ call: 'ok', t: 'Нажали кнопку дважды или пропала связь?', x: 'Повторная отправка той же операции не создаёт вторую запись: система узнаёт операцию и вернёт первый результат.' }) + '<p>Не нашли ответ — обратитесь к шефу; по ХАССП и отклонениям — к ответственному ХАССП; по доступу и правам — к руководителю.</p></section>');
  body.push('<section class="sec" id="s' + NR + '"><h1><span class="sn">' + NR + '.</span> Правила честных записей</h1><p class="intro">Журналы ХАССП — доказательство для проверки. Каждая запись подписана и видна в истории, журнал действий защищён от изменения.</p><table class="t"><tr><th>Правило</th><th>Почему</th></tr>' + RULES.map((r) => '<tr><td><b>' + esc(r[0]) + '</b></td><td>' + esc(r[1]) + '</td></tr>').join('') + '</table></section>');
  const box = (t, items) => '<div class="memo"><div class="mt">' + t + '</div>' + items.map((x) => '<div class="mi"><span class="cb"></span><span>' + fmt(x) + '</span></div>').join('') + '</div>';
  body.push('<section class="sec" id="smemo"><h1>Памятка на смену</h1><p class="muted">Распечатайте и повесьте рядом с планшетом.</p><div class="memos">' + MEMO.map(([t, items]) => box(t, items)).join('') + '</div>' +
    block({ call: 'warn', t: 'Система недоступна', x: 'Записывайте на бумажных бланках с реальным временем, затем внесите в систему — запись пометится «внесено позже». Чеки пробивайте на ККТ как обычно.' }) + '</section>');
  body.push('<section class="sec" id="sforms"><h1><span class="sn">П.</span> Печатные формы</h1><p class="intro">Образцы документов, которые система печатает сама из данных, внесённых в работе. Снимки сделаны в демо-организации; на бумаге — формат A4. Любую форму можно сохранить в PDF: в окне печати выберите «Сохранить как PDF».</p>' +
    '<table class="t"><tr><th>Форма</th><th>Где печатается</th></tr>' + FORMS.map((f) => '<tr><td><b>' + esc(f[1]) + '</b></td><td>' + fmt(f[2]) + '</td></tr>').join('') + '</table>' +
    block({ call: 'info', t: 'Программа производственного контроля и пакет ППК + ХАССП', x: 'Сейчас пакет для проверки (раздел 10) выгружает журналы, план ХАССП, отклонения и CAPA с доказательствами. Программа производственного контроля, план ХАССП, приказы, карты ККТ и инструкции единым комплектом будут собираться мастером ППК — он в разработке; образцы этих форм появятся здесь вместе с ним.' }) + '</section>');
  for (const f of FORMS) for (let i = 1; i <= f[4]; i++) body.push('<section class="formpage">' + (i === 1 ? '<h2>' + esc(f[1]) + '</h2><p class="small">' + fmt(f[3]) + '</p>' : '<h2 class="cont">' + esc(f[1]) + ' — стр. ' + i + '</h2>') + '<div class="formimg"><img src="forms/' + f[0] + '-' + i + '.jpg"></div></section>');
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>ЦЕХ — инструкция для персонала</title><style>' + CSS + '</style></head><body>' + body.join('\n') + '</body></html>';
}

const CSS = `
@page{size:A4;margin:16mm 15mm 17mm 15mm}
*{box-sizing:border-box}
body{font-family:Inter,'DejaVu Sans',Arial,sans-serif;font-size:10.3pt;line-height:1.48;color:#2a1f18;margin:0}
h1{font-family:Caladea,'DejaVu Serif',Georgia,serif;font-size:23pt;color:#3B2A20;margin:0 0 4mm;padding-bottom:2.5mm;border-bottom:2px solid #C8A27A;font-weight:700;line-height:1.15}
h1 .sn{color:#E08A12}
h1.h1s{font-size:16pt;border:0;padding:0;margin-bottom:2mm}
h3{font-family:Caladea,'DejaVu Serif',Georgia,serif;font-size:14pt;color:#3B2A20;margin:6mm 0 2.5mm;break-after:avoid}
p{margin:0 0 2.5mm}
.intro{font-size:11pt}
.muted{color:#8a7a6a}
.sec{break-before:page}
.formpage{break-before:page}.formpage h2{margin:0 0 2mm;font-size:13pt}.formpage h2.cont{color:#7a6a5a;font-size:10pt}.formpage .small{margin:0 0 3mm;font-size:9pt}.formimg{text-align:center}.formimg img{max-width:170mm;max-height:240mm;border:1px solid #bbb;box-shadow:0 1px 4px rgba(0,0,0,.15)}
.who{background:#F6EEE4;border-left:3px solid #C8A27A;padding:2.2mm 4mm;margin:0 0 4mm;font-size:9.5pt;display:flex;column-gap:8mm;row-gap:1mm;flex-wrap:wrap}
.who b{color:#8B3A12}
.chip{display:inline-block;border:1px solid #cdbfae;background:#FBF7F2;border-radius:5px;padding:0 5px;font-weight:600;font-size:9.2pt;line-height:1.45;white-space:nowrap;color:#2a1f18}
.chip.main{background:#F5A623;border-color:#E08A12}
.arr{color:#E08A12;font-weight:700}
.num{display:inline-flex;align-items:center;justify-content:center;min-width:6mm;height:6mm;border-radius:50%;background:#F07A1A;color:#fff;font-weight:700;font-size:9pt;flex:0 0 auto}
.num.inl{min-width:4.6mm;height:4.6mm;font-size:7.5pt;vertical-align:1px}
ol.steps{list-style:none;padding:0;margin:2mm 0 3mm}
ol.steps li{display:flex;gap:3mm;margin:0 0 2.2mm;break-inside:avoid}
ol.steps li div{padding-top:.3mm}
ol.steps.dark .num{background:#fff;color:#3B2A20;border:1.6px solid #3B2A20}
ul.list{margin:1mm 0 3mm;padding-left:5mm}
ul.list li{margin-bottom:1.5mm}
.fig{margin:2mm 0 3mm;break-inside:avoid}
.fig .shot{border:1px solid #e3d6c6;border-radius:8px;overflow:hidden;background:#F1E6D8;box-shadow:0 1px 4px rgba(60,40,20,.12);margin:0 auto 2mm}
.fig .shot img{display:block;width:100%}
.fig.side{display:flex;gap:6mm;align-items:flex-start}
.fig.side .shot{flex:0 0 auto;margin:0}
.fig.side .txt{flex:1 1 auto}
.fig.side{gap:4mm}
.fig .cols{display:flex;gap:4mm;justify-content:center;margin-bottom:3mm}.fig .cols .shot{margin:0}
.fig.side ol.steps{margin-top:0}
.call{border-radius:7px;padding:3mm 4mm;margin:2mm 0 4mm;break-inside:avoid;font-size:9.8pt}
.call .ct{font-weight:700;margin-bottom:1mm}
.call ul{margin:1mm 0 0;padding-left:5mm}.call li{margin-bottom:1mm}
.call.warn{background:#FFF6E3;border:1px solid #F0D29A}.call.warn .ct{color:#9A6400}
.call.danger{background:#FCEBEA;border:1px solid #EFC2BF}.call.danger .ct{color:#A1281D}
.call.ok{background:#EAF5EC;border:1px solid #BFDDC5}.call.ok .ct{color:#2E6B3C}
.call.info{background:#F3EEE8;border:1px solid #DCCFBF}.call.info .ct{color:#5B4636}
table.t{width:100%;border-collapse:collapse;font-size:9.4pt;margin:1mm 0 4mm}
table.t th{background:#3B2A20;color:#fff;text-align:left;padding:2.2mm 2.5mm;font-weight:600}
table.t td{padding:2mm 2.5mm;border-bottom:1px solid #e6dccf;vertical-align:top}
table.t tr:nth-child(even) td{background:#FBF7F2}
table.t tr{break-inside:avoid}
.cover{height:262mm;display:flex}
.cv{flex:1;background:#F4EBDF;border-radius:10mm;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20mm}
.cv .rule{width:60mm;border-top:1px solid #C8A27A;margin:8mm 0}
.ct1{border:0;font-size:30pt;margin:6mm 0 3mm;padding:0}
.cv .sub{font-size:13pt;color:#5B4636;line-height:1.6}
.cv .line{width:55mm;border-top:2px solid #E08A12;margin:14mm 0}
.cv .meta{font-size:9.5pt;color:#6d5d4f;line-height:1.7}
.path{display:grid;grid-template-columns:repeat(4,1fr);gap:9mm 7mm;margin:5mm 0 3mm}
.pb{position:relative;border:1.5px solid #3B2A20;border-radius:6px;padding:3mm;min-height:27mm;background:#fff}
.pb.ctl{background:#FFF3DC;border-color:#E08A12}
.pb .pn{position:absolute;top:1.5mm;right:2.5mm;color:#B88A5A;font-weight:700;font-size:8.5pt}
.pb .pt{font-family:Caladea,'DejaVu Serif',serif;font-weight:700;font-size:11pt;margin-bottom:1.5mm;padding-right:7mm}
.pb .pd{font-size:8.6pt;color:#6d5d4f;line-height:1.35}
.pb .pa{position:absolute;right:-6mm;top:40%;color:#E08A12;font-weight:700;font-size:13pt}
.legend{font-size:8.8pt;color:#5B4636;display:flex;gap:3mm;align-items:center}
.lg{display:inline-block;width:5mm;height:3.5mm;border:1.5px solid #3B2A20;border-radius:2px;background:#fff}.lg.ctl{background:#FFF3DC;border-color:#E08A12;margin-left:4mm}
.toc .tr{display:flex;align-items:baseline;gap:3mm;padding:2mm 0;border-bottom:1px dotted #d9ccbb;font-size:10.8pt}
.toc .tn{width:7mm;color:#E08A12;font-weight:700}
.toc .tt{flex:1}
.toc .tw{color:#8a7a6a;font-size:8.8pt}
.toc .tpg{width:9mm;text-align:right;font-weight:700;color:#3B2A20}
.memos{display:grid;grid-template-columns:1fr 1fr;gap:6mm;margin:3mm 0 5mm}
.memo{border:1px solid #d8c8b4;border-radius:8px;padding:4mm;break-inside:avoid}
.memo .mt{font-family:Caladea,'DejaVu Serif',serif;font-weight:700;font-size:13pt;color:#3B2A20;margin-bottom:2.5mm}
.memo .mi{display:flex;gap:2.5mm;margin-bottom:2mm;font-size:9.6pt;line-height:1.35}
.memo .cb{flex:0 0 auto;width:3.8mm;height:3.8mm;border:1.4px solid #3B2A20;border-radius:1mm;margin-top:.6mm}
`;

async function render(tocPages, file) {
  fs.writeFileSync(path.join(DIR, 'manual.html'), html(tocPages));
  const b = await chromium.launch(), p = await b.newPage();
  await p.goto('file://' + path.join(DIR, 'manual.html'), { waitUntil: 'load' });
  await p.pdf({ path: file, format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<div></div>',
    footerTemplate: '<div style="width:100%;font-size:7.5pt;color:#8a7a6a;padding:0 15mm;display:flex;justify-content:space-between;font-family:Arial"><span>ЦЕХ — инструкция для персонала · ' + DATE + '</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
    margin: { top: '16mm', bottom: '17mm', left: '15mm', right: '15mm' } });
  await b.close();
}
/** Снимки в JPEG (PDF в несколько раз меньше); длинные — ещё и частями с небольшим перекрытием. PNG — источник. */
function toJpeg() {
  for (const f of fs.readdirSync(path.join(DIR, 'shots')).filter((x) => x.endsWith('.png'))) {
    const png = path.join(DIR, 'shots', f), base = png.replace(/\.png$/, ''), name = f.replace(/\.png$/, '');
    if (fs.existsSync(base + '.jpg') && fs.statSync(base + '.jpg').mtimeMs >= fs.statSync(png).mtimeMs) continue;
    execSync(`convert "${png}" -background white -flatten -quality 84 "${base}.jpg"`);
    const { w, h } = imgSize(name);
    if (h / w <= SPLIT) continue;
    const k = Math.ceil(h / w / PIECE), step = Math.ceil(h / k);
    for (let i = 0; i < k; i++) {
      const y = Math.max(0, i * step - OVERLAP), hh = Math.min(h, (i + 1) * step) - y;
      execSync(`convert "${png}" -crop ${w}x${hh}+0+${y} +repage -background white -flatten -quality 84 "${base}-${i + 1}.jpg"`);
    }
  }
}
toJpeg();
// печатные формы (forms.mjs): PNG страниц → JPEG с серой рамкой
for (const f of fs.existsSync(path.join(DIR, 'forms')) ? fs.readdirSync(path.join(DIR, 'forms')).filter((x) => x.endsWith('.png')) : []) {
  const png = path.join(DIR, 'forms', f), jpg = png.replace(/\.png$/, '.jpg');
  if (!fs.existsSync(jpg) || fs.statSync(jpg).mtimeMs < fs.statSync(png).mtimeMs) execSync(`convert "${png}" -background white -flatten -quality 82 "${jpg}"`);
}
const tmp = path.join(DIR, 'pass1.pdf');
await render(null, tmp);
const pages = Number(/Pages:\s+(\d+)/.exec(execSync(`pdfinfo "${tmp}"`).toString())[1]);
const text = []; for (let i = 1; i <= pages; i++) text[i] = execSync(`pdftotext -f ${i} -l ${i} -layout "${tmp}" -`).toString().replace(/\s+/g, ' ');
const tocPage = text.findIndex((t) => t && /Содержание/.test(t));
const find = (n, title) => { const key = (n + '. ' + title).slice(0, 22); for (let i = tocPage + 1; i <= pages; i++) if (text[i].includes(key)) return i; return ''; };
const tp = {};
SECTIONS.forEach((s) => { tp[s.n] = find(s.n, s.title); });
tp[NT] = find(NT, 'Если что-то пошло не так'); tp[NR] = find(NR, 'Правила честных записей');
for (let i = tocPage + 1; i <= pages; i++) if (/Памятка на смену/.test(text[i]) && /Начало смены/.test(text[i])) { tp['—'] = i; break; }
tp['П'] = find('П', 'Печатные формы');
fs.unlinkSync(tmp);
await render(tp, OUT);
const missingToc = Object.entries(tp).filter(([, v]) => !v).map(([k]) => k);
console.log('страниц', pages, '→', OUT, missingToc.length ? `!! нет страницы в содержании: ${missingToc}` : '');
