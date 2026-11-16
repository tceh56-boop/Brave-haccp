'use strict';
/**
 * Граница доступа HTTP-сервера (аудит 16.11.2026, C-01 и C-02).
 *
 * 1. Какие функции можно вызвать из браузера (POST …/rpc). Разрешено только то, что прошло через шлюз:
 *    - предприятие: функция обёрнута шлюзом zzz_MonChef_Gate.gs (у неё есть метка __mcGate). Шлюз сам требует
 *      сессию, право роли, тариф и меддопуск; без метки (функция не попала в шлюз) — отказ. Входы doGet/doPost — только
 *      через свои адреса, не через rpc.
 *    - админ-панель поставщика: только функции admin… (у каждой, кроме adminLogin, первым аргументом идёт ключ сессии
 *      и проверка requireRole). Служебные readAll, update, setSetting, setupAdmin и т.п. из браузера закрыты.
 * 2. Ключ сессии для файлов /file, /sheet, /folder: страница передаёт его в вызовах google.script.run, сервер кладёт его
 *    в cookie (HttpOnly, только для адреса этого предприятия). Файл отдаётся, только если ключ — действующая сессия.
 * 3. Ограничение частоты попыток входа с одного адреса.
 */

const NAME = /^[A-Za-z$][A-Za-z0-9_$]*$/;
const NEVER = new Set(['doGet', 'doPost', 'eval', 'Function']);
const COOKIE = 'ts_sess';

/** Можно ли вызвать функцию fn (уже найденную в проекте как f) из браузера. */
function rpcAllowed(kind, fn, f) {
  if (!NAME.test(fn) || fn.endsWith('_') || NEVER.has(fn)) return false;
  if (typeof f !== 'function') return false;
  if (kind === 'admin') return /^admin[A-Z][A-Za-z0-9]*$/.test(fn);
  return typeof f.__mcGate === 'string' && f.__mcGate !== 'entry';
}

/** Ключ сессии из аргументов вызова (служебный последний аргумент {__mct} страницы ЦЕХ или первый аргумент admin…). */
function tokenFromArgs(kind, fn, args) {
  if (!Array.isArray(args) || !args.length) return '';
  if (kind === 'admin') return fn !== 'adminLogin' && typeof args[0] === 'string' && args[0].length >= 32 && args[0].length <= 200 ? args[0] : '';
  const last = args[args.length - 1];
  if (last && typeof last === 'object' && !Array.isArray(last) && typeof last.__mct === 'string') return last.__mct;
  return '';
}

/** Ключ сессии из ответа функции входа. */
function tokenFromLogin(kind, fn, value) {
  try {
    if (kind === 'admin' && fn === 'adminLogin') return value && value.ok && value.data && typeof value.data.token === 'string' ? value.data.token : '';
    if (kind !== 'admin' && fn === 'loginWithPin') {
      const v = typeof value === 'string' ? JSON.parse(value) : value;
      return v && v.ok && typeof (v.token || v.sessionToken) === 'string' ? (v.token || v.sessionToken) : '';
    }
  } catch (e) { /* не JSON — не вход */ }
  return '';
}

const isLogout = (kind, fn) => (kind === 'admin' ? fn === 'adminLogout' : fn === 'destroySession');

function readCookie(req, name = COOKIE) {
  const h = String(req.headers.cookie || '');
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) { try { return decodeURIComponent(part.slice(i + 1).trim()); } catch (e) { return ''; } }
  }
  return '';
}

/** Set-Cookie с ключом сессии; путь — адрес предприятия (/t/<код>/ или /admin/), чтобы ключ не уходил другим предприятиям. */
function sessionCookie(basePath, token, secure) {
  const p = basePath.replace(/\/?$/, '/');
  if (!token) return `${COOKIE}=; Path=${p}; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
  return `${COOKIE}=${encodeURIComponent(token)}; Path=${p}; HttpOnly; SameSite=Lax; Max-Age=43200${secure ? '; Secure' : ''}`;
}

/** Простое окно: не больше limit попыток с адреса за windowMs. В каждом процессе своё (процессов немного). */
function rateLimiter(limit, windowMs) {
  const hits = new Map();
  return (key, now = Date.now()) => {
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= limit) { hits.set(key, arr); return false; }
    arr.push(now); hits.set(key, arr);
    if (hits.size > 10000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] >= windowMs) hits.delete(k);
    return true;
  };
}

/** Адрес клиента: последний адрес в X-Forwarded-For дописал наш Caddy (первые может подставить сам клиент). */
function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean).pop();
  return xf || (req.socket && req.socket.remoteAddress) || '';
}

module.exports = { rpcAllowed, tokenFromArgs, tokenFromLogin, isLogout, readCookie, sessionCookie, rateLimiter, clientIp, COOKIE };
