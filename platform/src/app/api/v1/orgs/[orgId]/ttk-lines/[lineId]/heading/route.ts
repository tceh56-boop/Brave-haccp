import { handler, requireSession } from '@/server/http/route';
import { renameHeading } from '@/server/ops/recipes';

type P = { orgId: string; lineId: string };

export const PATCH = handler<P>(async (c) => renameHeading(requireSession(c).user.id, c.params.orgId, c.params.lineId, await c.body()));
