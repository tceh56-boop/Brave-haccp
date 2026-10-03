// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — OcrYandex.gs
 * Раунд 8 — ТЗ §11 (OCR деклараций), по явному указанию Дениса "как в системе Мон Шер"
 * (реальный внешний вызов через UrlFetchApp — тот же паттерн, что уже упомянут как
 * образец в AI.gs докстринге: "Brave HACCP AI.gs через UrlFetchApp к Claude API").
 *
 * ЧЕСТНО, ФЛАГУЮ ЯВНО: у меня в этой сессии нет доступа к исходному коду Мон Шер (это
 * отдельный проект/репозиторий, не часть текущего рабочего каталога ЦЕХ) — поэтому это
 * НЕ копия существующей у Дениса интеграции, а НОВАЯ реализация того же по духу
 * подхода: реальный (не заглушка) вызов Yandex Cloud Vision OCR REST API через
 * UrlFetchApp, требующий РЕАЛЬНЫХ учётных данных, которых у этой сессии нет и не может
 * быть (Script Properties YANDEX_OCR_API_KEY/YANDEX_FOLDER_ID). Если у Мон Шер
 * используется другой эндпоинт/провайдер (например, сама YandexGPT с vision, а не
 * классический Vision OCR) — этот файл нужно будет донастроить под точный API, когда
 * Денис даст либо код Мон Шер, либо просто ключ/папку Яндекс.Облака.
 *
 * Дизайн соответствует ТЗ §11 буквально: результат распознавания НИКОГДА не пишется в
 * DECLARATIONS автоматически — только в OCR_RESULTS со статусом PENDING_REVIEW,
 * оператор явно подтверждает через CONFIRM_OCR_RESULT (ТЗ: "экран ПРОВЕРЬТЕ ДАННЫЕ").
 */

var YANDEX_OCR_ENDPOINT = 'https://vision.api.cloud.yandex.net/vision/v1/batchAnalyze';

function _getYandexOcrCredentials_() {
  var props = PropertiesService.getScriptProperties();
  return { apiKey: props.getProperty('YANDEX_OCR_API_KEY'), folderId: props.getProperty('YANDEX_FOLDER_ID') };
}

/** Рекурсивно собирает весь текст из ответа Vision OCR независимо от точной вложенности (устойчиво к небольшим отличиям схемы ответа). */
function _extractAllText_(node, acc) {
  if (!node) return;
  if (typeof node === 'string') { acc.push(node); return; }
  if (Array.isArray(node)) { node.forEach(function (n) { _extractAllText_(n, acc); }); return; }
  if (typeof node === 'object') {
    if (typeof node.text === 'string') acc.push(node.text);
    if (typeof node.fullText === 'string') acc.push(node.fullText);
    Object.keys(node).forEach(function (k) {
      if (k === 'text' || k === 'fullText') return;
      _extractAllText_(node[k], acc);
    });
  }
}

/** ТЗ §11 — best-effort извлечение реквизитов из распознанного текста. Ничего не додумывает — не найдено значение остаётся пустым. */
function _extractDeclarationFields_(rawText) {
  var text = String(rawText || '');
  var result = {};

  var numMatch = text.match(/(?:№|N|номер)[\s:]*([A-ZА-ЯЁ0-9./\-]{6,})/i);
  if (numMatch) result.registration_number = numMatch[1];

  var dates = text.match(/\d{2}\.\d{2}\.\d{4}/g) || [];
  if (dates[0]) result.issue_date = dates[0];
  if (dates[1]) result.effective_to = dates[1];

  var manufacturerMatch = text.match(/(?:Изготовитель|Производитель)[\s:]*([^\n]{3,80})/i);
  if (manufacturerMatch) result.manufacturer = manufacturerMatch[1].trim();

  var applicantMatch = text.match(/Заявитель[\s:]*([^\n]{3,80})/i);
  if (applicantMatch) result.applicant = applicantMatch[1].trim();

  var regulationMatch = text.match(/ТР\s?ТС\s?\d{3}\/\d{4}|ТР\s?ЕАЭС\s?\d{3}\/\d{4}/i);
  if (regulationMatch) result.technical_regulation = regulationMatch[0];

  return result;
}

/**
 * base64Image — БЕЗ префикса data:...;base64,. Реальный сетевой вызов — требует
 * настоящих кредов, при их отсутствии честно бросает ошибку (тот же принцип, что
 * testIntegrationConnection_ в Integrations.gs — не выдаёт отсутствующую интеграцию
 * за работающую).
 */
