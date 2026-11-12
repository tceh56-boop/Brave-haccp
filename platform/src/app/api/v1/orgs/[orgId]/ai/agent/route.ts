import { handler, requireSession } from '@/server/http/route';
import { askAgent } from '@/server/ops/aiAgent';

type P = { orgId: string };

/** ЦЕХ AI: агент сам запрашивает данные системы (с правами пользователя) и отвечает со ссылками на реестр. */
export const POST = handler<P>(async (c) => askAgent(requireSession(c).user.id, c.params.orgId, await c.body()));
