import { NextResponse } from 'next/server';
import { handler, requirePasswordSession } from '@/server/http/route';
import { enrollDevice, listDevices, KIOSK_COOKIE } from '@/server/identity/kiosk';

type P = { orgId: string };

export const GET = handler<P>(async (c) => listDevices(requirePasswordSession(c).user.id, c.params.orgId));
/** Привязка текущего устройства: токен — только в httpOnly-cookie этого устройства, в ответе его нет. */
export const POST = handler<P>(async (c) => {
  const r = await enrollDevice(requirePasswordSession(c).user.id, c.params.orgId, await c.body());
  const res = NextResponse.json({ ok: true, data: { device: r.device } });
  res.cookies.set(KIOSK_COOKIE, r.token, { httpOnly: true, sameSite: 'strict', path: '/', secure: process.env.NODE_ENV === 'production', maxAge: 400 * 24 * 3600 });
  return res;
});
