const { boot } = require('./gasemu');
const E = boot();
console.log('загружено; функций doGet:', typeof E.ctx.doGet);
try { const out = E.ctx.doGet({ parameter: {} }); console.log('doGet →', out.getTitle(), out.getContent().length, 'симв.'); } catch (e) { console.log('ERR doGet', e.stack.split('\n').slice(0, 4).join(' | ')); }
console.log('листы:', E.ss.getSheets().map(s => s.getName()).join(', '));
