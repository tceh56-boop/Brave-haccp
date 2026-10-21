import { handler, requireSession } from '@/server/http/route';
import { getArchiveCard } from '@/server/ops/recipes';

type P = { orgId: string; cardId: string };

export const GET = handler<P>(async (c) => getArchiveCard(requireSession(c).user.id, c.params.orgId, c.params.cardId));