function runDeclarationOcr_(declarationId, base64Image, mimeType, organizationId, userId, session) {
  return withLock_(function () {
    // P0.1, найдено при написании тестов раунда 8: declarationId — клиентский ID; без
    // этой проверки чужая организация могла бы привязать свой OCR-запуск к декларации
    // другой организации (сама запись OCR_RESULTS всё равно получила бы organizationId
    // сессии, а не декларации, поэтому прямой утечки чтения не было — но
    // confirmOcrResult_ ниже упал бы на assertOwnedByOrg_ уже ПОСЛЕ ненужной записи в
    // OCR_RESULTS; проверка на входе, а не только на confirm, — тот же принцип, что и
    // везде в проекте: entity ищется по клиентскому ID -> сразу assertOwnedByOrg_).
    if (declarationId && session) {
      var declForOcr = findOne_('DECLARATIONS', 'declaration_id', declarationId);
      if (declForOcr) assertOwnedByOrg_(session, declForOcr, 'DECLARATIONS:' + declarationId);
    }
    var creds = _getYandexOcrCredentials_();
    if (!creds.apiKey || !creds.folderId) {
      // ВНИМАНИЕ (найдено при написании раунда 8 тестов): сообщение НЕ должно начинаться с
      // латинской "OCR" — humanizeError_ (API.gs) маскирует в клиенте ЛЮБУЮ ошибку, не
      // начинающуюся с кириллицы, общим текстом "Не удалось выполнить операцию" — это
      // ровно убило бы честное сообщение "OCR не настроен", которое этот файл обещает в
      // докстринге выше как принцип по образцу testIntegrationConnection_. Поэтому фраза
      // начинается с кириллического слова.
      throw new Error('Распознавание (OCR) не настроено: в Script Properties отсутствуют YANDEX_OCR_API_KEY/YANDEX_FOLDER_ID. Загрузите файл и заполните реквизиты декларации вручную, либо укажите Денису добавить ключ Яндекс.Облака.');
    }
    if (['image/jpeg', 'image/jpg', 'image/png'].indexOf(mimeType) === -1) {
      throw new Error('Распознавание (OCR) поддерживает только JPG/PNG (для PDF — сначала преобразуйте страницу в изображение).');
    }

    var payload = {
      analyze_specs: [{
        content: base64Image,
        features: [{ type: 'TEXT_DETECTION', text_detection_config: { language_codes: ['ru', 'en'] } }]
      }]
    };
    var response = UrlFetchApp.fetch(YANDEX_OCR_ENDPOINT, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Api-Key ' + creds.apiKey, 'x-folder-id': creds.folderId },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var code = response.getResponseCode();
    if (code < 200 || code >= 300) {
      throw new Error('Ошибка OCR (Yandex Vision, код ' + code + '): ' + response.getContentText().slice(0, 300));
    }
    var parsed = JSON.parse(response.getContentText());
    var textChunks = [];
    _extractAllText_(parsed, textChunks);
    var rawText = textChunks.join('\n');
    var extracted = _extractDeclarationFields_(rawText);

    var ocrResult = {
      ocr_id: generateId_('OCR_RESULTS'),
      organization_id: organizationId,
      declaration_id: declarationId || '',
      file_id: '', provider: 'yandex_vision',
      extracted_json: JSON.stringify(extracted),
      raw_text: rawText,
      status: 'PENDING_REVIEW',
      created_at: nowIso_(), created_by: userId || '',
      confirmed_at: '', confirmed_by: ''
    };
    insertRow_('OCR_RESULTS', ocrResult);
    auditLog_(userId, 'Запущен OCR декларации', 'OCR_RESULTS:' + ocrResult.ocr_id, null, declarationId || '', 'success', session ? session.cascade_id : '');
    return ocrResult;
  });
}

/** P0.1, найдено при написании тестов раунда 8 (тот же класс бреши, что и у getDeclarationById_ выше) — session необязателен, но API.gs::GET_OCR_RESULT обязан его передавать. */
function getOcrResult_(ocrId, session) {
  var row = findOne_('OCR_RESULTS', 'ocr_id', ocrId);
  if (!row) return null;
  if (session) assertOwnedByOrg_(session, row, 'OCR_RESULTS:' + ocrId);
  row.extracted = JSON.parse(row.extracted_json || '{}');
  return row;
}

/**
 * ТЗ §11 — "ПРОВЕРЬТЕ ДАННЫЕ": оператор подтверждает (возможно, поправленные на
 * фронтенде) значения. confirmedFields — то, что реально применяется к декларации;
 * может отличаться от extracted_json, если оператор что-то исправил.
 */
function confirmOcrResult_(ocrId, confirmedFields, userId, session) {
  return withLock_(function () {
    var row = findOne_('OCR_RESULTS', 'ocr_id', ocrId);
    if (!row) throw new Error('Результат OCR не найден: ' + ocrId);
    if (session) assertOwnedByOrg_(session, row, 'OCR_RESULTS:' + ocrId);
    if (row.status === 'CONFIRMED') throw new Error('Результат OCR уже подтверждён ранее.');

    updateRow_('OCR_RESULTS', row, { status: 'CONFIRMED', confirmed_at: nowIso_(), confirmed_by: userId || '' });
    auditLog_(userId, 'Результат OCR подтверждён пользователем', 'OCR_RESULTS:' + ocrId, null, JSON.stringify(confirmedFields || {}), 'success', session ? session.cascade_id : '');

    if (row.declaration_id && confirmedFields) {
      return updateDeclaration_(row.declaration_id, confirmedFields, userId, session);
    }
    return getOcrResult_(ocrId);
  });
}

// ============================================================================
// РАУНД: OCR ЭТИКЕТКИ ПРОДУКТА + ПРИВЯЗКА ДАТЫ ПРОИЗВОДСТВА К ПАРТИИ
// ============================================================================

var YANDEX_PRODUCT_OCR_ENDPOINT = 'https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText';

function _getYandexProductOcrCredentials_() {
  var props = PropertiesService.getScriptProperties();
  return {
    apiKey: props.getProperty('YANDEX_OCR_API_KEY'),
    iamToken: props.getProperty('YANDEX_OCR_IAM_TOKEN'),
    folderId: props.getProperty('YANDEX_FOLDER_ID')
  };
}

function _stripDataUrl_(base64Image) {
  var s = String(base64Image || '');
  var m = s.match(/^data:[^;]+;base64,(.*)$/i);
  return m ? m[1] : s;
}

function _extractYandexOcrLines_(response) {
  var out = [];
  var blocks = response && response.result && response.result.textAnnotation && response.result.textAnnotation.blocks;
  if (!Array.isArray(blocks)) return out;
  blocks.forEach(function (block) {
    (block.lines || []).forEach(function (line) {
      var t = String(line.text || '').trim();
      if (t) out.push(t);
    });
  });
  return out;
}

function _ocrNumber_(v) {
  if (v === undefined || v === null || v === '') return '';
  var n = Number(String(v).replace(',', '.').replace(/[^0-9.+-]/g, ''));
  return isNaN(n) ? '' : n;
}

function _extractLabeledValue_(text, labels) {
  var lines = String(text || '').split(/\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    for (var j = 0; j < labels.length; j++) {
      var re = new RegExp('^' + labels[j] + '\\s*[:№-]?\\s*(.+)$', 'i');
      var m = line.match(re);
      if (m) return m[1].trim();
    }
  }
  return '';
}

function _normalizeDate_(raw) {
  if (!raw) return '';
  var s = String(raw).trim().replace(/[\/]/g, '.');
  var m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return '';
  var d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
  if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 2000 || y > 2100) return '';
  return Utilities.formatDate(new Date(Date.UTC(y, mo - 1, d)), 'Etc/UTC', 'yyyy-MM-dd');
}

