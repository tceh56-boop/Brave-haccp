// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
// Демо гостевого меню MON CHEF REELS: настоящая страница GuestMenu.html + ответы сервера, снятые со стенда (демо-блюда, фото,
// цены, КБЖУ, аллергены, STOP). Один HTML-файл, открывается без интернета и без Google. Данные вымышленные.
// Запуск: node monchef/tools/build_menu_demo.js  →  monchef/dist/MonChef_Гостевое_меню_демо.html
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const { boot } = require('./gasemu');

const DISHES = [
  // код, название, категория, цех, выход, ед., цена ₽, за что, описание, состав, КБЖУ, аллергены, фото [[фон, тарелка, акцент]]
  ['D101', 'Тартар из говядины', 'Закуски', 'Холодный цех', 180, 'г', 790, 'порц.', 'Рубленая вырезка, каперсы, желток, тост из бриоши', ['Говядина вырезка', 'Каперсы', 'Желток', 'Бриошь', 'Лук шалот'], [420, 28, 26, 14], ['яйцо', 'глютен'], [['#2b0d0d', '#8e2a24', '#f2c14e'], ['#1d1410', '#a3392e', '#e8e1c9']]],
  ['D102', 'Сырная тарелка', 'Закуски', 'Холодный цех', 250, 'г', 890, 'порц.', 'Пармезан, бри, дор блю, мёд и грецкий орех', ['Сыр пармезан', 'Сыр бри', 'Сыр дор блю', 'Мёд', 'Грецкий орех'], [612, 38, 41, 18], ['молоко', 'орехи'], [['#2a1d0c', '#e9c46a', '#8a5a2b']]],
  ['D103', 'Бурата с томатами', 'Закуски', 'Холодный цех', 230, 'г', 850, 'порц.', 'Бурата, томаты черри, базилик, оливковое масло', ['Бурата', 'Томаты черри', 'Базилик', 'Масло оливковое'], [380, 17, 31, 9], ['молоко'], [['#10220f', '#f4f1e6', '#d6402e']]],
  ['D201', 'Салат с тунцом', 'Салаты', 'Холодный цех', 220, 'г', 790, 'порц.', 'Тунец татаки, микс салатов, яйцо пашот, соус понзу', ['Тунец', 'Микс салатов', 'Яйцо', 'Соус понзу', 'Кунжут'], [310, 27, 18, 8], ['рыба', 'яйцо', 'кунжут', 'соя'], [['#0f1d20', '#6fae5a', '#c0392b']]],
  ['D202', 'Цезарь с курицей', 'Салаты', 'Холодный цех', 250, 'г', 690, 'порц.', 'Романо, курица гриль, пармезан, крутоны, соус цезарь', ['Салат романо', 'Филе куриное', 'Сыр пармезан', 'Крутоны', 'Соус цезарь'], null, ['молоко', 'глютен', 'яйцо', 'рыба'], [['#1a1f0e', '#9cc069', '#e9c46a']]],
  ['D301', 'Стейк рибай', 'Горячее', 'Горячий цех', 300, 'г', 1500, '100 г', 'Мраморная говядина, зерновой откорм. Вес по факту — официант уточнит после взвешивания', ['Говядина рибай', 'Соль морская', 'Перец', 'Масло сливочное', 'Розмарин'], [870, 72, 64, 0], ['молоко'], [['#1a0d08', '#7b3b22', '#d9a441'], ['#120a06', '#5e2a17', '#f0d58c']]],
  ['D302', 'Утиная грудка', 'Горячее', 'Горячий цех', 280, 'г', 1290, 'порц.', 'Утиная грудка су-вид, пюре из батата, вишнёвый соус', ['Утиная грудка', 'Батат', 'Вишня', 'Масло сливочное', 'Тимьян'], [640, 39, 38, 32], ['молоко'], [['#1d0b10', '#9b2d3b', '#f29e4c']]],
  ['D303', 'Паста с морепродуктами', 'Горячее', 'Горячий цех', 320, 'г', 1090, 'порц.', 'Лингвини, креветки, мидии, кальмар, томатный соус', ['Лингвини', 'Креветки', 'Мидии', 'Кальмар', 'Томаты', 'Чеснок'], [590, 34, 17, 74], ['глютен', 'ракообразные', 'моллюски'], [['#0d1621', '#e07a3f', '#f4d35e']]],
  ['D401', 'Шоколадный фондан', 'Десерты', 'Кондитерский цех', 150, 'г', 590, 'порц.', 'Тёплый фондан с жидким центром и ванильным мороженым', ['Шоколад тёмный', 'Масло сливочное', 'Яйцо', 'Сахар', 'Мука', 'Мороженое ванильное'], [520, 8, 33, 49], ['молоко', 'яйцо', 'глютен'], [['#140b07', '#4a2516', '#f3efe0']]],
  ['D402', 'Чизкейк Нью-Йорк', 'Десерты', 'Кондитерский цех', 140, 'г', 490, 'порц.', 'Сливочный чизкейк, ягодный соус', ['Сыр сливочный', 'Печенье', 'Сахар', 'Яйцо', 'Ягоды'], [470, 9, 31, 39], ['молоко', 'яйцо', 'глютен'], [['#1b1012', '#f2e6c9', '#b3202f']]],
  ['B101', 'Негрони', 'Коктейли', 'Бар', 120, 'мл', 700, 'порц.', 'Классика: джин, кампари, красный вермут, апельсин', ['Джин', 'Кампари', 'Вермут красный', 'Апельсин'], null, [], [['#120406', '#e2492f', '#f6a531'], ['#0e0506', '#b0201f', '#ffd7a0']]],
  ['B102', 'Дайкири', 'Коктейли', 'Бар', 85, 'мл', 650, 'порц.', 'Ром, сок лайма, сахарный сироп. Шейк, подача в охлаждённом купе', ['Ром белый', 'Сок лайма', 'Сироп сахарный'], null, [], [['#06140f', '#d9f2c4', '#7dbb4b']]],
  ['B201', 'Капучино', 'Кофе', 'Бар', 250, 'мл', 290, 'порц.', 'Эспрессо и молочная пена', ['Кофе зерновой', 'Молоко'], [120, 6, 6, 9], ['молоко'], [['#160d07', '#c49a6c', '#f5ecdf']]]
];
const STOP = 'D303';   // «сейчас нет» — как при STOP на кухне

