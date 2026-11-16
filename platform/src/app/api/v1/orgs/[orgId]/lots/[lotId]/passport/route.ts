import { handler, requireSession } from '@/server/http/route';
import { productPassport } from '@/server/ops/passport';

type P = { orgId: string; lotId: string };

/** Паспорт продукта по партии (мастер-промт, раздел 2). */
export const GET = handler<P>(async (c) => productPassport(requireSession(c).user.id, c.params.orgId, c.params.lotId));
