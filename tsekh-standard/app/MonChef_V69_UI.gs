/**
 * ЦЕХ Стандарт V69 — разделы и кнопки главного окна для «Итоговой структуры…»: раздел «Экономика» (V64),
 * переходы к экранам ППК (HACCP), ТУ и лаборатории (Лаборатория), отчётов §20 (Отчёты), реквизитов организации (Настройки).
 * Только показывает данные модулей; права — по картам MC_RB_SECTIONS_ / MC_RB_MODULES_ (шлюз проверяет каждый вызов).
 */
if (UI_SECTIONS.indexOf('finance') < 0) UI_SECTIONS.push('finance');

_UI_BUILDERS_.finance = function (token, opts, s) {
  var d = _uiJ_(v64GetDashboard(token, opts && opts.from, opts && opts.to)), x = d && d.totals ? d : (d && d.data ? d.data : {});   // _uiJ_ уже снимает обёртку {success,data}
  var t = x.totals || {}, fmt = function (v) { return v === null || v === undefined ? '—' : v; };
  return {
    title: 'Экономика', subtitle: 'Экономика потока V64: себестоимость по партиям FEFO, выручка, валовой вклад. ' + (x.from ? x.from + ' — ' + x.to + '.' : '') + ' Управленческие показатели, бухгалтерский учёт не заменяют.',
    kpis: [{ label: 'Выручка, ₽', value: fmt(t.revenue) }, { label: 'Себестоимость реализации, ₽', value: fmt(t.cogsWithPackaging) },
      { label: 'Валовой вклад, ₽', value: fmt(t.grossContribution), tone: t.grossContribution < 0 ? 'red' : 'green' }, { label: 'Маржинальность, %', value: fmt(t.marginPct) },
      { label: 'Потери (брак, списание, дефрост), ₽', value: _v64R2_((t.wasteCost || 0) + (t.defrostLoss || 0) + (t.returnsCost || 0)), tone: t.wasteCost ? 'gold' : '' },
      { label: 'Без цены закупки / продажи', value: (t.missingPrice || 0) + ' / ' + (t.missingSalePrice || 0), tone: (t.missingPrice || t.missingSalePrice) ? 'red' : 'green' },
      { label: 'Неполная прослеживаемость', value: (t.review || 0) + (t.missingEvidence || 0), tone: (t.review || t.missingEvidence) ? 'gold' : 'green' }],
    tabs: [
      { title: 'Блюда', columns: [_uiCol_('key', 'Блюдо'), _uiCol_('qty', 'Продано', 'num'), _uiCol_('revenue', 'Выручка, ₽', 'num'), _uiCol_('cost', 'Себестоимость, ₽', 'num'), _uiCol_('gross', 'Валовой вклад, ₽', 'num'), _uiCol_('marginPct', 'Маржа, %', 'num'), _uiCol_('waste', 'Потери, ₽', 'num')], rows: x.dishes || [] },
      { title: 'Банкеты', columns: [_uiCol_('key', 'Банкет'), _uiCol_('revenue', 'Выручка, ₽', 'num'), _uiCol_('cost', 'Себестоимость, ₽', 'num'), _uiCol_('gross', 'Валовой вклад, ₽', 'num'), _uiCol_('marginPct', 'Маржа, %', 'num'), _uiCol_('waste', 'Потери, ₽', 'num')], rows: x.banquets || [] },
      { title: 'Цеха', columns: [_uiCol_('key', 'Цех'), _uiCol_('revenue', 'Выручка, ₽', 'num'), _uiCol_('cost', 'Себестоимость, ₽', 'num'), _uiCol_('gross', 'Валовой вклад, ₽', 'num'), _uiCol_('marginPct', 'Маржа, %', 'num')], rows: x.workshops || [] },
      { title: 'Проблемные записи', columns: [_uiCol_('date', 'Дата'), _uiCol_('stageRu', 'Этап'), _uiCol_('product', 'Продукт'), _uiCol_('batch', 'Партия'), _uiCol_('amount', 'Сумма, ₽', 'num'), _uiCol_('trace', 'Статус', 'status'), _uiCol_('flagsText', 'Признаки')],
        rows: (x.problems || []).map(function (l) { l.flagsText = (l.flagsRu || []).join(', '); return l; }) },
      { title: 'Закрытые периоды', columns: [_uiCol_('id', 'Период'), _uiCol_('from', 'С'), _uiCol_('to', 'По'), _uiCol_('revenue', 'Выручка, ₽', 'num'), _uiCol_('gross', 'Валовой вклад, ₽', 'num'), _uiCol_('closedBy', 'Закрыл')], rows: x.periods || [] }
    ],
    actions: [{ label: 'Экономика: расчёты, цены, расходы, закрытие периода', module: 'finance' }, { label: 'Отчёты §20', module: 'reports20' }]
  };
};

(function () {
  var add = function (sec, extra) {
    var orig = _UI_BUILDERS_[sec]; if (typeof orig !== 'function') return;
    _UI_BUILDERS_[sec] = function (token, opts, s) { var r = orig(token, opts, s) || {}; r.actions = (r.actions || []).concat(extra); return r; };
  };
  add('haccp', [{ label: 'ППК: версии, разделы, график', module: 'ppk' }, { label: 'Нормативы: база на Google Диске', module: 'normbase' }]);
  add('lab', [{ label: 'Лаборатория: план, отбор, протоколы, решения', module: 'labx' }, { label: 'Технические условия (ТУ)', module: 'tu' }]);
  add('reports', [{ label: 'Отчёты: экономика, ППК, ТУ, лаборатория', module: 'reports20' }]);
  add('settings', [{ label: 'Организация: реквизиты и логотип', module: 'org' }, { label: 'Нормативы: база на Google Диске', module: 'normbase' }]);
})();

// прямой адрес экрана (?finance=1, ?ppk=1, …) открывает экран главного окна
try { MC_UI_VIEWS_ = MC_UI_VIEWS_.concat(['finance', 'ppk', 'tu', 'labx', 'org', 'reports20', 'normbase'].filter(function (v) { return MC_UI_VIEWS_.indexOf(v) < 0; })); } catch (e) {}
