import { handler, requireSession } from '@/server/http/route';
import { getProfile, saveProfile, OBJECT_TYPES, PROCESSES } from '@/server/ops/regulatory';

type P = { orgId: string };

export const GET = handler<P>(async (c) => ({ profile: await getProfile(requireSession(c).user.id, c.params.orgId), objectTypes: OBJECT_TYPES, processes: PROCESSES }));
export const PUT = handler<P>(async (c) => saveProfile(requireSession(c).user.id, c.params.orgId, await c.body()));
