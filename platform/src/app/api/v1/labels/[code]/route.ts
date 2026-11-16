import { handler, requireSession } from '@/server/http/route';
import { resolveLabelCode } from '@/server/ops/labels';

type P = { code: string };

/** QR этикетки → партия (после входа и с правом просмотра партий в организации этикетки). */
export const GET = handler<P>(async (c) => resolveLabelCode(requireSession(c).user.id, c.params.code));
