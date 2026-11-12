import { handler, requireSession } from '@/server/http/route';
import { updateVersion } from '@/server/ops/recipes';

type P = { orgId: string; versionId: string };

export const PATCH = handler<P>(async (c) => updateVersion(requireSession(c).user.id, c.params.orgId, c.params.versionId, await c.body()));
