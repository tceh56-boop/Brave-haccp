import { handler } from '@/server/http/route';

/** kiosk — сессия по PIN с кухонного планшета (выход ведёт обратно к списку сотрудников планшета). */
export const GET = handler(async (c) => ({ user: c.session?.user || null, kiosk: !!c.session?.orgScope }), { auth: false });