function _extractDateAfterLabels_(text, labels) {
  var lines = String(text || '').split(/\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    for (var j = 0; j < labels.length; j++) {
      var re = new RegExp(labels[j] + '[^0-9]{0,30}(\\d{1,2}[./]\\d{1,2}[./]\\d{4})', 'i');
      var m = line.match(re);
      if (m) return _normalizeDate_(m[1]);
    }
    if (new RegExp(labels.join('|'), 'i').test(line) && i + 1 < lines.length) {
      var m2 = lines[i + 1].match(/(\d{1,2}[./]\d{1,2}[./]\d{4})/);
      if (m2) return _normalizeDate_(m2[1]);
    }
  }
  return '';
}

function _extractNutritionNumber_(text, labels) {
  var s = String(text || '');
  for (var i = 0; i < labels.length; i++) {
    var m = s.match(new RegExp(labels[i] + '[^0-9]{0,30}(\\d+(?:[.,]\\d+)?)', 'i'));
    if (m) return _ocrNumber_(m[1]);
  }
  return '';
}

function _extractCalories_(text) {
  var s = String(text || '');
  var m = s.match(/(\d+(?:[.,]\d+)?)\s*kcal/i);
  if (m) return _ocrNumber_(m[1]);
  m = s.match(/(\d+(?:[.,]\d+)?)\s*ккал/i);
  return m ? _ocrNumber_(m[1]) : '';
}

