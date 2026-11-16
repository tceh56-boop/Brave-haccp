import { handler, requireSession } from '@/server/http/route';
import { checkConnection } from '@/server/ops/recognition';

type P = { orgId: string };

/** Платный тестовый запрос — только с confirmPaid: true. */
export const POST = handler<P>(async (c) => checkConnection(requireSession(c).user.id, c.params.orgId, await c.body()));
