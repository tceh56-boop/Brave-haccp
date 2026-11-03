import { handler, requireSession } from '@/server/http/route';
import { listChecklists, generateChecklists } from '@/server/ops/checklists';

type P = { orgId: string };

export const GET = handler<P>(async (c) => listChecklists(requireSession(c).user.id, c.params.orgId, c.req.nextUrl.searchParams.get('siteId') || ''));
/** Сформировать черновики чек-листов площадки из утверждённых ТТК и плана ХАССП. */
export const POST = handler<P>(async (c) => generateChecklists(requireSession(c).user.id, c.params.orgId, await c.body()));
