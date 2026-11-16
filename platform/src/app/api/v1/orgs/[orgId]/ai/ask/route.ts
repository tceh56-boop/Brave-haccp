import { handler, requireSession } from '@/server/http/route';
import { askQuestion } from '@/server/ops/ai';

type P = { orgId: string };

export const POST = handler<P>(async (c) => askQuestion(requireSession(c).user.id, c.params.orgId, await c.body()));
