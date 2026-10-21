// Нагрузочная проверка перед пилотом (этап 8): смешанный поток чтения и записи от нескольких «устройств».
// Запуск: BASE_URL=http://localhost:3100 CONCURRENCY=20 SECONDS=20 node tests/load/smoke.mjs
// Результат — p50/p95/p99 по каждому запросу, ошибки, запросов в секунду; провал, если p95 > LIMIT_MS или есть ошибки.
import pg from 'pg';

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const C = Number(process.env.CONCURRENCY || 20), SECONDS = Number(process.env.SECONDS || 20), LIMIT = Number(process.env.LIMIT_MS || 800);
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://ceh@localhost:54329/ceh_dev' }); await db.connect();
const stamp = Date.now().toString(36);
let cookie = '';
async function req(method, path, body) {
  const r = await fetch(`${BASE}/api/v1${path}`, { method, headers: { 'content-type': 'application/json', origin: BASE, cookie }, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  const j = await r.json().catch(() => ({ ok: false })); if (!j.ok) throw new Error(`${method} ${path}: ${r.status} ${j.error?.message || ''}`); return j.data;
}
async function link(email, template) {
  for (let i = 0; i < 40; i++) {
    const r = await db.query('select body from outbox_emails where to_email = $1 and template = $2 order by created_at desc limit 1', [email, template]);
    if (r.rows[0]) return /token=([A-Za-z0-9_-]+)/.exec(r.rows[0].body)[1];
    await new Promise((s) => setTimeout(s, 250));
  }
  throw new Error('нет письма');
}

// Подготовка: владелец, предприятие, 10 объектов с утверждёнными правилами, блюдо, смена кассы.
const email = `load.${stamp}@example.test`, password = 'Нагрузка-2026-пароль';
await req('POST', '/auth/register', { email, password, fullName: 'Нагрузочный тест' });
await req('POST', '/auth/verify', { token: await link(email, 'verify_email') });
await req('POST', '/auth/login', { email, password });
const org = (await req('POST', '/orgs', { name: `Нагрузка ${stamp}` })).organization;
const [site] = await req('GET', `/orgs/${org.id}/sites`);
const objects = [];
for (let i = 1; i <= 10; i++) {
  const o = await req('POST', `/orgs/${org.id}/objects`, { siteId: site.id, name: `Холодильник ${i}`, kind: 'fridge' });
  const r = await req('POST', `/orgs/${org.id}/objects/${o.id}/rules`, { minValue: 0, maxValue: 6, frequencyHours: 4, sourceRef: 'ПК-03, п. 2', reaction: 'Повторить замер.' });
  await req('POST', `/orgs/${org.id}/rules/${r.id}/approve`, {});
  objects.push(o.id);
}
await req('POST', `/orgs/${org.id}/dishes`, { name: 'Морс', salePrice: 150 });
await req('POST', `/orgs/${org.id}/pos/shift/open`, { siteId: site.id, cashStart: 0 });
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });

const ops = [
  ['GET problems', () => req('GET', `/orgs/${org.id}/problems?siteId=${site.id}`)],
  ['GET shift', () => req('GET', `/orgs/${org.id}/sites/${site.id}/shift`)],
  ['GET journal J01', () => req('GET', `/orgs/${org.id}/journals/J01?siteId=${site.id}&from=${today}&to=${today}`)],
  ['POST measurement', () => req('POST', `/orgs/${org.id}/measurements`, { controlObjectId: objects[Math.floor(Math.random() * objects.length)], value: (2 + Math.random() * 3).toFixed(1) })],
  ['GET pos menu', () => req('GET', `/orgs/${org.id}/sites/${site.id}/pos/menu`)],
];
const stats = Object.fromEntries(ops.map(([n]) => [n, []]));
const errors = [];
const until = Date.now() + SECONDS * 1000;
let count = 0;
await Promise.all(Array.from({ length: C }, async (_, w) => {
  let i = w;
  while (Date.now() < until) {
    const [name, fn] = ops[i++ % ops.length];
    const t = performance.now();
    try { await fn(); stats[name].push(performance.now() - t); count++; } catch (e) { errors.push(`${name}: ${e.message}`); }
  }
}));
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))]) : 0; };
console.log(`Параллельно: ${C}, ${SECONDS} с, запросов: ${count} (${Math.round(count / SECONDS)} в секунду), ошибок: ${errors.length}`);
console.log('запрос'.padEnd(20), 'n'.padStart(6), 'p50'.padStart(6), 'p95'.padStart(6), 'p99'.padStart(6));
let worst = 0;
for (const [n, a] of Object.entries(stats)) { worst = Math.max(worst, pct(a, 0.95)); console.log(n.padEnd(20), String(a.length).padStart(6), String(pct(a, 0.5)).padStart(6), String(pct(a, 0.95)).padStart(6), String(pct(a, 0.99)).padStart(6)); }
if (errors.length) console.log('ошибки:', [...new Set(errors)].slice(0, 5));
await db.end();
if (errors.length || worst > LIMIT) { console.log(`ПРОВАЛ: p95 ${worst} мс (предел ${LIMIT}) или ошибки`); process.exitCode = 1; } else console.log(`OK: p95 не выше ${worst} мс (предел ${LIMIT})`);
