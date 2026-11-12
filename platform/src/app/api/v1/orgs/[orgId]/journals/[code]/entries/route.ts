import { handler, requireSession } from '@/server/http/route';
import { addEntry, listEntries } from '@/server/ops/journals';
import { Errors } from '@/server/http/errors';

type P = { orgId: string; code: string };

export const GET = handler<P>(async (c) => {
  const siteId = c.req.nextUrl.searchParams.get('siteId');
  if (!siteId) throw Errors.validation('Укажите точку.');
  return listEntries(requireSession(c).user.id, c.params.orgId, c.params.code.toUpperCase(), siteId);
});
export const POST = handler<P>(async (c) => addEntry(requireSession(c).user.id, c.params.orgId, c.params.code.toUpperCase(), await c.body()));
