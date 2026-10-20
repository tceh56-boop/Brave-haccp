/**
 * San.Lab — DemoBoot.js
 * Демо-оболочка: то же ядро и тот же интерфейс, что в Apps Script, но хранилище — в браузере (IndexedDB).
 * Фото для демо рисуются на canvas. Вход — выбором роли.
 */
(function () {
  var KEY = 'sanlab-demo-' + APP_VERSION;
  var READ = /\.(list|get|me|mine|queue|summary|preview|html|mode)$/;
  var saveTimer = null;

  function idb() {
    return new Promise(function (res, rej) {
      try {
        var r = indexedDB.open('sanlab_demo', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      } catch (e) { rej(e); }
    });
  }
  function idbGet(k) { return idb().then(function (db) { return new Promise(function (res) { var t = db.transaction('kv').objectStore('kv').get(k); t.onsuccess = function () { res(t.result || null); }; t.onerror = function () { res(null); }; }); }).catch(function () { return null; }); }
  function idbPut(k, v) { return idb().then(function (db) { return new Promise(function (res) { var tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = function () { res(true); }; tx.onerror = function () { res(false); }; }); }).catch(function () { return false; }); }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { idbPut(KEY, JSON.stringify({ day: localDayKey(new Date().toISOString()), store: Store.dump(), integr: Integr.dump() })); }, 600);
  }

  /* Демо-фото: условная кухня — стальные поверхности, полки, подпись пункта и время */
  Integr.demoPhoto = function (label, i) {
    var c = document.createElement('canvas'); c.width = 480; c.height = 360;
    var g = c.getContext('2d'), r = Seed.rng(i * 7919 + 13);
    var hue = [205, 30, 140, 15, 190][i % 5];
    var bg = g.createLinearGradient(0, 0, 480, 360);
    bg.addColorStop(0, 'hsl(' + hue + ',18%,' + (68 + r() * 10) + '%)'); bg.addColorStop(1, 'hsl(' + hue + ',14%,' + (38 + r() * 10) + '%)');
    g.fillStyle = bg; g.fillRect(0, 0, 480, 360);
    for (var k = 0; k < 3; k++) { g.fillStyle = 'rgba(235,240,245,' + (0.55 + r() * 0.3) + ')'; var y = 70 + k * 85 + r() * 10; g.fillRect(20, y, 440, 10); }
    for (var j = 0; j < 9; j++) {
      g.fillStyle = 'hsl(' + Math.floor(r() * 360) + ',' + (25 + r() * 35) + '%,' + (45 + r() * 25) + '%)';
      var row = Math.floor(r() * 3), x = 30 + r() * 380, w = 30 + r() * 45, h = 30 + r() * 40;
      g.fillRect(x, 70 + row * 85 - h, w, h);
    }
    g.fillStyle = 'rgba(10,25,50,.72)'; g.fillRect(0, 300, 480, 60);
    g.fillStyle = '#fff'; g.font = '600 15px Arial'; g.fillText(String(label).slice(0, 52), 14, 324);
    g.font = '12px Arial'; g.fillStyle = '#cfe0ff'; g.fillText('San.Lab · демо-фото · IMG_' + (4000 + i), 14, 346);
    return c.toDataURL('image/jpeg', 0.72).split(',')[1];
  };

  var ROLE_HINT = {
    OWNER: 'Полный доступ: панель, финансы, настройки, аудит',
    COORDINATOR: 'Клиенты, расписание, назначение выездов',
    SPECIALIST: 'Мобильный кабинет: выезды, чек-лист, фото, пробы',
    QC: 'Очередь отчётов, возврат и утверждение',
    FINANCE: 'Начисления, счета, оплаты, задолженность',
    LAB: 'Цикл проб от отбора до протокола'
  };

  window.SANLAB_DEMO = {
    api: function (action, payload, token, rid) {
      var r = Api.handle(action, JSON.parse(JSON.stringify(payload || {})), token, rid);
      if (r.ok && !READ.test(action)) save();
      return JSON.parse(JSON.stringify(r));
    },
    login: function (root) {
      var emps = Store.all('Employees').filter(function (e) { return /@sanlab\.demo$/.test(e.email); });
      root.innerHTML = '<div class="login"><div class="box"><div class="logo">' + LOGO_MARK.replace('<svg', '<svg style="width:56px;height:62px"') + '<div><b>San<i>.</i>Lab</b><div class="muted small" style="margin-top:6px">Единая система санитарного сопровождения предприятий общественного питания</div></div></div>' +
        '<div class="alert warn small">Демо-режим. Данные вымышленные и хранятся только в этом браузере. В рабочей версии вход — по аккаунту Google Workspace, права проверяет сервер.</div>' +
        '<div><b>Войти как</b></div><div class="users">' + emps.map(function (e) {
          return '<button data-demo-user="' + e.email + '"><div class="ava">' + esc(initials(e.full_name)) + '</div><div><b>' + esc(shortName(e.full_name)) + ' · ' + esc(ROLES[e.role]) + '</b><span>' + esc(ROLE_HINT[e.role] || '') + '</span></div></button>';
        }).join('') + '</div></div></div>';
      $$('[data-demo-user]', root).forEach(function (b) { b.onclick = function () { S.token = b.getAttribute('data-demo-user'); try { sessionStorage.setItem('sanlab_demo_user', S.token); } catch (e) { } boot(); }; });
    }
  };
  A.demoSwitch = function () { S.token = ''; try { sessionStorage.removeItem('sanlab_demo_user'); } catch (e) { } clearInterval(S.poll); window.SANLAB_DEMO.login($('#app')); };
  A.demoReset = function () {
    confirmBox('Сбросить демо-данные?', 'Все изменения, сделанные в демо на этом устройстве, будут удалены, данные создадутся заново.', 'Сбросить', 'danger').then(function () {
      idbPut(KEY, '').then(function () { location.reload(); });
    });
  };

  function start() {
    var root = document.getElementById('app');
    root.innerHTML = '<div class="login"><div class="box" style="max-width:420px;align-items:flex-start"><div class="logo">' + LOGO_MARK.replace('<svg', '<svg style="width:44px;height:50px"') + '<b>San<i>.</i>Lab</b></div><span class="muted">Готовлю демо-данные: клиенты, выезды за 10 недель, пробы, счета…</span><div class="progress" style="width:100%"><i style="width:60%"></i></div></div></div>';
    idbGet(KEY).then(function (raw) {
      var today = localDayKey(new Date().toISOString());
      var saved = raw ? safeJson(raw, null) : null;
      if (saved && saved.day === today) { Store.load(saved.store); Integr.load(saved.integr); }
      else {
        Store.reset(); Integr.reset();
        Store.beginBatch(); Seed.demo(); Store.commitBatch();
        save();
      }
      try { S.token = sessionStorage.getItem('sanlab_demo_user') || ''; } catch (e) { S.token = ''; }
      boot();
    });
  }
  setTimeout(start, 30);
})();
