// Мост ЦЕХ ↔ УТМ ЕГАИС: ключ моста, отправка вскрытий, квитанции, входящие ТТН. УТМ — имитация по HTTP.
// Запуск: node replica/tests/bridge_test.js (на PostgreSQL — через cloud/test/run-all.js)
const assert = require('assert'), http = require('http'), path = require('path');
const { ctx: G } = require('./harness.js');
const { createBridge, parseTicket, render } = require('../../bridge/utm-bridge.js');
let failures = 0;
async function step(name, fn) { try { await fn(); console.log('OK   ', name); } catch (e) { failures++; console.log('FAIL ', name, '—', e && e.message); } }
function api(a, d, t) { const r = G.processOperation(a, d || {}, t); if (!r.ok) throw new Error(a + ': ' + r.error); return r.data; }

G.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', 'SS');
G.initializeDatabase();
G.insertRow_('ORGANIZATIONS', { organization_id: 'ORG-1', название: 'Бар', статус: 'активна' });
G.insertRow_('LOCATIONS', { location_id: 'LOC-1', organization_id: 'ORG-1', название: 'Точка', статус: 'активна' });
function mk(id, role, pin) { G.insertRow_('USERS', { user_id: id, organization_id: 'ORG-1', location_ids: 'LOC-1', имя: role, роль: role, статус: 'активен', pin_hash: G.hashPin_(pin, 's' + id), pin_salt: 's' + id, failed_attempts: 0, lockout_count: 0 }); }
mk('USR-D', 'ДИРЕКТОР', '739164'); mk('USR-K', 'КАССИР', '284617'); mk('USR-S', 'КЛАДОВЩИК', '846275');
function login(u, p) { const d = api('LOGIN', { userId: u, pin: p }); return d.requires_location ? (api('SELECT_LOCATION', { locationId: 'LOC-1' }, d.token).token || d.token) : d.token; }
const tD = login('USR-D', '739164'), tK = login('USR-K', '284617'), tS = login('USR-S', '846275');
const today = G.todayDateStr_();
const prod = (n, price) => { const p = api('CREATE_PRODUCT', { название: n, единица: 'л', цена: price }, tD); return p.product_id || p.product.product_id; };
const vodka = prod('Водка «Мороз & Солнце»', 600), beer = prod('Пиво разливное', 180);
api('ALCO_SAVE_PRODUCT', { productId: vodka, категория: 'крепкий', объём_тары_л: 0.5, крепость: 40, код_вида: '200', алкокод: '0300123456789012345' }, tD);
api('ALCO_SAVE_PRODUCT', { productId: beer, категория: 'пиво_разлив', объём_тары_л: 30, крепость: 4.5, код_вида: '261' }, tD);
api('RECEIVE_GOODS', { productId: vodka, qty: 1.5, price: 600, expiryDate: '2099-01-01', productionDate: today }, tD);
api('RECEIVE_GOODS', { productId: beer, qty: 30, price: 180, expiryDate: '2099-01-01', productionDate: today }, tD);
const batches = api('ALCO_GET_BATCHES', {}, tD);
const m68 = (i, tail) => ('22N' + String(i).padStart(5, '0')).padEnd(68, tail || 'A');
api('ALCO_RECEIVE_MARKS', { batchId: batches.find(b => /Водка/.test(b.название)).batch_id, marks: [m68(1), m68(2), m68(3, 'B')] }, tD);
const keg = '0104607012345678215Ab3Cd9\u001d93XyZ1';
api('ALCO_RECEIVE_MARKS', { batchId: batches.find(b => /Пиво/.test(b.название)).batch_id, marks: [keg] }, tD);
[m68(1), m68(2), m68(3, 'B'), keg].forEach(m => api('ALCO_OPEN', { mark: m }, tK));

