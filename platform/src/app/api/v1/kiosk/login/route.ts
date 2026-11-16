import { NextResponse } from 'next/server';
import { handler, withSessionCookie } from '@/server/http/route';
import { kioskLogin, KIOSK_COOKIE } from '@/server/identity/kiosk';

export const POST = handler(async (c) => {
  const r = await kioskLogin(c.req.cookies.get(KIOSK_COOKIE)?.value, await c.body(), { ip: c.ip, userAgent: c.userAgent });
  return withSessionCookie(NextResponse.json({ ok: true, data: { user: r.session.user, orgId: r.orgId, siteId: r.siteId } }), r.token);
}, { auth: false });
