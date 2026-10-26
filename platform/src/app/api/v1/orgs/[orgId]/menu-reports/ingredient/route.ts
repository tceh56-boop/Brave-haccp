import { handler, requireSession } from '@/server/http/route';
import { ingredientUsage } from '@/server/ops/menureports';
import { Errors } from '@/server/http/errors';

type P = { orgId: string };

export const GET = handler<P>(async (c) => {
  const id = c.req.nextUrl.searchParams.get('productId');
  if (!id) throw Errors.validation('Укажите товар.');
  return ingredientUsage(requireSession(c).user.id, c.params.orgId, id);
});
