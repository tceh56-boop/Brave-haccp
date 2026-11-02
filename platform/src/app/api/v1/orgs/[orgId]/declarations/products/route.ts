import { handler, requireSession } from '@/server/http/route';
import { declarableProducts } from '@/server/ops/declarations';

type P = { orgId: string };

export const GET = handler<P>(async (c) => declarableProducts(requireSession(c).user.id, c.params.orgId));
