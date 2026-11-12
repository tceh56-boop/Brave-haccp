/**
 * Проверка ЦЕХ AI на настоящей модели: демо-организация + типовые вопросы от имени разных ролей.
 * Запуск (нужны база и ключ модели, не на рабочем сервере — создаёт демо-организацию):
 *   Anthropic: ANTHROPIC_API_KEY=... DATABASE_URL=... npx tsx tools/ai/try-agent.ts ["свой вопрос"]
 *   YandexGPT: AI_PROVIDER=yandex YANDEX_API_KEY=... YANDEX_FOLDER_ID=... DATABASE_URL=... npx tsx tools/ai/try-agent.ts
 * Печатает статус, какие данные AI запросил, ответ, источники и что отклонила проверка.
 */
import { migrate } from '../../src/server/db/migrate';
import { withSystem, closePool } from '../../src/server/db/pool';
import { seedDemo, demoEmail } from '../../src/server/demo/seed';
import { askAgent } from '../../src/server/ops/aiAgent';

const QUESTIONS: [string, string][] = process.argv[2] ? [['shef', process.argv[2]]] : [
  ['shef', 'Что сегодня не в порядке?'],
  ['sklad', 'Какие партии скоро истекают?'],
  ['haccp', 'Камера мяса показала 7,5 °C. Что делать?'],
  ['povar', 'Что мне сделать сейчас по сменным задачам?'],
];

async function main() {
  await migrate();
  const { orgId } = await seedDemo();
  for (const [login, q] of QUESTIONS) {
    const u = (await withSystem((tx) => tx.query(`select id, full_name from users where email = $1`, [demoEmail(login)]))).rows[0];
    const t = Date.now();
    const r: any = await askAgent(u.id, orgId, { question: q });
    console.log(`\n════ ${u.full_name}: «${q}»  (${((Date.now() - t) / 1000).toFixed(1)} с)`);
    console.log(JSON.stringify(r, null, 2));
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(closePool);
