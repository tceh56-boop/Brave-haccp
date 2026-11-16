import { handler, requireSession } from '@/server/http/route';
import { blockLot } from '@/server/ops/recalls';

type P = { orgId: string; lotId: string };

/** Блокировка партии и всей цепочки дочерних партий при опасности (ТЗ 3.0 §10.5). */
export const POST = handler<P>(async (c) => blockLot(requireSession(c).user.id, c.params.orgId, c.params.lotId, await c.body()));
