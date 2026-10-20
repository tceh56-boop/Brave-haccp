// Стенд: настоящий бэкенд в эмуляторе + настоящий Index.html в Chromium.
const { chromium } = require('playwright'), { boot } = require('./gasemu');
const G = require('path').resolve(__dirname, '../../gas') + '/';

async function openStand(E, opts) {
  opts = opts || {};
  const b = await chromium.launch({ args: ['--lang=ru-RU'], env: Object.assign({}, process.env, { LANG: 'ru_RU.UTF-8', LANGUAGE: 'ru' }) });
  const page = await b.newPage({ viewport: opts.viewport || { width: 1200, height: 900 }, deviceScaleFactor: opts.scale || 1.5, locale: 'ru-RU', timezoneId: 'Asia/Yekaterinburg' });
  // QR этикеток рисует внешний сервис quickchart.io — на стенде без интернета отдаём QR, собранный локально.
  await page.route(/quickchart\.io/, async route => { const u = new URL(route.request().url()); const buf = await require('qrcode').toBuffer(u.searchParams.get('text') || '-', { margin: 1, width: 180 }); route.fulfill({ status: 200, contentType: 'image/png', body: buf }); });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => { page.__dialogs = (page.__dialogs || []).concat(d.message()); d.accept(page.__prompt || undefined); });
  await page.exposeFunction('__api', (a, d, t) => { try { const R = E.ctx.api(a, d, t); if (!R.ok) (page.__fails = page.__fails || []).push(a + ': ' + R.error); return JSON.parse(JSON.stringify(R, (k, v) => (k === '__row' ? undefined : v))); } catch (e) { return { ok: false, error: String(e.message || e) }; } });
  await page.addInitScript(() => {
    function chain() { const st = {}; const o = { withSuccessHandler(f) { st.s = f; return o; }, withFailureHandler(f) { st.f = f; return o; }, withUserObject() { return o; },
      api(a, d, t) { window.__api(a, d, t).then(r => st.s && st.s(r), e => st.f && st.f(e)); } }; return o; }
    window.google = { script: { run: new Proxy({}, { get: (t, k) => chain()[k] }) } };
  });
  await page.goto('file://' + G + 'Index.html');
  await page.waitForTimeout(600);
  page.errs = errs;
  return { browser: b, page };
}

/** Поиск области: css-строка | {t:'текст', in:'css', n:0, tag:'button'} | {u:[спец, спец]} (объединение) | {x,y,w,h} */
const FIND = `function __find(spec){
  if(spec==null) return null;
  if(typeof spec==='string'){const el=document.querySelector(spec);return el?el.getBoundingClientRect():null;}
  if(spec.u){const rs=spec.u.map(__find).filter(Boolean);if(!rs.length)return null;const l=Math.min(...rs.map(r=>r.left)),t=Math.min(...rs.map(r=>r.top)),r=Math.max(...rs.map(r=>r.right)),b=Math.max(...rs.map(r=>r.bottom));return {left:l,top:t,right:r,bottom:b,width:r-l,height:b-t};}
  if(spec.t!==undefined){const root=spec.in?document.querySelector(spec.in):document;if(!root)return null;const els=[...root.querySelectorAll(spec.tag||'button,a,label,h2,h3,b,span,div,td,th,option,select,input,small,summary')].filter(e=>e.offsetParent!==null&&(e.textContent||e.placeholder||'').replace(/\\s+/g,' ').trim().indexOf(spec.t)>=0);
    const leaf=els.filter(e=>!els.some(o=>o!==e&&e.contains(o)));const el=leaf[spec.n||0];if(!el)return null;let r=el.getBoundingClientRect();if(spec.up){let p=el;for(let i=0;i<spec.up;i++)p=p.parentElement;r=p.getBoundingClientRect();}return r;}
  if(spec.x!==undefined) return {left:spec.x,top:spec.y,width:spec.w,height:spec.h,right:spec.x+spec.w,bottom:spec.y+spec.h};
  return null;}`;
async function mark(page, marks, opts) {
  const miss = await page.evaluate(({ marks, pad, FIND }) => {
    eval(FIND); const miss = [];
    document.querySelectorAll('.__mk').forEach(x => x.remove());
    marks.forEach(([spec, n, place]) => {
      const r = __find(spec); if (!r) { miss.push(JSON.stringify(spec)); return; }
      const box = document.createElement('div'); box.className = '__mk';
      Object.assign(box.style, { position: 'absolute', left: (r.left + scrollX - pad) + 'px', top: (r.top + scrollY - pad) + 'px', width: (r.width + 2 * pad) + 'px', height: (r.height + 2 * pad) + 'px',
        border: '3px solid #F07A1A', borderRadius: '8px', zIndex: 99998, pointerEvents: 'none' });
      document.body.appendChild(box);
      if (n) { const b = document.createElement('div'); b.className = '__mk'; b.textContent = n;
        const left = place === 'left' ? r.left + scrollX - pad - 13 : r.right + scrollX + pad - 13, top = r.top + scrollY - pad - 13;
        Object.assign(b.style, { position: 'absolute', left: left + 'px', top: top + 'px', width: '26px', height: '26px', borderRadius: '50%', background: '#F07A1A', color: '#fff',
          font: '700 14px/26px Arial', textAlign: 'center', zIndex: 99999, pointerEvents: 'none', boxShadow: '0 1px 3px rgba(0,0,0,.35)' });
        document.body.appendChild(b); }
    });
    return miss;
  }, { marks, pad: (opts && opts.pad) || 4, FIND });
  if (miss.length) console.log('   !! не найдено:', miss.join(' | '));
  return miss;
}
async function unmark(page) { await page.evaluate(() => document.querySelectorAll('.__mk').forEach(x => x.remove())); }
/** Снимок области (по умолчанию шапка + открытый раздел) с полями. */
async function shoot(page, file, area, opts) {
  opts = opts || {};
  const r = await page.evaluate(({ area, FIND }) => { eval(FIND); const a = __find(area); return a ? { x: a.left, y: a.top, w: a.width, h: a.height } : null; }, { area, FIND });
  if (!r) { console.log('   !! нет области для', file); return; }
  const pad = opts.pad === undefined ? 10 : opts.pad, maxH = opts.maxH || 2600;
  const clip = { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: Math.min(r.w + 2 * pad, page.viewportSize().width - Math.max(0, r.x - pad)), height: Math.min(r.h + 2 * pad, maxH) };
  await page.screenshot({ path: file, clip });
  if (!opts.keep) await unmark(page);
}
module.exports = { boot, openStand, mark, unmark, shoot };
