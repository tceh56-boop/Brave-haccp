import { handler, requireSession } from '@/server/http/route';
import { suggestCapa } from '@/server/ops/ai';

type P = { orgId: string; capaId: string };

export const POST = handler<P>(async (c) => suggestCapa(requireSession(c).user.id, c.params.orgId, c.params.capaId));
