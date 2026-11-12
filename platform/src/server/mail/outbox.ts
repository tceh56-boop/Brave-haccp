import type { Tx } from '../db/pool';

/**
 * Письма кладутся в очередь outbox_emails в той же транзакции, что и действие: письмо не уйдёт
 * о том, чего не произошло, и не потеряется, если почтовый сервер недоступен. Отправку выполняет
 * отдельный обработчик очереди (адаптер SMTP подключается при развёртывании).
 */

export function appUrl(): string {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

const TEMPLATES = {
  verify_email: (p: { name: string; link: string }) => ({
    subject: 'ЦЕХ — подтвердите email',
    body: `Здравствуйте, ${p.name}!\n\nПодтвердите адрес почты, чтобы создать предприятие в системе «ЦЕХ»:\n${p.link}\n\nСсылка действует 48 часов. Если вы не регистрировались — просто удалите письмо.`,
  }),
  already_registered: (p: { name: string; link: string }) => ({
    subject: 'ЦЕХ — вход в систему',
    body: `Здравствуйте, ${p.name}!\n\nДля этого адреса уже есть учётная запись. Войти: ${p.link}\nЕсли забыли пароль, восстановите его на странице входа.`,
  }),
  reset_password: (p: { name: string; link: string }) => ({
    subject: 'ЦЕХ — восстановление пароля',
    body: `Здравствуйте, ${p.name}!\n\nЧтобы задать новый пароль, откройте ссылку:\n${p.link}\n\nСсылка действует 1 час. Если вы не запрашивали восстановление — ничего не делайте, пароль не изменится.`,
  }),
  invitation: (p: { org: string; role: string; link: string }) => ({
    subject: `ЦЕХ — приглашение в «${p.org}»`,
    body: `Вас пригласили в «${p.org}» в системе «ЦЕХ». Роль: ${p.role}.\n\nПринять приглашение:\n${p.link}\n\nСсылка действует 7 дней.`,
  }),
};

type Templates = typeof TEMPLATES;

export async function queueEmail<K extends keyof Templates>(tx: Tx, to: string, template: K, data: Parameters<Templates[K]>[0]): Promise<void> {
  const { subject, body } = (TEMPLATES[template] as (d: typeof data) => { subject: string; body: string })(data);
  await tx.query('insert into outbox_emails (to_email, template, subject, body) values ($1, $2, $3, $4)', [to, template, subject, body]);
}
