/**
 * MON CHEF — подготовка страниц модулей и разделов прежнего интерфейса.
 *
 * Страница веб-приложения работает во внутренней рамке Google: адресная строка
 * (?token=...) ей не видна. Модули брали ключ входа оттуда или не передавали его
 * вовсе — и сервер отвечал «сессия не найдена». Здесь в страницу встраивается:
 *  • ключ входа (и сохраняется на устройстве, как в главном экране);
 *  • схема «функция сервера → номер параметра token»: любой вызов, где ключ
 *    пустой или пропущен, получает текущий ключ; функциям без параметра token
 *    ключ уходит служебным последним аргументом {__mct}, его снимает единый шлюз
 *    (zzz_MonChef_Gate.gs) — так вход и роль проверяются на каждом вызове;
 *  • для разделов прежнего интерфейса — пользователь и права текущей сессии,
 *    раздел, который нужно открыть, и признак «без меню»;
 *  • полоса «← MON CHEF» для возврата на главный экран.
 */
function _mcTokenArgMap_(content) {
  var g = (typeof MC_GLOBAL_ !== 'undefined') ? MC_GLOBAL_ : this, map = {};
  Object.keys(g).forEach(function (name) {
    if (/_$/.test(name) || typeof g[name] !== 'function' || content.indexOf(name) < 0) return;
    var m = /^function[^(]*\(([^)]*)\)/.exec(String(g[name]));
    if (!m) return;
    var ps = m[1].split(',').map(function (x) { return x.replace(/\/\*.*?\*\//g, '').trim(); });
    map[name] = -1;                                   // нет параметра token — ключ уходит служебным последним аргументом
    for (var i = 0; i < ps.length; i++) if (/^token$/i.test(ps[i])) { map[name] = i; break; }
    if (/^rawToken$/i.test(ps[0] || '')) delete map[name];   // портал проверяющего — свой ключ
  });
  return map;
}

function _mcDecoratePage_(out, params) {
  var html = out.getContent(), token = String(params.token || '');
  var portal = params.audit === '1', main = !!params.__console;   // страница проверяющего / главный экран
  var user = null, perms = null;   // прежний интерфейс (App.html) удалён — данные пользователя страницы берут из сессии сами
  // этап 10.7: что доступно вошедшему (права, страницы) — страницы скрывают недоступные кнопки (window.__MC_ACCESS)
  var access = null;
  if (token && !portal) { try { var sa = _getSession_(token); if (sa) access = _mcRbAccess_(sa); } catch (e) {} }
  var home = '';
  try { home = ScriptApp.getService().getUrl(); } catch (e) {}
  var J = function (x) { return JSON.stringify(x === undefined ? null : x).replace(/</g, '\\u003c'); };
  // этап 10.7: права на серверные функции этой страницы (та же карта, что у шлюза) — кнопка, все функции которой запрещены, скрывается
  var tmap = _mcTokenArgMap_(html), need = {}, devno = {};
  try { Object.keys(tmap).forEach(function (k) { if (typeof MC_GATE_NEED_ !== 'undefined' && MC_GATE_NEED_[k]) need[k] = MC_GATE_NEED_[k]; if (typeof MC_GATE_DEVNO_ !== 'undefined' && (Array.isArray(MC_GATE_DEVNO_) ? MC_GATE_DEVNO_.indexOf(k) >= 0 : MC_GATE_DEVNO_[k])) devno[k] = 1; }); } catch (e) {}
  var boot = '<script>(function(){' +
    'var T=' + J(token) + ',MAP=' + J(tmap) + ',HOME=' + J(home) + ',USER=' + J(user) + ',PERMS=' + J(perms) +
    ',OPENV=' + J(String(params.__openview || '')) + ',PORTAL=' + (portal ? 'true' : 'false') + ',MAIN=' + (main ? 'true' : 'false') + ',ACC=' + J(access) + ';' +
    'window.__MC_ACCESS=ACC;' +
    'if(!PORTAL){try{if(T)localStorage.setItem("mc_token",T);else T=localStorage.getItem("mc_token")||"";}catch(e){}}' +
    'try{if(USER){localStorage.setItem("mc_user",JSON.stringify(USER));localStorage.setItem("mc_perms",JSON.stringify(PERMS||{}));}}catch(e){}' +
    'window.__MC_TOKEN=T;window.__MC_OPENV=OPENV;window.__MC_HOME=HOME;' +
    'var g0=URLSearchParams.prototype.get;URLSearchParams.prototype.get=function(k){var v=g0.call(this,k);return(k==="token"&&!v)?window.__MC_TOKEN:v;};' +
    'if(window.google&&google.script&&google.script.run&&window.Proxy){var R=google.script.run;' +
    'var W=function(st){return new Proxy({},{get:function(_,k){' +
    'if(k==="withSuccessHandler")return function(f){return W(Object.assign({},st,{ok:f}));};' +
    'if(k==="withFailureHandler")return function(f){return W(Object.assign({},st,{fail:f}));};' +
    'if(k==="withUserObject")return function(u){return W(Object.assign({},st,{uo:u,hu:true}));};' +
    'var cur=function(){var t=window.__MC_TOKEN||"";if(!t&&!PORTAL){try{t=localStorage.getItem("mc_token")||"";}catch(e){}}return t;};' +
    'return function(){var a=[].slice.call(arguments),i=MAP[k];' +
    'if(!PORTAL&&i!==undefined){if(i<0)a.push({__mct:cur(),__mcn:a.length});else{while(a.length<=i)a.push("");if(!a[i])a[i]=cur();}}' +
    // нагрузочный сценарий: Google отказал в запуске — у владельца уже 30 одновременных выполнений (сотрудники + расписание).
    // Вызов не начинался, поэтому повтор безопасен: экран сам повторяет через 1–3 с, 2–6 с, 3–9 с, 4–12 с, потом показывает ошибку.
    'var n=0,go=function(){var r=R;if(st.ok)r=r.withSuccessHandler(st.ok);' +
    'r=r.withFailureHandler(function(e,u){if(/too many scripts|running simultaneously|одновременно/i.test(String(e&&e.message||e))&&n<4){n++;return setTimeout(go,(1000+Math.random()*2000)*n);}if(st.fail)return st.fail(e,u);if(window.console)console.error(e);});' +
    'if(st.hu)r=r.withUserObject(st.uo);return r[k].apply(r,a);};return go();};}});};' +
    'try{google.script.run=W({});}catch(e){}}' +
    'var bar=function(){if(!document.body||document.getElementById("mcback"))return;' +
    'var st=document.createElement("style");st.textContent=' + J(_mcBackCss_()) + ';document.head.appendChild(st);' +
    'var b=document.createElement("div");b.id="mcback";b.innerHTML=\'<a href="\'+(HOME||"#")+\'" target="_top">‹ MON CHEF</a><span>\'+(document.title||"").replace(/^Mon Chef — |^MON CHEF — /i,"").replace(/</g,"&lt;")+\'</span>\';' +
    'document.body.insertBefore(b,document.body.firstChild);};' +
    'if(!MAIN){if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bar);else bar();}' +
    // скрыть кнопку, если ВСЕ серверные функции её обработчика роли запрещены (сервер всё равно ответит 403)
    'var NEED=' + J(need) + ',DEVNO=' + J(devno) + ',FC={};' +
    'var okFn=function(k){var a=window.__MC_ACCESS;if(!a)return true;if(a.dev)return !DEVNO[k];var sp=NEED[k];if(!sp||sp==="*")return true;if(sp==="system")return false;return sp.split("|").some(function(x){return a.perms&&a.perms[x]===true;});};' +
    'var fnsOf=function(n){if(FC[n])return FC[n];var f=window[n],src=typeof f==="function"?String(f):"",o=[];if(src)Object.keys(NEED).forEach(function(k){if(src.indexOf("\'"+k+"\'")>=0||src.indexOf(String.fromCharCode(34)+k+String.fromCharCode(34))>=0||src.indexOf("."+k+"(")>=0)o.push(k);});return(FC[n]=o);};' +
    'var chk=function(el){var m=/^\\s*(?:return\\s+)?([A-Za-z_$][\\w$]*)\\s*\\(/.exec(el.getAttribute("onclick")||"");if(!m)return;var fs=fnsOf(m[1]);if(fs.length&&fs.every(function(k){return !okFn(k);})){el.style.display="none";el.setAttribute("data-mc-hidden","403");}};' +
    'var sweep=function(n){if(!n||n.nodeType!==1)return;if(n.hasAttribute("onclick"))chk(n);[].forEach.call(n.querySelectorAll("[onclick]"),chk);};' +
    'window.__mcSweep=function(){sweep(document.body);};window.__mcOkFn=okFn;' +
    'var go=function(){if(!document.body)return;sweep(document.body);try{new MutationObserver(function(ms){ms.forEach(function(x){[].forEach.call(x.addedNodes,sweep);});}).observe(document.body,{childList:true,subtree:true});}catch(e){}};' +
    'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",go);else go();' +
    '})();</script>';
  var m = /<head[^>]*>/i.exec(html);
  html = m ? html.slice(0, m.index + m[0].length) + boot + html.slice(m.index + m[0].length) : boot + html;
  out.setContent(html);
  return out;
}

function _mcBackCss_() {
  return '#mcback{position:fixed;top:0;left:0;right:0;height:46px;z-index:2147480000;display:flex;align-items:center;gap:12px;padding:0 14px;' +
    'background:linear-gradient(90deg,#4a0c17,#6e1423);color:#f6e9e4;font:600 14px/1 -apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.18)}' +
    '#mcback a{color:#fff;text-decoration:none;background:rgba(255,255,255,.14);border-radius:999px;padding:7px 12px;flex:0 0 auto}' +
    '#mcback span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.9}' +
    'body{padding-top:52px!important}';
}
