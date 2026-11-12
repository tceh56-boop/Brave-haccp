import { handler, requireSession, requirePasswordSession } from '@/server/http/route';
import { telegramStatus, createLinkCode, unlinkTelegram } from '@/server/telegram/bot';

type P = { orgId: string };

export const GET = handler<P>(async (c) => telegramStatus(requireSession(c).user.id, c.params.orgId));
/** Код привязки — только из сессии по паролю (не по PIN с общего планшета). */
export const POST = handler<P>(async (c) => createLinkCode(requirePasswordSession(c).user.id, c.params.orgId));
export const DELETE = handler<P>(async (c) => unlinkTelegram(requireSession(c).user.id, c.params.orgId));