function _extractStorageTemperature_(text) {
  var s = String(text || '').replace(/−/g, '-');
  var m = s.match(/не\s*(?:выше|более)\s*(-?\d+(?:[.,]\d+)?)\s*°?\s*[CcСс]/i);
  if (m) return { min: '', max: _ocrNumber_(m[1]) };
  m = s.match(/от\s*(-?\d+(?:[.,]\d+)?)\s*(?:до|—|-)\s*(-?\d+(?:[.,]\d+)?)\s*°?\s*[CcСс]/i);
  if (m) return { min: _ocrNumber_(m[1]), max: _ocrNumber_(m[2]) };
  m = s.match(/(?:температур[аы]?|t\s*=)\s*[:]?\s*(-?\d+(?:[.,]\d+)?)\s*°?\s*[CcСс]/i);
  if (m) return { min: _ocrNumber_(m[1]), max: _ocrNumber_(m[1]) };
  return { min: '', max: '' };
}

function _extractStorageHumidity_(text) {
  var m = String(text || '').match(/(?:влажност[ьи]|relative\s+humidity)[^0-9]{0,20}(\d{1,3})\s*(?:-|до|—)\s*(\d{1,3})\s*%/i);
  if (m) return m[1] + '-' + m[2] + '%';
  m = String(text || '').match(/(?:влажност[ьи]|relative\s+humidity)[^0-9]{0,20}(\d{1,3})\s*%/i);
  return m ? m[1] + '%' : '';
}

function _extractShelfLife_(text) {
  var s = String(text || '').replace(/ё/g, 'е');
  var m = s.match(/(?:срок\s+годности|продукт\s+годен|годен)[^0-9]{0,80}(?:в\s+течение\s+)?(\d+(?:[.,]\d+)?)\s*(дн(?:ей|я)?|сут(?:ок|ки)?|мес(?:яц(?:ев|а)?)?|г(?:од|ода|лет))/i);
  if (!m) m = s.match(/(?:не\s+более|не\s+больше)[^0-9]{0,30}(\d+(?:[.,]\d+)?)\s*(дн(?:ей|я)?|мес(?:яц(?:ев|а)?)?|г(?:од|ода|лет))/i);
  if (!m) return { duration: '', unit: '', raw: '' };
  var unit = /дн|сут/i.test(m[2]) ? 'days' : (/мес/i.test(m[2]) ? 'months' : 'years');
  return { duration: _ocrNumber_(m[1]), unit: unit, raw: m[0].trim() };
}

function _guessStorageModeFromText_(text) {
  var s = String(text || '').toLowerCase();
  if (/заморож|мороз|\-18/.test(s)) return 'FROZEN';
  if (/охлажд|холодиль/.test(s)) return 'CHILLED';
  return 'ROOM';
}

function _extractNetWeight_(text) {
  var s = String(text || '').replace(',', '.');
  var m = s.match(/(?:масса\s+нетто|нетто|net\s*weight|net)\s*[:№-]?\s*(\d+(?:\.\d+)?)\s*(кг|kg|г|g)\b/i);
  if (!m) return '';
  var n = Number(m[1]);
  return /кг|kg/i.test(m[2]) ? n : n / 1000;
}

function _extractBarcode_(text) {
  var s = String(text || '');
  var m = s.match(/(?:штрихкод|barcode|ean)\s*[:№-]?\s*(\d{8,14})/i);
  if (m) return m[1];
  var candidates = s.match(/\b\d{12,14}\b/g) || [];
  return candidates.length === 1 ? candidates[0] : '';
}

function _extractArticle_(text) {
  var m = String(text || '').match(/(?:артикул|article|арт\.?)[\s:№-]*([A-ZА-ЯЁ0-9][A-ZА-ЯЁ0-9._/-]{3,})/i);
  return m ? m[1] : '';
}

