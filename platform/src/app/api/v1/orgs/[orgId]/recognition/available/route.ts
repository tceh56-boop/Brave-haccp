import { handler, requireSession } from '@/server/http/route';
import { recognitionAvailable } from '@/server/ops/recognition';

type P = { orgId: string };

export const GET = handler<P>(async (c) => recognitionAvailable(requireSession(c).user.id, c.params.orgId));
