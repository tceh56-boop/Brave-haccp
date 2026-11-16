import { handler, requireSession } from '@/server/http/route';
import { importRegimes } from '@/server/ops/disinfectants';

type P = { orgId: string };

/** Предпросмотр (confirm: false) и импорт режимов дезсредств из CSV (ТЗ 3.0 §16.1, §25.2). */
export const POST = handler<P>(async (c) => importRegimes(requireSession(c).user.id, c.params.orgId, await c.body()));