function _extractManufacturer_(text) {
  var m = String(text || '').match(/(?:изготовитель|производитель|manufacturer)[\s:№-]*([^\n]{3,120})/i);
  return m ? m[1].trim() : '';
}

function _extractProductNameFromLabel_(lines) {
  var blacklist = /^(?:oren\s+beef|miratorg|matured\s+beef|птица\s+плюс|производитель|изготовитель|состав|пищев|энергет|белк|жир|углев|срок|годен|хранить|масса|нетто|артикул|article|штрихкод|barcode|изготовлен|упакован|заморож|полуфабрикат|субпродукт|россия|russia)$/i;
  var preferred = [];
  lines.forEach(function (line) {
    var s = String(line || '').trim();
    if (!s || s.length < 3 || s.length > 100 || blacklist.test(s)) return;
    if (/^(щековина|лопатка|филе\s+грудки|фланк|стейк|blade|cheek|breast|flank)/i.test(s)) preferred.push(s);
    else if (/[а-яa-z]{3,}/i.test(s) && !/\d{4,}/.test(s)) preferred.push(s);
  });
  return preferred.length ? preferred[0] : (lines[0] || '').trim();
}

function _extractProductTypeFromLabel_(text) {
  var s = String(text || '').toLowerCase();
  if (/субпродукт/.test(s)) return 'субпродукт';
  if (/полуфабрикат/.test(s)) return 'полуфабрикат';
  if (/мясо/.test(s)) return 'мясо';
  return '';
}

function _parseProductLabelText_(rawText) {
  var text = String(rawText || '').replace(/\r/g, '');
  var lines = text.split(/\n/).map(function (x) { return x.trim(); }).filter(Boolean);
  var temp = _extractStorageTemperature_(text);
  var shelf = _extractShelfLife_(text);
  var storageMode = _guessStorageModeFromText_(text);
  var product = {
    name: _extractProductNameFromLabel_(lines),
    product_type: _extractProductTypeFromLabel_(text),
    manufacturer: _extractManufacturer_(text),
    article: _extractArticle_(text),
    barcode: _extractBarcode_(text),
    calories_kcal_100g: _extractCalories_(text),
    protein_g_100g: _extractNutritionNumber_(text, ['белки', 'белок', 'protein']),
    fat_g_100g: _extractNutritionNumber_(text, ['жиры', 'жир', 'fat']),
    carbohydrate_g_100g: _extractNutritionNumber_(text, ['углеводы', 'углевод', 'carbohydrate', 'carbs']),
    fiber_g_100g: _extractNutritionNumber_(text, ['клетчатка', 'fiber']),
    sugar_g_100g: _extractNutritionNumber_(text, ['сахара', 'sugar']),
    storage_temperature_min: temp.min,
    storage_temperature_max: temp.max,
    storage_humidity: _extractStorageHumidity_(text),
    storage_conditions: text.match(/(?:условия\s+хранения|хранить)[^\n]*/i) ? text.match(/(?:условия\s+хранения|хранить)[^\n]*/i)[0].trim() : '',
    shelf_life: shelf.duration,
    shelf_life_unit: shelf.unit,
    shelf_life_raw: shelf.raw,
    storage_mode: storageMode,
    manufactured_date: _extractDateAfterLabels_(text, ['изготовлен', 'дата\s+изготовления', 'произведен', 'упакован']),
    expiration_date: _extractDateAfterLabels_(text, ['годен\s+до', 'срок\s+годности', 'употребить\s+до']),
    net_weight_kg: _extractNetWeight_(text),
    packaging: /вакуум/i.test(text) ? 'вакуум' : '',
    source: 'OCR_LABEL',
    source_type: 'LABEL',
    verified: false,
    raw_text: text
  };
  // На некоторых этикетках дата идёт без словесного маркера: берём только если есть ровно
  // две даты и явных полей не нашли — не пытаемся угадать семантику при трёх и более датах.
  if (!product.manufactured_date || !product.expiration_date) {
    var dates = text.match(/\d{1,2}[./]\d{1,2}[./]\d{4}/g) || [];
    var normalized = dates.map(_normalizeDate_).filter(Boolean);
    if (normalized.length === 2) {
      if (!product.manufactured_date) product.manufactured_date = normalized[0];
      if (!product.expiration_date) product.expiration_date = normalized[1];
    }
  }
  var filled = 0, total = 0;
  ['name','manufacturer','article','barcode','calories_kcal_100g','protein_g_100g','fat_g_100g','storage_temperature_max','shelf_life','manufactured_date','expiration_date','net_weight_kg'].forEach(function (k) { total++; if (product[k] !== '' && product[k] !== null) filled++; });
  product.confidence = Math.round((filled / total) * 100) / 100;
  return product;
}

