'use strict';
/**
 * HTML → PDF. Apps Script делает это через Google Документы; здесь — Chromium без окна (--print-to-pdf).
 * Вызов синхронный (execFileSync), потому что код Apps Script ждёт результат сразу.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/opt/pw-browsers/chromium/chrome-linux/chrome']) if (fs.existsSync(p)) return p;
  try {
    const dir = fs.readdirSync('/opt/pw-browsers').find((d) => /^chromium-\d+$/.test(d));
    if (dir) for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome']) { const p = path.join('/opt/pw-browsers', dir, sub); if (fs.existsSync(p)) return p; }
  } catch (e) { /* нет каталога */ }
  return 'chromium';
}

function htmlToPdf(html) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-pdf-'));
  try {
    const src = path.join(dir, 'in.html');
    const out = path.join(dir, 'out.pdf');
    let doc = String(html);
    if (!/<meta[^>]+charset/i.test(doc)) doc = '<meta charset="utf-8">' + doc;
    fs.writeFileSync(src, doc);
    execFileSync(chromiumPath(), ['--headless', '--no-sandbox', '--disable-gpu', '--no-pdf-header-footer', '--run-all-compositor-stages-before-draw',
      `--user-data-dir=${path.join(dir, 'profile')}`, `--print-to-pdf=${out}`, 'file://' + src], { stdio: 'ignore', timeout: 60000 });
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { htmlToPdf };
