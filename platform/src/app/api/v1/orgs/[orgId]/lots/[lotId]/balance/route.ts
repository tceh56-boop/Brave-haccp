import { handler, requireSession } from '@/server/http/route';
import { lotBalance } from '@/server/ops/lotEconomics';

type P = { orgId: string; lotId: string };

/** Баланс и экономика партии (ТЗ 3.0 §9.3, §10.3, §13.4). */
export const GET = handler<P>(async (c) => lotBalance(requireSession(c).user.id, c.params.orgId, c.params.lotId));
