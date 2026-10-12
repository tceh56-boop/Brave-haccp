#!/usr/bin/env node
// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * Мост ЦЕХ ↔ УТМ ЕГАИС. Запускается на компьютере, где работает УТМ (Node.js 18+, без зависимостей).
 * Раз в минуту:
 *  1. забирает из ЦЕХ вскрытия тары «к отправке» (ALCO_BRIDGE pull), собирает XML по шаблону и отправляет в УТМ
 *     (POST /opt/in/<тип>), сообщает в ЦЕХ результат (report): «в УТМ» с идентификатором или ошибку;
 *  2. читает исходящие УТМ (/opt/out): квитанции → в ЦЕХ (ticket: принято / отклонено с причиной),
 *     входящие ТТН (WayBill) → в ЦЕХ (inbox), затем удаляет прочитанное из УТМ (если включено).
 * Ключ моста выдаёт директор в ЦЕХ: «Алкоголь» → «Лицензия и карточки» → «Мост к УТМ».
 *
 * Настройки — bridge.config.json рядом с файлом (см. bridge.config.example.json) или переменные окружения:
 *   TSEKH_URL (адрес /api облачной версии или веб-приложения Apps Script), TSEKH_BRIDGE_KEY, UTM_URL (http://localhost:8080),
 *   FSRAR_ID, BRIDGE_INTERVAL_SEC (60), UTM_DELETE_AFTER_READ (1).
 */
const fs = require('fs'), path = require('path');

const xmlEscape = s => String(s == null ? '' : s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

/** Значение первого элемента с данным локальным именем (префикс пространства имён не важен). */
function tag(xml, name) {
  const m = new RegExp('<(?:[\\w-]+:)?' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?' + name + '>').exec(xml);
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';
}
function tags(xml, name) {
  const re = new RegExp('<(?:[\\w-]+:)?' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?' + name + '>', 'g'), out = [];
  let m; while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}
const unescapeXml = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Подстановка {{ИМЯ}} в шаблон XML; значения экранируются. Неизвестная метка — ошибка (лучше не отправить, чем отправить пустое). */
function render(template, values) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => {
    if (!(k in values)) throw new Error('В шаблоне неизвестная метка ' + m);
    return xmlEscape(values[k]);
  });
}

/** Разбор квитанции: итоговая (OperationResult) или транспортная (Result). */
function parseTicket(xml, replyIdAttr) {
  const replyId = replyIdAttr || tag(xml, 'TransportId');
  // В квитанции ЕГАИС <OperationResult> вложен сам в себя: внешний блок и внутренний вердикт Accepted/Rejected.
  const verdict = /<(?:[\w-]+:)?OperationResult>\s*(Accepted|Rejected)\s*</i.exec(xml);
  if (verdict) {
    return { final: true, replyId, accepted: /Accepted/i.test(verdict[1]), comment: unescapeXml(tag(xml, 'OperationComment')), regId: tag(xml, 'RegID') };
  }
  const conclusion = tag(xml, 'Conclusion');
  if (!conclusion) return null;
  const rejected = /Rejected/i.test(conclusion);
  // Транспортное «принято» — ещё не итог ЕГАИС, ждём OperationResult; транспортный отказ — итог.
  return { final: rejected, replyId, accepted: !rejected, comment: unescapeXml(tag(xml, 'Comments')), regId: tag(xml, 'RegID') };
}

/** Сводка входящей ТТН (WayBill_v3/v4). */
function parseWayBill(xml, utmId) {
  const header = tag(xml, 'Header');
  const shipper = tag(header, 'Shipper');
  return {
    utm_id: utmId, тип: 'ТТН', номер: unescapeXml(tag(header, 'NUMBER')), дата: tag(header, 'Date').slice(0, 10),
    поставщик: unescapeXml(tag(shipper, 'ShortName') || tag(shipper, 'FullName')),
    позиции: tags(xml, 'Position').map(p => ({ название: unescapeXml(tag(p, 'FullName')), алкокод: tag(p, 'AlcCode'), количество: Number(tag(p, 'Quantity')) || 0, цена: Number(tag(p, 'Price')) || 0 }))
  };
}

function createBridge(opts) {
  const log = opts.log || ((...a) => console.log(new Date().toISOString(), ...a));
  const utm = String(opts.utmUrl || 'http://localhost:8080').replace(/\/+$/, '');
  const templates = opts.templates || {
    вскрытие_тары: { docType: 'ActWriteOffShop_v2', xml: fs.readFileSync(path.join(__dirname, 'templates', 'ActWriteOffShop_v2.xml'), 'utf8') }
  };
  const done = new Set(opts.processed || []);
  const call = async (op, extra) => {
    const r = await opts.tsekhCall(Object.assign({ bridgeKey: opts.bridgeKey, op }, extra || {}));
    if (!r || !r.ok) throw new Error('ЦЕХ: ' + (r && r.error || 'нет ответа'));
    return r.data;
  };

  async function sendOutbox() {
    const { docs } = await call('pull', { limit: 20 });
    const results = [];
    let unreachable = false;
    for (const d of docs) {
      const t = templates[d.тип];
      if (!t) { results.push({ docId: d.doc_id, ok: false, error: 'нет шаблона для «' + d.тип + '»' }); continue; }
      try {
        if (!opts.fsrarId) throw new Error('не указан FSRAR_ID');
        if (!d.марка) throw new Error('у документа нет марки');
        const xml = render(t.xml, { FSRAR_ID: opts.fsrarId, IDENTITY: d.doc_id, ACT_NUMBER: d.doc_id.replace(/\W/g, '').slice(-20), DATE: d.дата,
          ALCOCODE: d.алкокод, NAME: d.название, CAPACITY: Number(d.ёмкость_л || 0).toFixed(4), ALC_VOLUME: Number(d.крепость || 0).toFixed(3), VCODE: d.код_вида, MARK: d.марка });
        const form = new FormData();
        form.append('xml_file', new Blob([xml], { type: 'application/xml' }), d.doc_id + '.xml');
        const res = await fetch(utm + '/opt/in/' + t.docType, { method: 'POST', body: form });
        const body = await res.text();
        const replyId = tag(body, 'url');
        if (!res.ok || !replyId) throw new Error('УТМ ответил ' + res.status + ': ' + (tag(body, 'error') || body).slice(0, 200));
        results.push({ docId: d.doc_id, ok: true, replyId });
        log('В УТМ:', d.doc_id, '→', replyId);
      } catch (e) {
        // УТМ недоступен (сеть, выключен) — документ остаётся «к отправке», попробуем в следующий раз.
        if (e.cause || /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/.test(e.message)) { log('УТМ недоступен:', e.cause ? e.cause.code || e.cause.message : e.message); unreachable = true; break; }
        results.push({ docId: d.doc_id, ok: false, error: e.message });
        log('Ошибка отправки', d.doc_id, e.message);
      }
    }
    if (results.length) await call('report', { results });
    if (unreachable) throw new Error('УТМ недоступен по адресу ' + utm + ' — документы остались в очереди.');
    return results;
  }

  async function readUtmOut() {
    const res = await fetch(utm + '/opt/out');
    if (!res.ok) throw new Error('УТМ /opt/out ответил ' + res.status);
    const list = await res.text();
    const items = [...list.matchAll(/<url(?:\s+replyId="([^"]*)")?[^>]*>([^<]+)<\/url>/g)].map(m => ({ replyId: m[1] || '', url: unescapeXml(m[2]).trim() }));
    const tickets = [], inbox = [], toDelete = [];
    for (const it of items) {
      if (done.has(it.url)) continue;
      const type = (/\/opt\/out\/([^/]+)\//.exec(it.url) || [])[1] || '';
      if (type !== 'Ticket' && !/^WayBill/.test(type)) continue; // остальное не наше — не трогаем
      const xml = await (await fetch(it.url)).text();
      if (type === 'Ticket') {
        const t = parseTicket(xml, it.replyId);
        if (t && t.final) tickets.push({ replyId: t.replyId, accepted: t.accepted, comment: t.comment, regId: t.regId });
      } else {
        inbox.push(parseWayBill(xml, it.url));
      }
      toDelete.push(it.url);
    }
    if (tickets.length) await call('ticket', { tickets });
    if (inbox.length) await call('inbox', { docs: inbox });
    for (const url of toDelete) {
      done.add(url);
      if (opts.deleteAfterRead !== false) await fetch(url, { method: 'DELETE' }).catch(e => log('Не удалось удалить из УТМ', url, e.message));
    }
    return { tickets: tickets.length, inbox: inbox.length };
  }

  return {
    async syncOnce() {
      const sent = await sendOutbox();
      const read = await readUtmOut();
      return { отправлено: sent.filter(r => r.ok).length, ошибок: sent.filter(r => !r.ok).length, квитанций: read.tickets, накладных: read.inbox };
    },
    processed: () => [...done]
  };
}

function loadConfig() {
  const file = path.join(__dirname, 'bridge.config.json');
  const cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const env = process.env;
  return {
    tsekhUrl: env.TSEKH_URL || cfg.tsekhUrl, bridgeKey: env.TSEKH_BRIDGE_KEY || cfg.bridgeKey, utmUrl: env.UTM_URL || cfg.utmUrl || 'http://localhost:8080',
    fsrarId: env.FSRAR_ID || cfg.fsrarId, intervalSec: Number(env.BRIDGE_INTERVAL_SEC || cfg.intervalSec || 60),
    deleteAfterRead: (env.UTM_DELETE_AFTER_READ || String(cfg.deleteAfterRead !== false ? 1 : 0)) !== '0'
  };
}

async function main() {
  const cfg = loadConfig();
  if (!cfg.tsekhUrl || !cfg.bridgeKey || !cfg.fsrarId) { console.error('Заполните bridge.config.json: tsekhUrl, bridgeKey, fsrarId (см. bridge.config.example.json).'); process.exit(1); }
  const stateFile = path.join(__dirname, 'bridge-state.json');
  const processed = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')).processed || [] : [];
  const bridge = createBridge(Object.assign({}, cfg, { processed, tsekhCall: async data => {
    const r = await fetch(cfg.tsekhUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ALCO_BRIDGE', data }) });
    return r.json();
  } }));
  console.log('Мост ЦЕХ ↔ УТМ запущен: УТМ ' + cfg.utmUrl + ', интервал ' + cfg.intervalSec + ' с.');
  const tick = async () => {
    try { const r = await bridge.syncOnce(); if (r.отправлено || r.ошибок || r.квитанций || r.накладных) console.log(new Date().toISOString(), r); }
    catch (e) { console.error(new Date().toISOString(), 'Сбой обмена:', e.message); }
    fs.writeFileSync(stateFile, JSON.stringify({ processed: bridge.processed().slice(-5000) }));
  };
  await tick();
  setInterval(tick, cfg.intervalSec * 1000);
}

if (require.main === module) main();
module.exports = { createBridge, parseTicket, parseWayBill, render, tag };
