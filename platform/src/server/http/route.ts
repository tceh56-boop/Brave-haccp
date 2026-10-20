import { NextResponse, type NextRequest } from 'next/server';
import { AppError, Errors } from './errors';
import { getSession, SESSION_DAYS, type Session } from '../identity/auth';

/**
 * Обёртка обработчиков API v1: единый формат ответа { ok, data | error }, сессия из cookie,
 * защита изменяющих запросов от подделки с чужого сайта (заголовок Origin должен совпадать
 * с адресом приложения), понятные ошибки без внутренних подробностей.
 */

export const SESSION_COOKIE = 'ceh_session';

export interface Ctx<P> {
  req: NextRequest;
  params: P;
  ip: string | null;
  userAgent: string | null;
  session: Session | null;
  body: () => Promise<unknown>;
}

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return req.headers.get('sec-fetch-site') !== 'cross-site';
  const allowed = new Set([req.nextUrl.origin, process.env.APP_URL?.replace(/\/$/, '')].filter(Boolean));
  return allowed.has(origin);
}

export function clientIp(req: NextRequest): string | null {
  return (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || null;
}

export function handler<P = Record<string, never>>(fn: (ctx: Ctx<P>) => Promise<unknown | NextResponse>, opts: { auth?: boolean } = {}) {
  return async (req: NextRequest, route: { params: Promise<P> }) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) throw Errors.forbidden('Запрос отклонён: другой источник.');
      const session = await getSession(req.cookies.get(SESSION_COOKIE)?.value);
      if (opts.auth !== false && !session) throw Errors.unauthenticated();
      const params = (route?.params ? await route.params : {}) as P;
      const result = await fn({
        req, params, session, ip: clientIp(req), userAgent: req.headers.get('user-agent'),
        body: async () => { try { return await req.json(); } catch { throw Errors.validation('Ожидается JSON.'); } },
      });
      if (result instanceof NextResponse) return result;
      return NextResponse.json({ ok: true, data: result ?? null });
    } catch (e) {
      if (e instanceof AppError) return NextResponse.json({ ok: false, error: { code: e.code, message: e.message } }, { status: e.status });
      console.error('API', req.method, req.nextUrl.pathname, e);
      return NextResponse.json({ ok: false, error: { code: 'INTERNAL', message: 'Внутренняя ошибка. Повторите позже.' } }, { status: 500 });
    }
  };
}

export function withSessionCookie(res: NextResponse, token: string | null): NextResponse {
  res.cookies.set(SESSION_COOKIE, token || '', {
    httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production',
    maxAge: token ? SESSION_DAYS * 24 * 3600 : 0,
  });
  return res;
}

export function requireSession<P>(ctx: Ctx<P>): Session {
  if (!ctx.session) throw Errors.unauthenticated();
  return ctx.session;
}