/** OCR фотографии этикетки. Возвращает preview и кандидатов на дубли; автоматически продукт не создаёт. */
function recognizeProductLabelOcr_(base64Image, mimeType, userId, session) {
  return withLock_(function () {
    var creds = _getYandexProductOcrCredentials_();
    if (!creds.apiKey && !creds.iamToken) throw new Error('Распознавание (OCR) не настроено: укажите YANDEX_OCR_API_KEY или YANDEX_OCR_IAM_TOKEN в Script Properties.');
    if (!creds.folderId) throw new Error('Распознавание (OCR) не настроено: отсутствует YANDEX_FOLDER_ID.');
    if (['image/jpeg','image/jpg','image/png'].indexOf(String(mimeType || '').toLowerCase()) === -1) throw new Error('Распознавание (OCR) поддерживает JPG и PNG.');
    var content = _stripDataUrl_(base64Image);
    if (!content) throw new Error('Изображение для OCR не передано.');
    var headers = { 'x-folder-id': creds.folderId };
    headers.Authorization = creds.iamToken ? ('Bearer ' + creds.iamToken) : ('Api-Key ' + creds.apiKey);
    var response = UrlFetchApp.fetch(YANDEX_PRODUCT_OCR_ENDPOINT, {
      method: 'post', contentType: 'application/json', headers: headers,
      payload: JSON.stringify({ mimeType: mimeType, languageCodes: ['ru','en'], model: 'page', content: content }),
      muteHttpExceptions: true
    });
    var code = response.getResponseCode();
    if (code < 200 || code >= 300) throw new Error('Ошибка OCR этикетки (Yandex Vision, код ' + code + '): ' + response.getContentText().slice(0, 500));
    var parsed = JSON.parse(response.getContentText());
    var lines = _extractYandexOcrLines_(parsed);
    var rawText = lines.join('\n');
    var product = _parseProductLabelText_(rawText);
    var duplicates = product.name && typeof findDuplicateCandidates_ === 'function' ? findDuplicateCandidates_(product.name) : [];
    var result = {
      ocr_id: generateId_('OCR_RESULTS'), organization_id: session ? session.organization_id : '', declaration_id: '', file_id: '',
      provider: 'yandex_vision', extracted_json: JSON.stringify(product), raw_text: rawText, status: duplicates.length ? 'REVIEW_REQUIRED' : 'PENDING_REVIEW',
      created_at: nowIso_(), created_by: userId || '', confirmed_at: '', confirmed_by: ''
    };
    insertRow_('OCR_RESULTS', result);
    auditLog_(userId, 'Распознана этикетка продукта', 'OCR_RESULTS:' + result.ocr_id, null, product.name || '', 'success', session ? session.cascade_id : '');
    return { success: true, status: result.status, ocr_id: result.ocr_id, product: product, duplicate_candidates: duplicates, raw_text: rawText, ocr_provider: 'yandex_vision' };
  });
}

