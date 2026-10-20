import { NextResponse } from 'next/server';
import { handler, withSessionCookie } from '@/server/http/route';
import { login } from '@/server/identity/auth';

export const POST = handler(async (c) => {
  const r = await login(await c.body(), { ip: c.ip, userAgent: c.userAgent });
  return withSessionCookie(NextResponse.json({ ok: true, data: { user: r.session.user } }), r.token);
}, { auth: false });
