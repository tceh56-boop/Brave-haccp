import { handler, requireSession } from '@/server/http/route';
import { linkableRules } from '@/server/ops/haccp';

type P = { orgId: string };

export const GET = handler<P>(async (c) => linkableRules(requireSession(c).user.id, c.params.orgId));
