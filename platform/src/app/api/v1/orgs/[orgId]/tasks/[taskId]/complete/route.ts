import { handler, requireSession } from '@/server/http/route';
import { completeTask } from '@/server/ops/tasks';

type P = { orgId: string; taskId: string };

export const POST = handler<P>(async (c) => completeTask(requireSession(c).user.id, c.params.orgId, c.params.taskId, await c.body()));
