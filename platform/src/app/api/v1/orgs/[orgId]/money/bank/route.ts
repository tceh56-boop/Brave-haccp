import { handler, requireSession } from '@/server/http/route';
import { listBankLines, importBankStatement } from '@/server/ops/money';

type P = { orgId: string };
/** Строки банковской выписки (по умолчанию — неразнесённые). */
export const GET = handler<P>(async (c) => listBankLines(requireSession(c).user.id, c.params.orgId, { status: c.req.nextUrl.searchParams.get('status') || 'new' }));
/** Загрузка выписки: текст файла в формате обмена с 1С. */
export const POST = handler<P>(async (c) => importBankStatement(requireSession(c).user.id, c.params.orgId, await c.body()));
