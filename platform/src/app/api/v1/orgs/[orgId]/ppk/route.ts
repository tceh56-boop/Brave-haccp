import { handler, requireSession } from '@/server/http/route';
import { getPpk, savePpkParams } from '@/server/ops/ppk';

type P = { orgId: string };

export const GET = handler<P>(async (c) => getPpk(requireSession(c).user.id, c.params.orgId));
export const PUT = handler<P>(async (c) => savePpkParams(requireSession(c).user.id, c.params.orgId, await c.body()));