async function photo(browser, c) {
  const [bg, plate, acc] = c, p = await browser.newPage({ viewport: { width: 540, height: 960 } });
  await p.setContent(`<body style="margin:0"><div style="position:relative;width:540px;height:960px;overflow:hidden;background:radial-gradient(120% 80% at 50% 30%, ${bg}cc, ${bg} 60%, #000)">
    <div style="position:absolute;left:50%;top:44%;width:440px;height:440px;margin:-220px 0 0 -220px;border-radius:50%;background:radial-gradient(circle,#fbf8f2 0 55%,#e9e3d8 56% 63%,#fffdf9 64% 70%,rgba(0,0,0,.35) 71%,transparent 74%)"></div>
    <div style="position:absolute;left:50%;top:44%;width:250px;height:250px;margin:-125px 0 0 -125px;border-radius:46% 54% 48% 52%;background:radial-gradient(circle at 40% 35%, ${acc}, ${plate} 55%, ${plate}dd);box-shadow:0 18px 40px rgba(0,0,0,.35)"></div>
    ${[0, 1, 2, 3, 4, 5].map(i => { const a = i * 1.05, r = 150; return `<div style="position:absolute;left:${270 + Math.cos(a) * r - 9}px;top:${422 + Math.sin(a) * r - 9}px;width:18px;height:18px;border-radius:50%;background:${i % 2 ? acc : plate};opacity:.85"></div>`; }).join('')}
    <div style="position:absolute;right:16px;top:16px;font:600 13px -apple-system,Arial;color:#fff;opacity:.55;letter-spacing:.08em">ДЕМО-ФОТО</div></div>`);
  const b = await p.screenshot({ type: 'jpeg', quality: 72 }); await p.close(); return b;
}

