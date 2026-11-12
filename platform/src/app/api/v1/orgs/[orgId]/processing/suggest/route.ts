import { handler, requireSession } from '@/server/http/route';
import { suggestFromArchive } from '@/server/ops/processing';
import { Errors } from '@/server/http/errors';

type P = { orgId: string };

export const GET = handler<P>(async (c) => {
  const id = c.req.nextUrl.searchParams.get('productId');
  if (!id) throw Errors.validation('Укажите товар.');
  return suggestFromArchive(requireSession(c).user.id, c.params.orgId, id);
});