/** После ручной проверки создаёт GLOBAL_PRODUCTS и сохраняет срок хранения. Дата производства здесь не записывается: она принадлежит партии. */
function createGlobalProductFromOcr_(ocrResult, userId, session) {
  return withLock_(function () {
    var p = ocrResult && ocrResult.product ? ocrResult.product : ocrResult;
    if (!p || !p.name) throw new Error('Для создания продукта из OCR не указано название.');
    var candidates = findDuplicateCandidates_(p.name);
    if (candidates.length && !(ocrResult && ocrResult.allowDuplicate === true)) {
      return { status: 'DUPLICATE_REVIEW_REQUIRED', product: p, duplicate_candidates: candidates };
    }
    var global = createGlobalProduct_({
      name: p.name, productType: p.product_type, description: p.manufacturer ? ('Производитель: ' + p.manufacturer) : '',
      externalCodes: { article: p.article || '', barcode: p.barcode || '', manufacturer: p.manufacturer || '' },
      caloriesKcal100g: p.calories_kcal_100g, proteinG100g: p.protein_g_100g, fatG100g: p.fat_g_100g,
      carbohydrateG100g: p.carbohydrate_g_100g, fiberG100g: p.fiber_g_100g, sugarG100g: p.sugar_g_100g,
      storageConditionsText: p.storage_conditions || '', storageTemperatureMin: p.storage_temperature_min,
      storageTemperatureMax: p.storage_temperature_max, storageHumidity: p.storage_humidity || '',
      source: 'OCR_LABEL', sourceType: 'LABEL', verified: false, confidence: p.confidence
    }, userId);
    if (p.shelf_life !== '' && p.shelf_life_unit && typeof setProductShelfLife_ === 'function') {
      setProductShelfLife_(global.global_product_id, p.storage_mode || 'FROZEN', p.shelf_life_raw || '', p.shelf_life, p.shelf_life_unit, 'OCR_LABEL', false, userId);
    }
    return { status: 'CREATED', global_product: global, package_data: { manufactured_date: p.manufactured_date || '', expiration_date: p.expiration_date || '', net_weight_kg: p.net_weight_kg || '', article: p.article || '', barcode: p.barcode || '', manufacturer: p.manufacturer || '' } };
  });
}


/** Полный сценарий: OCR -> глобальный продукт -> номенклатура организации. Цена/поставщик остаются на ручном подтверждении. */
function createOrganizationProductFromOcr_(ocrResult, data, session) {
  return withLock_(function () {
    data = data || {};
    var p = ocrResult && ocrResult.product ? ocrResult.product : ocrResult;
    if (!p || !p.name) throw new Error('Для создания продукта из OCR не указано название.');
    var globalId = data.globalProductId || '';
    var global = globalId ? getGlobalProductById_(globalId) : null;
    if (globalId && !global) throw new Error('Выбранный глобальный продукт не найден: ' + globalId);
    // Сканирование этикетки кладовщиком не должно менять общий GLOBAL_PRODUCTS.
    // По умолчанию создаём только номенклатуру организации. Создание глобальной
    // карточки допускается только явным флагом createGlobal=true из административного
    // сценария каталога.
    if (!global && data.createGlobal === true) {
      var preview = createGlobalProductFromOcr_({ product: p, allowDuplicate: data.allowDuplicate === true }, session.user_id, session);
      if (preview.status !== 'CREATED') return preview;
      global = preview.global_product;
    }
    var unit = data.unit || 'кг';
    var orgProduct = createProduct_({
      organization_id: session.organization_id,
      название: data.name || p.name,
      категория_id: data.categoryId || '',
      единица: unit,
      закупочная_цена: Number(data.price) || 0,
      поставщик_id: data.supplierId || '',
      срок_хранения_дней: p.shelf_life_unit === 'days' ? Number(p.shelf_life) || 0 : 0,
      мин_остаток: Number(data.minStock) || 0,
      штрихкод: p.barcode || '',
      global_product_id: global ? global.global_product_id : '',
      артикул: p.article || '',
      внутреннее_название: data.internalName || '' ,
      userId: session.user_id
    });
    return {
      status: 'CREATED',
      global_product: global,
      organization_product: orgProduct,
      package_data: {
        manufactured_date: p.manufactured_date || '', expiration_date: p.expiration_date || '',
        net_weight_kg: p.net_weight_kg || '', manufacturer: p.manufacturer || '', article: p.article || '', barcode: p.barcode || ''
      }
    };
  });
}

// ============================================================================
// ЭТАП 3 — АВТОМАТИЧЕСКОЕ СОПОСТАВЛЕНИЕ OCR + ШТРИХКОД + НОМЕНКЛАТУРА
// ============================================================================

function _normMatchValue_(value) {
  return normalizeProductName_(String(value || '').trim());
}

function _sameBarcode_(a, b) {
  return String(a || '').replace(/\D/g, '') === String(b || '').replace(/\D/g, '');
}