(async () => {
  const browser = await chromium.launch();
  const E = boot({ now: '2026-11-25T08:00:00Z' }), C = E.ctx, ss = E.ss, files = {}, folders = {}; let n = 0;
  const mk = name => { const id = 'F' + (++n), f = { kids: {} };
    f.api = { getId: () => id, createFolder: x => { const k = mk(x); f.kids[x] = k; return k.api; }, getFoldersByName: x => { let u = false; return { hasNext: () => !u && !!f.kids[x], next: () => { u = true; return f.kids[x].api; } }; },
      createFile: b => { const id2 = 'FILE' + (++n); files[id2] = { bytes: Buffer.from(b.getBytes().map(v => (v < 0 ? v + 256 : v))), mime: b.getContentType() }; return { getId: () => id2 }; } };
    folders[id] = f; return f; };
  C.DriveApp = { createFolder: x => mk(x).api, getFolderById: id => folders[id].api,
    getFileById: id => ({ getBlob: () => ({ getBytes: () => Array.from(files[id].bytes), getContentType: () => files[id].mime }), setTrashed: () => {} }) };
  E.props[C.MC_MED_GATE_PROP_] = 'off';
  const emp = ss.insertSheet('Сотрудники');
  emp.appendRow(['Фамилия', 'Имя', 'Отчество', 'Должность', 'Роль', 'ДР', 'Телефон', 'Адрес', 'ПИН-код', '', '', '', 'Активен']);
  emp.appendRow(['Демо', 'Директор', '', 'Директор', 'Директор', '', '', '', '1111', '', '', '', true]);
  const ds = ss.insertSheet('Блюда'); ds.appendRow(['Код', 'Название', 'Категория', 'Выход', '', '', '', '', 'Цех', '', '', '', 'Выход, г/мл/шт', 'Ед. выхода']);
  const so = ss.insertSheet('Состав'); so.appendRow(['Код', 'Продукт', '', '', 'Брутто', 'Нетто', 'Выход', 'Ед.']);
  const pr = ss.insertSheet('Цены_Меню'); pr.appendRow(['PriceID', 'DishCode', 'DishName', 'Price', 'Unit', 'Source', 'EventID', 'DateFrom', 'DateTo', 'Status']);
  const tv = ss.insertSheet('ТТК_Версии'); tv.appendRow(['Код блюда', 'Версия', 'Статус']);
  DISHES.forEach((d, i) => {
    ds.appendRow([d[0], d[1], d[2], d[4], '', '', '', '', d[3], '', '', '', d[4], d[5]]);
    d[9].forEach(x => so.appendRow([d[0], x, '', '', 50, 50, 50, 'г']));
    pr.appendRow(['P' + i, d[0], '', d[6], d[7], 'MENU', '', '2026-11-01', '', 'ACTIVE']); tv.appendRow([d[0], 1, 'действующая']);
  });
  const by = {}; DISHES.forEach(d => { by[d[0]] = d; });
  C.calculateKBZHU = c => JSON.stringify(by[c] && by[c][10] ? { perPortion: { kcal: by[c][10][0], protein: by[c][10][1], fat: by[c][10][2], carbs: by[c][10][3] }, hasMissingData: false } : { hasMissingData: true });
  C._alDishAllergens_ = (idx, c) => (by[c] ? { allergens: by[c][11].map(name => ({ name })), complete: true } : null);
  const J = s => JSON.parse(s), DIR = J(C.loginWithPin('1111', 'dev-demo')).token; let k = 0; const key = () => 'demo-key-' + (++k);
  const ok = r => { r = J(r); if (!r.success) throw new Error(JSON.stringify(r).slice(0, 300)); return r.data; };
  for (const d of DISHES) for (const c of d[12]) {
    const bytes = await photo(browser, c);
    const st = ok(C.rsMediaUploadStart(JSON.stringify({ code: d[0], name: d[0] + '.jpg', mime: 'image/jpeg', size: bytes.length }), DIR));
    for (let i = 0; i < st.parts; i++) ok(C.rsMediaUploadPart(JSON.stringify({ uploadId: st.uploadId, index: i, data: bytes.slice(i * st.chunk, (i + 1) * st.chunk).toString('base64') }), DIR));
    ok(C.rsMediaUploadFinish(JSON.stringify({ idem: key(), uploadId: st.uploadId }), DIR));
  }
  DISHES.forEach((d, i) => ok(C.rsMenuSave(JSON.stringify({ idem: key(), code: d[0], description: d[8], order: i, action: 'publish' }), DIR)));
  ok(C.rsStopSet(JSON.stringify({ idem: key(), code: STOP, dept: 'KITCHEN', status: 'STOP', reason: 'Закончилось сырьё', affected: 'KEEP' }), DIR));
  const hall = ok(C.rsHallSave(JSON.stringify({ idem: key(), name: 'Зал', width: 6, height: 4 }), DIR));
  ok(C.rsTableSave(JSON.stringify({ idem: key(), hallId: hall.id, number: '7', x: 1, y: 1, seatsMax: 4 }), DIR));
  ok(C.rsMenuSettings(JSON.stringify({ idem: key(), guestOrder: true, title: 'MON CHEF' }), DIR));
  const qr = ok(C.rsHallData('{}', DIR)).tables[0].qr;
  // ответы сервера для гостя: меню со стола (заявка официанту) и общее (только просмотр), все медиа по частям
  const rec = { table: J(C.rsPublicMenu(JSON.stringify({ t: qr }))), view: J(C.rsPublicMenu('{}')), media: {} };
  if (!rec.table.success || !rec.view.success) throw new Error('меню: ' + JSON.stringify(rec.table).slice(0, 300));
  rec.table.data.dishes.forEach(x => x.media.forEach(m => {
    const parts = []; let p = 0, r;
    do { r = J(C.rsPublicMedia(JSON.stringify({ id: m.id, part: p }))); if (!r.success) throw new Error('медиа ' + m.id); parts.push(r); p++; } while (r.data && r.data.parts && p < r.data.parts);
    rec.media[m.id] = parts;
  }));
  const page = C.doGet({ parameter: { menu: '1' } }).getContent();
  const mock = `<script>/* ДЕМО: вместо сервера — записанные ответы (данные вымышленные). Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович. */
(function(){var REC=${JSON.stringify(rec).replace(/</g, '\\u003c')},QR=${JSON.stringify(qr)};
var view=/[?&]view=1/.test(location.search);
function answer(fn,d){if(fn==='rsPublicMenu')return d.t?REC.table:REC.view;
 if(fn==='rsPublicMedia'){var p=REC.media[d.id];return p?p[d.part||0]:{success:false,error:{message:'Файл недоступен'}};}
 if(fn==='rsGuestRequest')return {success:true,data:{id:'DEMO',status:'NEW',message:'Демо: заявка «отправлена» официанту стола 7. В настоящей системе официант увидит её в «Зале».'}};
 return {success:false,error:{message:'Демо: нет ответа для '+fn}};}
var run=function(st){return new Proxy({},{get:function(_,k){
 if(k==='withSuccessHandler')return function(f){return run(Object.assign({},st,{ok:f}));};
 if(k==='withFailureHandler')return function(f){return run(Object.assign({},st,{fail:f}));};
 if(k==='withUserObject')return function(){return run(st);};
 return function(a){var d={};try{d=JSON.parse(a||'{}');}catch(e){}var r=answer(k,d);setTimeout(function(){st.ok&&st.ok(JSON.stringify(r));},k==='rsPublicMedia'?60:250);};}});};
window.google={script:{run:run({}),url:{getLocation:function(cb){cb({parameter:view?{}:{t:QR}});}}}};
document.addEventListener('DOMContentLoaded',function(){var b=document.createElement('div');b.textContent=(view?'Демо · общее меню (просмотр)':'Демо · меню со стола 7 (заявка официанту)')+' · данные вымышленные';
 b.style.cssText='position:fixed;left:50%;bottom:6px;transform:translateX(-50%);z-index:99999;background:rgba(0,0,0,.55);color:#fff;font:12px -apple-system,Arial;padding:4px 10px;border-radius:10px;pointer-events:none;white-space:nowrap;transition:opacity .6s';document.body.appendChild(b);setTimeout(function(){b.style.opacity='0';},5000);});})();</script>`;
  const html = page.replace(/<head>/i, '<head>' + mock);
  const out = path.join(__dirname, '..', 'dist', 'MonChef_Гостевое_меню_демо.html');
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, html);
  await browser.close();
  console.log('демо:', out, Math.round(html.length / 1024) + ' КБ; блюд ' + rec.table.data.dishes.length + ', медиа ' + Object.keys(rec.media).length);
})().catch(e => { console.error('✗', e.stack || e); process.exit(1); });