// ---- Имитация УТМ ----
const utm = { received: [], out: new Map(), seq: 0, deleted: [] };
function utmOutAdd(type, xml, replyId) { const id = ++utm.seq; utm.out.set('/opt/out/' + type + '/' + id, { xml, replyId }); }
const ticketXml = (replyId, verdict, comment) => `<?xml version="1.0"?><ns:Documents xmlns:ns="http://fsrar.ru/WEGAIS/WB_DOC_SINGLE_01" xmlns:tc="http://fsrar.ru/WEGAIS/Ticket"><ns:Document><ns:Ticket>
  <tc:TransportId>${replyId}</tc:TransportId><tc:RegID>TTN-REG-${replyId.slice(0, 6)}</tc:RegID><tc:DocType>ActWriteOffShop_v2</tc:DocType>
  ${verdict === 'transport' ? '<tc:Result><tc:Conclusion>Accepted</tc:Conclusion><tc:Comments>Документ принят УТМ</tc:Comments></tc:Result>'
    : `<tc:OperationResult><tc:OperationName>Confirm</tc:OperationName><tc:OperationResult>${verdict}</tc:OperationResult><tc:OperationComment>${comment}</tc:OperationComment></tc:OperationResult>`}
</ns:Ticket></ns:Document></ns:Documents>`;
utmOutAdd('WayBill_v4', `<?xml version="1.0"?><ns:Documents xmlns:ns="x" xmlns:wb="y" xmlns:oref="z" xmlns:pref="p"><ns:Document><ns:WayBill_v4><wb:Header><wb:NUMBER>ТТН-777</wb:NUMBER><wb:Date>${today}</wb:Date>
  <wb:Shipper><oref:UL><oref:ShortName>ООО «Алко &amp; Ко»</oref:ShortName></oref:UL></wb:Shipper></wb:Header><wb:Content>
  <wb:Position><wb:Product><pref:FullName>Водка «Мороз»</pref:FullName><pref:AlcCode>0300123456789012345</pref:AlcCode></wb:Product><wb:Quantity>6</wb:Quantity><wb:Price>300.00</wb:Price></wb:Position>
  <wb:Position><wb:Product><pref:FullName>Коньяк</pref:FullName><pref:AlcCode>0300999</pref:AlcCode></wb:Product><wb:Quantity>2</wb:Quantity><wb:Price>1200.00</wb:Price></wb:Position>
</wb:Content></ns:WayBill_v4></ns:Document></ns:Documents>`, '');
utmOutAdd('FORM2REGINFO', '<x/>', ''); // чужой тип — мост не трогает
const server = http.createServer((req, res) => {
  const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const base = 'http://127.0.0.1:' + server.address().port;
    if (req.method === 'POST' && req.url === '/opt/in/ActWriteOffShop_v2') {
      const xml = body.slice(body.indexOf('<?xml'), body.indexOf('</ns:Documents>') + 15);
      if (!/name="xml_file"/.test(body) || !xml.startsWith('<?xml')) { res.writeHead(400); return res.end('<A><error>Нет файла xml_file</error></A>'); }
      const replyId = 'r' + (utm.received.length + 1) + '-0a1b2c3d';
      utm.received.push(xml);
      utmOutAdd('Ticket', ticketXml(replyId, 'transport'), replyId);
      if (/AAAA<\/ce:amc>/.test(xml)) utmOutAdd('Ticket', ticketXml(replyId, 'Accepted', 'Документ успешно зарегистрирован'), replyId);
      else utmOutAdd('Ticket', ticketXml(replyId, 'Rejected', 'Марка не числится на регистре 2'), replyId);
      res.writeHead(200); return res.end(`<?xml version="1.0"?><A><url>${replyId}</url><sign>x</sign><ver>2</ver></A>`);
    }
    if (req.method === 'GET' && req.url === '/opt/out') {
      res.writeHead(200);
      return res.end('<?xml version="1.0"?><A>' + [...utm.out.entries()].map(([u, v]) => `<url${v.replyId ? ` replyId="${v.replyId}"` : ''}>${base}${u}</url>`).join('') + '<ver>2</ver></A>');
    }
    if (utm.out.has(req.url)) {
      if (req.method === 'DELETE') { utm.out.delete(req.url); utm.deleted.push(req.url); res.writeHead(200); return res.end(); }
      res.writeHead(200); return res.end(utm.out.get(req.url).xml);
    }
    res.writeHead(404); res.end();
  });
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  let key;
  await step('ключ моста: кладовщику нельзя; директор получает ключ; новый ключ отзывает прежний', () => {
    assert(/Недостаточно прав/.test(G.processOperation('ALCO_BRIDGE_CREATE', {}, tS).error));
    const first = api('ALCO_BRIDGE_CREATE', { название: 'Касса-ПК' }, tD).key;
    key = api('ALCO_BRIDGE_CREATE', { название: 'Касса-ПК' }, tD).key;
    assert(/^tsb\.ALCB-[0-9A-F]+\.[0-9a-f]{64}$/.test(key));
    assert(/недействителен или отозван/.test(G.processOperation('ALCO_BRIDGE', { bridgeKey: first, op: 'pull' }).error));
    assert(/недействителен/.test(G.processOperation('ALCO_BRIDGE', { bridgeKey: key.slice(0, -1) + '0', op: 'pull' }).error));
    assert(!JSON.stringify(G.findRows_('ALCO_BRIDGES', () => true)).includes(key.split('.')[2]), 'секрет ключа не хранится');
  });
  await step('ключ моста не открывает обычные команды ЦЕХ', () => {
    assert.equal(G.processOperation('ALCO_GET_OUTBOX', { bridgeKey: key }, null).ok, false);
    assert.equal(G.processOperation('ALCO_BRIDGE', { bridgeKey: key, op: 'delete_all' }).ok, false);
  });
  const bridge = createBridge({ bridgeKey: key, fsrarId: '030000123456', utmUrl: 'http://127.0.0.1:' + port, log: () => {},
    tsekhCall: async data => G.processOperation('ALCO_BRIDGE', data, null) });
  let r;
  await step('обмен: 3 вскрытия ЕГАИС ушли в УТМ (кега — нет), XML с ФСРАР ИД, алкокодом, маркой, экранированием', async () => {
    r = await bridge.syncOnce();
    assert.equal(r.отправлено, 3);
    assert.equal(utm.received.length, 3);
    const x = utm.received[0];
    assert(x.includes('<ns:FSRAR_ID>030000123456</ns:FSRAR_ID>') && x.includes('<pref:AlcCode>0300123456789012345</pref:AlcCode>') && x.includes('<ce:amc>' + m68(1) + '</ce:amc>'));
    assert(x.includes('Водка «Мороз &amp; Солнце»') && x.includes('<awr:TypeWriteOff>Реализация</awr:TypeWriteOff>') && x.includes('<pref:Capacity>0.5000</pref:Capacity>'));
  });
  await step('квитанции: принятые → «отправлено» с номером; отклонённая → «ошибка» с причиной; транспортные не считаются итогом', () => {
    assert.equal(r.квитанций, 3);
    const docs = api('ALCO_GET_OUTBOX', { статус: 'все' }, tD).filter(d => d.система === 'ЕГАИС');
    const ok = docs.filter(d => d.статус === 'отправлено'), bad = docs.filter(d => d.статус === 'ошибка');
    assert.equal(ok.length, 2); assert(/^TTN-REG-/.test(ok[0].номер_квитанции));
    assert.equal(bad.length, 1); assert.equal(bad[0].ошибка, 'ЕГАИС отклонила: Марка не числится на регистре 2');
    assert(G.findRows_('NOTIFICATIONS', n => /ЕГАИС отклонила документов: 1/.test(n.сообщение)).length === 1);
    const kegDoc = api('ALCO_GET_OUTBOX', {}, tD).find(d => d.система === 'ЧЗ');
    assert.equal(kegDoc.статус, 'к_отправке', 'кега ждёт ручной отметки в «Честном знаке»');
  });
  await step('входящая ТТН: в ЦЕХ со сводкой и позициями; чужие документы УТМ не тронуты; прочитанное удалено', () => {
    assert.equal(r.накладных, 1);
    const inbox = api('ALCO_GET_INBOX', {}, tD);
    assert.deepEqual([inbox[0].номер, inbox[0].поставщик, inbox[0].позиций, inbox[0].позиции[1].цена], ['ТТН-777', 'ООО «Алко & Ко»', 2, 1200]);
    assert([...utm.out.keys()].some(u => /FORM2REGINFO/.test(u)));
    assert.equal(utm.deleted.length, 7); // 6 квитанций + ТТН
  });
  await step('повторный обмен ничего не дублирует', async () => {
    const again = await bridge.syncOnce();
    assert.deepEqual(again, { отправлено: 0, ошибок: 0, квитанций: 0, накладных: 0 });
    assert.equal(api('ALCO_GET_INBOX', {}, tD).length, 1);
  });
  await step('сводка раздела видит ошибку ЕГАИС до повтора', () => {
    const ov = api('ALCO_GET_OVERVIEW', {}, tD);
    assert.deepEqual([ov.ошибок, ov.в_утм, ov.к_отправке], [1, 0, 1]);
  });
  await step('ошибка → «Повторить» → снова к отправке; повторить можно только ошибочный', () => {
    const bad = api('ALCO_GET_OUTBOX', {}, tD).find(d => d.статус === 'ошибка');
    assert.equal(api('ALCO_RETRY', { docId: bad.doc_id }, tD).статус, 'к_отправке');
    const sent = api('ALCO_GET_OUTBOX', { статус: 'отправлено' }, tD)[0];
    assert(/только документ с ошибкой/.test(G.processOperation('ALCO_RETRY', { docId: sent.doc_id }, tD).error));
  });
  await step('УТМ выключен: документы остаются в очереди, обмен сообщает понятную причину', async () => {
    const down = createBridge({ bridgeKey: key, fsrarId: '030000123456', utmUrl: 'http://127.0.0.1:1', log: () => {}, tsekhCall: async data => G.processOperation('ALCO_BRIDGE', data, null) });
    await assert.rejects(down.syncOnce(), /УТМ недоступен/);
    assert.equal(api('ALCO_GET_OUTBOX', {}, tD).filter(d => d.статус === 'к_отправке' && d.система === 'ЕГАИС').length, 1);
  });
  await step('обзор: мост на связи, ошибок нет после повтора', () => {
    const ov = api('ALCO_GET_OVERVIEW', {}, tD);
    assert(ov.мост && ov.мост.последний_контакт && ov.мост.название === 'Касса-ПК'); assert.equal(ov.ошибок, 0);
  });
  await step('разбор квитанций и шаблон: вложенный OperationResult, неизвестная метка — ошибка', () => {
    const t = parseTicket(ticketXml('abc', 'Rejected', 'Нет &amp; остатка'), '');
    assert.deepEqual([t.final, t.accepted, t.comment, t.replyId], [true, false, 'Нет & остатка', 'abc']);
    assert.equal(parseTicket(ticketXml('abc', 'transport'), '').final, false);
    assert.throws(() => render('<a>{{UNKNOWN}}</a>', {}), /неизвестная метка/);
  });
  await step('самопроверка видит листы и действия моста', () => {
    assert.deepEqual(G.runPosTests_().filter(x => x.status !== 'OK' && /ALCO_BRIDGE|ALCO_INBOX|ALCO_RETRY/.test(x.name)), []);
  });
  server.close();
  console.log(failures ? '\n' + failures + ' FAILED' : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
})();
