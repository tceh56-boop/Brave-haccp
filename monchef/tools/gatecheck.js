// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович.
// Проверка шлюза MON CHEF: функции, вызываемые со страниц, против списков zzz_MonChef_Gate.gs.
// Запуск: node monchef/tools/gatecheck.js monchef/app
const fs=require('fs'),path=require('path');const dir=process.argv[2];
const gate=fs.readFileSync(path.join(dir,'zzz_MonChef_Gate.gs'),'utf8');
const arr=n=>JSON.parse(new RegExp('var '+n+' = (\\[[^\\n]*\\]);').exec(gate)[1]);
const obj=n=>JSON.parse(new RegExp('var '+n+' = (\\{[^\\n]*\\});').exec(gate)[1]);
const CL=new Set(arr('MC_GATE_CLIENT_')),MUT=new Set(arr('MC_GATE_MUT_')),PUB=new Set(arr('MC_GATE_PUBLIC_')),RAW=new Set(arr('MC_GATE_RAW_')),TRIG=new Set(arr('MC_GATE_TRIGGER_'));const NEED=obj('MC_GATE_NEED_');
// модули после генерации шлюза регистрируются в MC_GATE_EXT_ (V101): MC_GATE_EXT_.имя = { need: '…', mut: true } или { pub: true }
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.gs'))){const s=fs.readFileSync(path.join(dir,f),'utf8');for(const m of s.matchAll(/MC_GATE_EXT_\.([A-Za-z0-9_]+)\s*=\s*\{([^}]*)\}/g)){
 const n=m[1],b=m[2],need=(/need:\s*'([^']+)'/.exec(b)||[])[1];if(/pub:\s*true/.test(b)){PUB.add(n);continue;}if(!need)continue;CL.add(n);NEED[n]=need;if(/mut:\s*true/.test(b))MUT.add(n);}}
const defs=new Map();let dup=[];
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.gs'))){const s=fs.readFileSync(path.join(dir,f),'utf8');for(const m of s.matchAll(/^function ([A-Za-z0-9_$]+)\s*\(/gm)){const n=m[1];if(defs.has(n))dup.push(n+' : '+defs.get(n)+' + '+f);else defs.set(n,f);}}
const pub=[...defs.keys()].filter(n=>!/_$/.test(n));
const html=fs.readdirSync(dir).filter(f=>f.endsWith('.html')).map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('\n');
const called=new Set();for(const m of html.matchAll(/['"]([a-zA-Z][A-Za-z0-9_]+)['"]/g)){if(defs.has(m[1])&&!/_$/.test(m[1]))called.add(m[1]);}
for(const m of html.matchAll(/\.([a-zA-Z][A-Za-z0-9_]+)\(/g)){if(defs.has(m[1])&&!/_$/.test(m[1]))called.add(m[1]);}
const notReg=[...called].filter(n=>!CL.has(n)&&!PUB.has(n)&&!RAW.has(n));
const stale=[...CL].filter(n=>!defs.has(n));
const mutNoNeed=[...MUT].filter(n=>!NEED[n]);
console.log(JSON.stringify({gsFiles:fs.readdirSync(dir).filter(f=>f.endsWith('.gs')).length,functions:defs.size,publicFunctions:pub.length,gateClient:CL.size,gateMut:MUT.size,gatePublic:[...PUB],calledFromHtml:called.size,
 calledButNotRegistered:notReg.length,calledButNotRegisteredList:notReg.sort(),staleGateEntries:stale.length,staleList:stale.slice(0,40),mutWithoutNeed:mutNoNeed,duplicateTopLevelFunctions:dup},null,1));
