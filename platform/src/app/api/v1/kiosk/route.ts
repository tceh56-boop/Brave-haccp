import { handler } from '@/server/http/route';
import { kioskRoster, KIOSK_COOKIE } from '@/server/identity/kiosk';

/** Экран кухонного планшета: устройство и сотрудники с PIN (по cookie устройства). */
export const GET = handler(async (c) => kioskRoster(c.req.cookies.get(KIOSK_COOKIE)?.value), { auth: false });
