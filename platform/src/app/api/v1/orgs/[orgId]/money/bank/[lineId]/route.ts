import { handler, requireSession } from '@/server/http/route';
import { decideBankLine } from '@/server/ops/money';

type P = { orgId: string; lineId: string };
/** Разнести строку выписки. */
export const POST = handler<P>(async (c) => decideBankLine(requireSession(c).user.id, c.params.orgId, c.params.lineId, await c.body()));
