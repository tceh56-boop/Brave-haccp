// Список сторонних компонентов, которые входят в работающую систему (зависимости production), и их лицензий.
// Результат — THIRD_PARTY_NOTICES.md в корне репозитория. Запуск: npm run legal:notices
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dirs = execSync('npm ls --omit=dev --all --parseable', { cwd: ROOT }).toString().trim().split('\n').slice(1);
const seen = new Map();
for (const d of dirs) {
  const pkg = JSON.parse(readFileSync(path.join(d, 'package.json'), 'utf8'));
  const key = `${pkg.name}@${pkg.version}`;
  if (seen.has(key)) continue;
  const lic = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type || (pkg.licenses || []).map((l) => l.type).join(' OR ') || 'не указана';
  const file = readdirSync(d).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
  const text = file ? readFileSync(path.join(d, file), 'utf8').trim() : '';
  const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name || '';
  seen.set(key, { name: pkg.name, version: pkg.version, lic, author, text, repo: typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url || '' });
}
const list = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
const counts = {};
for (const p of list) counts[p.lic] = (counts[p.lic] || 0) + 1;
const out = [
  '# Сторонние компоненты системы ЦЕХ',
  '',
  'Система использует перечисленные ниже компоненты с открытым исходным кодом. Каждый распространяется под своей лицензией;',
  'тексты лицензий и уведомления об авторских правах приведены ниже и сохраняются при распространении системы.',
  '',
  'Отдельно в системе работают PostgreSQL (лицензия PostgreSQL License) и, при развёртывании через Docker, образы Node.js, Caddy (Apache-2.0) и Mailpit (MIT) — у каждого своя лицензия в составе образа.',
  '',
  'Лицензии LGPL-3.0 (библиотека libvips в составе sharp, обработка изображений) и CC-BY-4.0 (данные caniuse-lite) совместимы с подпиской в облаке:',
  'libvips подключается как отдельная динамическая библиотека и не изменялась; доступ к системе через интернет не является распространением её копий.',
  'При передаче копий системы клиентам (установка у клиента) нужно приложить этот файл и обеспечить возможность заменить libvips.',
  '',
  `Компонентов: ${list.length}. Лицензии: ${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} — ${n}`).join(', ')}.`,
  '',
  '| Компонент | Версия | Лицензия |',
  '|---|---|---|',
  ...list.map((p) => `| ${p.name} | ${p.version} | ${p.lic} |`),
  '',
  ...list.flatMap((p) => [`## ${p.name} ${p.version}`, '', `Лицензия: ${p.lic}${p.author ? ` · автор: ${p.author}` : ''}${p.repo ? ` · ${p.repo.replace(/^git\+/, '')}` : ''}`, '', p.text ? '```\n' + p.text + '\n```' : '_Текст лицензии в пакете отсутствует; действует лицензия, указанная выше._', '']),
].join('\n');
writeFileSync(path.join(ROOT, '..', 'THIRD_PARTY_NOTICES.md'), out);
console.log(`компонентов: ${list.length}`, counts);
const bad = list.filter((p) => !/^(MIT|ISC|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|0BSD|BlueOak-1\.0\.0|CC0-1\.0|Unlicense|MIT-0|\(MIT OR CC0-1\.0\)|Python-2\.0)$/.test(p.lic));
if (bad.length) console.log('!! проверить вручную:', bad.map((p) => `${p.name} (${p.lic})`).join(', '));
if (!existsSync(path.join(ROOT, '..', 'LICENSE'))) console.log('!! нет файла LICENSE в корне репозитория');
