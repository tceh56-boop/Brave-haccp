/**
 * San.Lab — FinanceService.gs
 * Управленческий учёт (раздел 9 ТЗ): начисление, счёт, поступление, расход, корректировка — разные события.
 * Баланс считается по операциям, вручную не вводится. Исправление — только корректировкой.
 */

var Finance = {
  ops: function () { return filterBy(Store.all('Finance'), function (f) { return f.record_status !== 'ARCHIVED'; }); },

  invoiceState: function (inv, ops) {
    ops = ops || Finance.ops();
    var paid = 0, adj = 0;
    for (var i = 0; i < ops.length; i++) {
      var o = ops[i];
      if (o.invoice_id !== inv.finance_id) continue;
      if (o.operation_type === 'PAYMENT') paid += Number(o.amount) || 0;
      if (o.operation_type === 'ADJUSTMENT' && o.payment_status === 'APPROVED') adj += Number(o.amount) || 0;
    }
    var total = Math.round((Number(inv.amount) + adj) * 100) / 100;
    var outstanding = Math.round((total - paid) * 100) / 100;
    var status = outstanding <= 0 ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID';
    return { total: total, paid: Math.round(paid * 100) / 100, outstanding: Math.max(0, outstanding), status: status };
  },

  recalcInvoice: function (ctx, invoiceId) {
    var inv = Repo.must('Finance', invoiceId, 'Счёт');
    var st = Finance.invoiceState(inv);
    if (st.status !== inv.payment_status) Repo.update(ctx, 'Finance', inv.finance_id, { payment_status: st.status }, { action: 'INVOICE_STATUS' });
    return st;
  },

  base: function (p, type) {
    var d = {
      operation_type: type, client_id: V.str(p.client_id), contract_id: V.str(p.contract_id), site_id: V.str(p.site_id),
      visit_id: V.str(p.visit_id), service_id: V.str(p.service_id), amount: V.num(p.amount, 'Сумма', { positive: type !== 'ADJUSTMENT' }),
      operation_date: V.date(p.operation_date || new Date().toISOString(), 'Дата операции'), basis: V.str(p.basis)
    };
    if (d.client_id) Repo.must('Clients', d.client_id, 'Клиент');
    if (d.contract_id) { var c = Repo.must('Contracts', d.contract_id, 'Договор'); if (d.client_id && c.client_id !== d.client_id) fail('VALIDATION', 'Договор другого клиента'); }
    return d;
  },

  accrue: function (ctx, p) {
    var d = Finance.base(p, 'ACCRUAL');
    V.required(d, ['client_id', 'basis'], { client_id: 'Клиент', basis: 'Основание' });
    if (d.visit_id) {
      var v = Repo.must('Visits', d.visit_id, 'Выезд');
      if (v.client_id !== d.client_id) fail('VALIDATION', 'Выезд относится к другому клиенту');
      d.site_id = d.site_id || v.site_id; d.service_id = d.service_id || v.service_id;
    }
    /* Защита от дублирующего начисления */
    var dup = filterBy(Finance.ops(), function (f) {
      if (f.operation_type !== 'ACCRUAL') return false;
      if (d.visit_id) return f.visit_id === d.visit_id && f.service_id === d.service_id;
      return f.client_id === d.client_id && f.contract_id === d.contract_id && f.service_id === d.service_id &&
        String(f.operation_date).slice(0, 7) === String(d.operation_date).slice(0, 7) && Number(f.amount) === d.amount;
    });
    if (dup.length && !(p.force && !d.visit_id)) fail('DUPLICATE', 'Похожее начисление уже есть: ' + dup[0].finance_id + ' (' + fmtMoney(dup[0].amount) + ', ' + fmtD(dup[0].operation_date) + ')', { finance_id: dup[0].finance_id });
    d.payment_status = 'POSTED';
    return Repo.create(ctx, 'Finance', d, { action: 'FIN_ACCRUAL' });
  },

  nextInvoiceNo: function (now) {
    var year = String(now).slice(0, 4), prefix = Settings.get('INVOICE_PREFIX') || 'СЧ';
    var n = Store.nextSeq('INV' + year);
    var s = String(n); while (s.length < 4) s = '0' + s;
    return prefix + '-' + year + '-' + s;
  },

  invoice: function (ctx, p) {
    var d = Finance.base(p, 'INVOICE');
    V.required(d, ['client_id'], { client_id: 'Клиент' });
    d.due_date = V.date(p.due_date, 'Срок оплаты');
    if (isBefore(d.due_date, d.operation_date)) fail('VALIDATION', 'Срок оплаты раньше даты счёта');
    var no = V.str(p.invoice_no) || Finance.nextInvoiceNo(ctx.now);
    if (Repo.where('Finance', function (f) { return f.operation_type === 'INVOICE' && f.invoice_no === no; }).length) fail('DUPLICATE', 'Счёт с номером ' + no + ' уже существует');
    d.invoice_no = no; d.payment_status = 'UNPAID'; d.basis = d.basis || 'Счёт ' + no;
    return Repo.create(ctx, 'Finance', d, { action: 'FIN_INVOICE' });
  },

  /* AT-11: частичная оплата, несколько платежей, остаток рассчитывается */
  payment: function (ctx, p) {
    var d = Finance.base(p, 'PAYMENT');
    if (p.invoice_id) {
      var inv = Repo.must('Finance', p.invoice_id, 'Счёт');
      if (inv.operation_type !== 'INVOICE') fail('VALIDATION', 'Связать оплату можно только со счётом');
      d.client_id = inv.client_id; d.contract_id = d.contract_id || inv.contract_id; d.invoice_id = inv.finance_id; d.invoice_no = inv.invoice_no;
      var st = Finance.invoiceState(inv);
      if (d.amount > st.outstanding + 0.001) fail('VALIDATION', 'Сумма больше остатка по счёту (' + fmtMoney(st.outstanding) + '). Переплату оформите отдельной операцией.');
    }
    V.required(d, ['client_id'], { client_id: 'Клиент' });
    d.basis = d.basis || (d.invoice_no ? 'Оплата по счёту ' + d.invoice_no : 'Поступление');
    d.payment_status = 'POSTED';
    var res = Repo.create(ctx, 'Finance', d, { action: 'FIN_PAYMENT' });
    var state = d.invoice_id ? Finance.recalcInvoice(ctx, d.invoice_id) : null;
    return { operation: res, invoice_state: state };
  },

  expense: function (ctx, p) {
    var d = Finance.base(p, 'EXPENSE');
    d.category = V.str(p.category);
    V.required(d, ['category', 'basis'], { category: 'Категория', basis: 'Основание' });
    if (EXPENSE_CATEGORIES.indexOf(d.category) < 0) fail('VALIDATION', 'Неизвестная категория расхода');
    d.payment_status = 'POSTED';
    return Repo.create(ctx, 'Finance', d, { action: 'FIN_EXPENSE' });
  },

  adjust: function (ctx, p) {
    var d = Finance.base(p, 'ADJUSTMENT');
    V.required(d, ['basis'], { basis: 'Основание корректировки' });
    if (d.amount === 0) fail('VALIDATION', 'Сумма корректировки не может быть нулевой');
    if (p.invoice_id) {
      var inv = Repo.must('Finance', p.invoice_id, 'Счёт');
      d.invoice_id = inv.finance_id; d.invoice_no = inv.invoice_no; d.client_id = inv.client_id;
    }
    V.required(d, ['client_id'], { client_id: 'Клиент' });
    d.payment_status = 'PENDING';
    var res = Repo.create(ctx, 'Finance', d, { action: 'FIN_ADJUST_REQUEST' });
    Notify.toRole(ctx, 'OWNER', 'FIN_ADJUST', 'Finance', res.finance_id, 'Корректировка на утверждение', fmtMoney(d.amount) + ': ' + d.basis, 'adj:' + res.finance_id);
    return res;
  },

  approveAdjustment: function (ctx, p) {
    var a = Repo.must('Finance', p.finance_id, 'Корректировка');
    if (a.operation_type !== 'ADJUSTMENT') fail('VALIDATION', 'Это не корректировка');
    if (a.payment_status !== 'PENDING') return { operation: a, already: true };
    if (a.created_by === ctx.actorId && Settings.bool('INDEPENDENT_REVIEW')) {
      var owners = filterBy(Store.all('Employees'), function (e) { return e.role === 'OWNER' && V.bool(e.active) && e.employee_id !== ctx.actorId; });
      if (owners.length) denied('Корректировку утверждает другой руководитель');
    }
    var approve = p.approve !== false && p.approve !== 'false';
    var res = Repo.update(ctx, 'Finance', a.finance_id, { payment_status: approve ? 'APPROVED' : 'REJECTED', approved_by: ctx.actorId, approved_at: ctx.now }, { action: approve ? 'FIN_ADJUST_APPROVE' : 'FIN_ADJUST_REJECT' });
    if (a.invoice_id) Finance.recalcInvoice(ctx, a.invoice_id);
    return { operation: res };
  },

  list: function (ctx, p) {
    var ops = Finance.ops();
    var clients = indexBy(Store.all('Clients'), 'client_id');
    var services = indexBy(Store.all('Services'), 'service_id');
    var emps = indexBy(Store.all('Employees'), 'employee_id');
    var q = normText(p.q);
    var rows = filterBy(ops, function (f) {
      if (p.operation_type && f.operation_type !== p.operation_type) return false;
      if (p.client_id && f.client_id !== p.client_id) return false;
      if (p.from && isBefore(f.operation_date, p.from)) return false;
      if (p.to && !isBefore(f.operation_date, p.to)) return false;
      return true;
    }).map(function (f) {
      var o = stripSecrets(f);
      o.type_label = FIN_TYPES[f.operation_type];
      o.client_name = clients[f.client_id] ? clients[f.client_id].legal_name : '';
      o.service_name = services[f.service_id] ? services[f.service_id].name : '';
      o.created_by_name = emps[f.created_by] ? emps[f.created_by].full_name : '';
      if (f.operation_type === 'INVOICE') {
        var st = Finance.invoiceState(f, ops);
        o.paid = st.paid; o.outstanding = st.outstanding; o.total = st.total; o.payment_status = st.status;
        o.overdue = st.outstanding > 0 && f.due_date && isBefore(f.due_date, ctx.now);
      }
      o.status_label = STATUS.payment[o.payment_status] || '';
      return o;
    });
    if (q) rows = filterBy(rows, function (f) { return normText(f.finance_id + ' ' + f.client_name + ' ' + f.invoice_no + ' ' + f.basis + ' ' + f.category).indexOf(q) >= 0; });
    if (p.overdue) rows = filterBy(rows, function (f) { return f.overdue; });
    if (p.unpaid) rows = filterBy(rows, function (f) { return f.operation_type === 'INVOICE' && f.outstanding > 0; });
    return { total: rows.length, rows: sortBy(rows, 'operation_date', true) };
  },

  debtByClient: function () {
    var ops = Finance.ops(), m = {};
    ops.forEach(function (f) {
      if (f.operation_type !== 'INVOICE') return;
      m[f.client_id] = Math.round(((m[f.client_id] || 0) + Finance.invoiceState(f, ops).outstanding) * 100) / 100;
    });
    return m;
  },

  clientCard: function (clientId) {
    var ops = filterBy(Finance.ops(), function (f) { return f.client_id === clientId; });
    var all = Finance.ops();
    var inv = ops.filter(function (f) { return f.operation_type === 'INVOICE'; });
    return {
      accrued: sumBy(ops.filter(function (f) { return f.operation_type === 'ACCRUAL'; }), 'amount'),
      invoiced: sumBy(inv, 'amount'),
      paid: sumBy(ops.filter(function (f) { return f.operation_type === 'PAYMENT'; }), 'amount'),
      debt: inv.reduce(function (s, f) { return s + Finance.invoiceState(f, all).outstanding; }, 0)
    };
  },

  /* Сводка за период. Правила расчёта возвращаются вместе с цифрами (раздел 6 ТЗ). */
  summary: function (ctx, p) {
    var from = p.from || isoAddDays(ctx.now, -30), to = p.to || isoAddDays(ctx.now, 1);
    var ops = Finance.ops();
    var inP = function (f) { return !isBefore(f.operation_date, from) && isBefore(f.operation_date, to); };
    var period = filterBy(ops, inP);
    var by = function (t) { return filterBy(period, function (f) { return f.operation_type === t; }); };
    var accrued = sumBy(by('ACCRUAL'), 'amount'), received = sumBy(by('PAYMENT'), 'amount'), expenses = sumBy(by('EXPENSE'), 'amount');
    var adjApproved = sumBy(filterBy(by('ADJUSTMENT'), function (f) { return f.payment_status === 'APPROVED'; }), 'amount');
    var invoices = filterBy(ops, function (f) { return f.operation_type === 'INVOICE'; });
    var receivable = 0, overdue = [], clients = indexBy(Store.all('Clients'), 'client_id');
    invoices.forEach(function (f) {
      var st = Finance.invoiceState(f, ops);
      receivable += st.outstanding;
      if (st.outstanding > 0 && f.due_date && isBefore(f.due_date, ctx.now)) overdue.push({ finance_id: f.finance_id, invoice_no: f.invoice_no, client_name: clients[f.client_id] ? clients[f.client_id].legal_name : '', due_date: f.due_date, outstanding: st.outstanding, days: Math.floor((new Date(ctx.now) - new Date(f.due_date)) / DAY_MS) });
    });
    var expByCat = {};
    by('EXPENSE').forEach(function (f) { expByCat[f.category] = Math.round(((expByCat[f.category] || 0) + Number(f.amount)) * 100) / 100; });
    var byClient = {};
    period.forEach(function (f) {
      if (!f.client_id) return;
      var c = byClient[f.client_id] = byClient[f.client_id] || { client_id: f.client_id, client_name: clients[f.client_id] ? clients[f.client_id].legal_name : f.client_id, accrued: 0, received: 0 };
      if (f.operation_type === 'ACCRUAL') c.accrued += Number(f.amount);
      if (f.operation_type === 'PAYMENT') c.received += Number(f.amount);
    });
    var debt = Finance.debtByClient();
    var clientRows = Object.keys(byClient).map(function (k) { byClient[k].debt = debt[k] || 0; return byClient[k]; });
    Object.keys(debt).forEach(function (k) { if (!byClient[k] && debt[k] > 0) clientRows.push({ client_id: k, client_name: clients[k] ? clients[k].legal_name : k, accrued: 0, received: 0, debt: debt[k] }); });
    var services = indexBy(Store.all('Services'), 'service_id'), bySrv = {};
    by('ACCRUAL').forEach(function (f) { var n = services[f.service_id] ? services[f.service_id].name : 'Без услуги'; bySrv[n] = Math.round(((bySrv[n] || 0) + Number(f.amount)) * 100) / 100; });
    /* Помесячно за 12 месяцев */
    var months = [], cur = new Date(ctx.now);
    for (var i = 11; i >= 0; i--) {
      var d = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() - i, 1));
      months.push(d.toISOString().slice(0, 7));
    }
    var series = months.map(function (m) {
      var mo = filterBy(ops, function (f) { return String(f.operation_date).slice(0, 7) === m; });
      return { month: m, accrued: sumBy(filterBy(mo, function (f) { return f.operation_type === 'ACCRUAL'; }), 'amount'), received: sumBy(filterBy(mo, function (f) { return f.operation_type === 'PAYMENT'; }), 'amount'), expenses: sumBy(filterBy(mo, function (f) { return f.operation_type === 'EXPENSE'; }), 'amount') };
    });
    var accruedVisits = {}; ops.forEach(function (f) { if (f.operation_type === 'ACCRUAL' && f.visit_id) accruedVisits[f.visit_id] = true; });
    var unbilled = Visits.enrich(filterBy(Store.all('Visits'), function (v) { return (v.status === 'APPROVED' || v.status === 'CLOSED') && !accruedVisits[v.visit_id]; }), ctx)
      .map(function (v) { return { visit_id: v.visit_id, client_id: v.client_id, client_name: v.client_name, site_name: v.site_name, service_id: v.service_id, service_name: v.service_name, price: (services[v.service_id] || {}).price, date: v.actual_end || v.planned_start }; });
    return {
      period: { from: from, to: to }, generated_at: ctx.now,
      accrued: accrued, received: received, expenses: expenses, adjustments: adjApproved,
      profit_cash: Math.round((received - expenses) * 100) / 100,
      receivable: Math.round(receivable * 100) / 100, overdue: sortBy(overdue, 'due_date'),
      overdue_total: sumBy(overdue, 'outstanding'),
      expenses_by_category: expByCat, by_client: sortBy(clientRows, 'debt', true), by_service: bySrv, series: series,
      pending_adjustments: filterBy(ops, function (f) { return f.operation_type === 'ADJUSTMENT' && f.payment_status === 'PENDING'; }).length,
      unbilled_visits: unbilled,
      rules: 'Начислено — сумма операций «Начисление» по дате операции. Поступило — «Поступление». Прибыль (кассовая) = поступления − расходы за период. ' +
        'Дебиторская задолженность = сумма счетов + утверждённые корректировки по ним − оплаты, на дату формирования, без учёта периода. Просрочен — остаток > 0 и срок оплаты прошёл.'
    };
  }
};
