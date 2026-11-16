import { handler, requireSession } from '@/server/http/route';
import { getCapa, updateCapa } from '@/server/ops/capa';

type P = { orgId: string; capaId: string };

export const GET = handler<P>(async (c) => getCapa(requireSession(c).user.id, c.params.orgId, c.params.capaId));
export const PATCH = handler<P>(async (c) => updateCapa(requireSession(c).user.id, c.params.orgId, c.params.capaId, await c.body()));
