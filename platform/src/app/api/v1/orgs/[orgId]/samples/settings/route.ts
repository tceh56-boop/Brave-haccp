import { handler, requireSession } from '@/server/http/route';
import { setSampleSettings } from '@/server/ops/lab';

type P = { orgId: string };

export const POST = handler<P>(async (c) => setSampleSettings(requireSession(c).user.id, c.params.orgId, await c.body()));
