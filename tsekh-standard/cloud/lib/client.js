'use strict';
/**
 * google.script.run / google.script.url / google.script.host для страниц, открытых с нашего сервера.
 * Вызов функции сервера — POST <адрес>/rpc; обработчики успеха и ошибки — как в Apps Script (асинхронно).
 * Формы (<form> в аргументе) превращаются в объект полей, файлы — в Blob на сервере.
 */
function clientShim(rpcUrl, params) {
  const p = JSON.stringify(params || {}).replace(/</g, '\\u003c');
  return `<script>(function () {
  var RPC = ${JSON.stringify(rpcUrl)}, PARAMS = ${p};
  function readForm(form) {
    var out = {}, files = [];
    Array.prototype.forEach.call(form.elements || [], function (el) {
      if (!el.name || el.disabled) return;
      if (el.type === 'file') { Array.prototype.forEach.call(el.files || [], function (f) { files.push([el.name, f]); }); return; }
      if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) return;
      if (el.tagName === 'SELECT' && el.multiple) { out[el.name] = Array.prototype.filter.call(el.options, function (o) { return o.selected; }).map(function (o) { return o.value; }); return; }
      if (out[el.name] !== undefined) { out[el.name] = [].concat(out[el.name], el.value); } else out[el.name] = el.value;
    });
    return Promise.all(files.map(function (pair) {
      return new Promise(function (res) { var r = new FileReader(); r.onload = function () { out[pair[0]] = { __blob: { name: pair[1].name, type: pair[1].type, data: String(r.result).split(',')[1] || '' } }; res(); }; r.readAsDataURL(pair[1]); });
    })).then(function () { return out; });
  }
  function prep(args) {
    return Promise.all(args.map(function (a) { return a && a.tagName === 'FORM' ? readForm(a) : a; }));
  }
  function call(st, name, args) {
    prep(args).then(function (a) {
      return fetch(RPC, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fn: name, args: a }) });
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok) { if (st.ok) st.ok(j.value, st.uo); }
      else { var e = new Error((j && j.error && j.error.message) || 'Ошибка сервера'); e.name = (j && j.error && j.error.name) || 'ScriptError'; if (st.fail) st.fail(e, st.uo); else console.error(e); }
    }, function (err) {
      var e = new Error('NetworkError: Connection failure due to HTTP 0'); e.name = 'NetworkError';
      if (st.fail) st.fail(e, st.uo); else console.error(err);
    });
  }
  function runner(st) {
    return new Proxy({}, { get: function (t, k) {
      if (k === 'withSuccessHandler') return function (f) { return runner(Object.assign({}, st, { ok: f })); };
      if (k === 'withFailureHandler') return function (f) { return runner(Object.assign({}, st, { fail: f })); };
      if (k === 'withUserObject') return function (o) { return runner(Object.assign({}, st, { uo: o })); };
      if (typeof k !== 'string' || k === 'then') return undefined;
      return function () { call(st, k, Array.prototype.slice.call(arguments)); };
    } });
  }
  window.google = window.google || {};
  window.google.script = {
    run: runner({}),
    url: { getLocation: function (cb) { var q = {}, qs = {}; new URLSearchParams(location.search).forEach(function (v, k) { (q[k] === undefined) && (q[k] = v); (qs[k] = qs[k] || []).push(v); }); cb({ parameter: q, parameters: qs, hash: location.hash.replace(/^#/, '') }); } },
    host: { close: function () { window.close(); }, setHeight: function () {}, setWidth: function () {}, origin: location.origin, editor: { focus: function () {} } },
    history: { push: function (s, p, h) { var u = new URL(location.href); u.search = new URLSearchParams(p || {}).toString(); if (h) u.hash = h; history.pushState(s, '', u); },
      replace: function (s, p, h) { var u = new URL(location.href); u.search = new URLSearchParams(p || {}).toString(); if (h) u.hash = h; history.replaceState(s, '', u); }, setChangeHandler: function (f) { window.addEventListener('popstate', function (e) { f({ state: e.state, location: { parameter: Object.fromEntries(new URLSearchParams(location.search)) } }); }); } }
  };
  window.__TS_CLOUD__ = { params: PARAMS };
})();</script>`;
}

module.exports = { clientShim };
