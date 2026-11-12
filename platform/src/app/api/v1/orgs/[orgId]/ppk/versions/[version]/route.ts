import { handler, requireSession } from '@/server/http/route';
import { getPpkVersion } from '@/server/ops/ppk';

type P = { orgId: string; version: string };

export const GET = handler<P>(async (c) => getPpkVersion(requireSession(c).user.id, c.params.orgId, Number(c.params.version)));
