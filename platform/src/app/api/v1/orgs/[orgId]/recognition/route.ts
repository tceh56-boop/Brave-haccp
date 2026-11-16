import { handler, requireSession } from '@/server/http/route';
import { getRecognition, setRecognition } from '@/server/ops/recognition';

type P = { orgId: string };

export const GET = handler<P>(async (c) => getRecognition(requireSession(c).user.id, c.params.orgId));
export const POST = handler<P>(async (c) => setRecognition(requireSession(c).user.id, c.params.orgId, await c.body()));
