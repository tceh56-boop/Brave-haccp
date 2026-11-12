import { handler, requireSession } from '@/server/http/route';
import { getStages, saveStages } from '@/server/ops/ttkStages';

type P = { orgId: string; versionId: string };

/** Этапы ТТК с местами на 2D-плане (мастер-промт, раздел 6). */
export const GET = handler<P>(async (c) => getStages(requireSession(c).user.id, c.params.orgId, c.params.versionId));
export const PUT = handler<P>(async (c) => saveStages(requireSession(c).user.id, c.params.orgId, c.params.versionId, await c.body()));