function _globalExternalCodes_(global) {
  if (!global) return {};
  try {
    var parsed = JSON.parse(global.external_codes_json || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) { return {}; }
}

/**
 * Возвращает безопасное предложение сопоставления для OCR-этикетки.
 * Автоматически выбирается только однозначное сильное совпадение:
 *   1) штрихкод ORGANIZATION PRODUCTS;
 *   2) артикул ORGANIZATION PRODUCTS;
 *   3) точное нормализованное название ORGANIZATION PRODUCTS.
 * Частичные совпадения никогда не выбираются молча — они только показываются оператору.
 */
function matchProductFromLabel_(product, session) {
  if (!session || !session.organization_id) throw new Error('Для сопоставления продукта нужна организация сотрудника.');
  product = product || {};

  var rows = getProducts_(session.organization_id) || [];
  var barcode = String(product.barcode || '').trim();
  var article = _normMatchValue_(product.article);
  var name = _normMatchValue_(product.name);

  var byBarcode = barcode ? rows.filter(function (r) { return _sameBarcode_(r.штрихкод, barcode); }) : [];
  var byArticle = article ? rows.filter(function (r) { return _normMatchValue_(r.артикул) === article; }) : [];
  var byName = name ? rows.filter(function (r) { return _normMatchValue_(r.название) === name || _normMatchValue_(r.внутреннее_название) === name; }) : [];

  var selected = null;
  var method = '';
  var confidence = 0;
  if (byBarcode.length === 1) {
    selected = byBarcode[0]; method = 'BARCODE_EXACT'; confidence = 1;
  } else if (byArticle.length === 1) {
    selected = byArticle[0]; method = 'ARTICLE_EXACT'; confidence = 0.98;
  } else if (byName.length === 1) {
    selected = byName[0]; method = 'NAME_EXACT'; confidence = 0.94;
  }

  var suggestions = [];
  rows.forEach(function (r) {
    if (selected && r.product_id === selected.product_id) return;
    var score = 0, reasons = [];
    if (barcode && _sameBarcode_(r.штрихкод, barcode)) { score += 100; reasons.push('штрихкод'); }
    if (article && _normMatchValue_(r.артикул) === article) { score += 90; reasons.push('артикул'); }
    var rn = _normMatchValue_(r.название);
    var rin = _normMatchValue_(r.внутреннее_название);
    if (name && (rn === name || rin === name)) { score += 80; reasons.push('название'); }
    else if (name && ((rn && (rn.indexOf(name) !== -1 || name.indexOf(rn) !== -1)) || (rin && (rin.indexOf(name) !== -1 || name.indexOf(rin) !== -1)))) { score += 45; reasons.push('похожее название'); }
    if (score > 0) suggestions.push({ product: r, score: score, reasons: reasons });
  });
  suggestions.sort(function (a, b) { return b.score - a.score; });

  // Если сильное поле совпало с несколькими карточками, не выбираем случайную.
  var ambiguous = (byBarcode.length > 1 || byArticle.length > 1 || byName.length > 1);
  if (ambiguous) { selected = null; method = 'AMBIGUOUS'; confidence = 0; }

  // Глобальный справочник — только подсказка, не автоматическое создание/изменение.
  var globalCandidates = [];
  if (typeof getGlobalProducts_ === 'function') {
    var globals = getGlobalProducts_({}) || [];
    globals.forEach(function (g) {
      var ec = _globalExternalCodes_(g);
      var score = 0, reasons = [];
      if (barcode && _sameBarcode_(ec.barcode, barcode)) { score += 100; reasons.push('штрихкод'); }
      if (article && _normMatchValue_(ec.article) === article) { score += 90; reasons.push('артикул'); }
      var gn = _normMatchValue_(g.name);
      if (name && gn === name) { score += 80; reasons.push('название'); }
      else if (name && gn && (gn.indexOf(name) !== -1 || name.indexOf(gn) !== -1)) { score += 45; reasons.push('похожее название'); }
      if (score > 0) globalCandidates.push({ global_product_id: g.global_product_id, name: g.name, score: score, reasons: reasons });
    });
    globalCandidates.sort(function (a, b) { return b.score - a.score; });
  }

  return {
    matched: !!selected,
    match_method: method,
    confidence: confidence,
    organization_product: selected || null,
    suggestions: suggestions.slice(0, 5),
    global_candidates: globalCandidates.slice(0, 5),
    diagnostics: {
      barcode_matches: byBarcode.length,
      article_matches: byArticle.length,
      name_matches: byName.length
    }
  };
}

function matchProductFromLabelApi_(ocrResult, session) {
  var p = ocrResult && ocrResult.product ? ocrResult.product : ocrResult;
  if (!p) throw new Error('Результат OCR не передан.');
  return matchProductFromLabel_(p, session);
}
