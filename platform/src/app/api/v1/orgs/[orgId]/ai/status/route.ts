import { handler, requireSession } from '@/server/http/route';
import { inOrg } from '@/server/ops/common';
import { aiAvailable, AI_MODEL, PROMPT_VERSION } from '@/server/ops/ai';

type P = { orgId: string };

export const GET = handler<P>(async (c) => inOrg(requireSession(c).user.id, c.params.orgId, 'ai.use', async () => ({ available: aiAvailable(), model: AI_MODEL, prompt_version: PROMPT_VERSION })));
