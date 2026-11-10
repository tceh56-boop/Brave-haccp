import { withSystem, closePool } from '../db/pool';
import { tg, handleUpdate, deliverNotifications, telegramConfigured } from './bot';

/**
 * Процесс бота «ЦЕХ ИИ»: `npm run bot` (в Docker — сервис bot). Длинный опрос getUpdates — серверу не нужен входящий адрес
 * и сертификат для Telegram; смещение хранится в базе, после перезапуска сообщения не теряются и не повторяются.
 * Без TELEGRAM_BOT_TOKEN процесс ждёт и ничего не делает (бот — необязательная часть установки).
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let stop = false;
process.on('SIGTERM', () => { stop = true; }); process.on('SIGINT', () => { stop = true; });

async function main() {
  if (!telegramConfigured()) {
    console.log('Telegram-бот выключен: не задан TELEGRAM_BOT_TOKEN. Добавьте его в .env и перезапустите: docker compose up -d bot');
    while (!stop) await sleep(60_000);
    return;
  }
  const me = await tg<{ username: string }>('getMe', {});
  console.log(`Бот @${me.username} запущен.`);
  let offset = Number((await withSystem((tx) => tx.query(`select value from telegram_state where key = 'offset'`))).rows[0]?.value || 0);
  let lastDelivery = 0;
  while (!stop) {
    try {
      const updates = await tg<{ update_id: number }[]>('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
      for (const u of updates) {
        await handleUpdate(u as never);
        offset = u.update_id + 1;
        await withSystem((tx) => tx.query(`insert into telegram_state (key, value) values ('offset', $1) on conflict (key) do update set value = excluded.value, updated_at = now()`, [String(offset)]));
      }
      if (Date.now() - lastDelivery > 15_000) { await deliverNotifications(); lastDelivery = Date.now(); }
    } catch (e) {
      console.error('bot:', (e as Error).message);
      await sleep(5000);
    }
  }
  await closePool();
}
main().catch((e) => { console.error(e); process.exit(1); });
