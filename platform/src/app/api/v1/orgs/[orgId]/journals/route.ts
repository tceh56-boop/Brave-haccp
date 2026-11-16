import { handler, requireSession } from '@/server/http/route';
import { inOrg } from '@/server/ops/common';
import { listForms } from '@/server/ops/journals';

type P = { orgId: string };

export const GET = handler<P>(async (c) => inOrg(requireSession(c).user.id, c.params.orgId, 'journal.read', async () => listForms()));
