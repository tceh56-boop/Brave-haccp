import { handler, requireSession } from '@/server/http/route';
import { answerTree } from '@/server/ops/haccp';

type P = { orgId: string; hazardId: string };

export const POST = handler<P>(async (c) => answerTree(requireSession(c).user.id, c.params.orgId, c.params.hazardId, await c.body()));
