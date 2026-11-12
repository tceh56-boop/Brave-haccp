// HTML → PDF (A4) через Chromium: node tools/html2pdf.js in.html out.pdf
const { chromium } = require('playwright');
(async () => {
  const [, , inp, out] = process.argv;
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto('file://' + require('path').resolve(inp), { waitUntil: 'load' });
  await p.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
