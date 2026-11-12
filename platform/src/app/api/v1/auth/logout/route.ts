import { NextResponse } from 'next/server';
import { handler, withSessionCookie } from '@/server/http/route';
import { logout } from '@/server/identity/auth';
import { SESSION_COOKIE } from '@/server/http/route';

export const POST = handler(async (c) => {
  await logout(c.req.cookies.get(SESSION_COOKIE)?.value);
  return withSessionCookie(NextResponse.json({ ok: true, data: null }), null);
}, { auth: false });
