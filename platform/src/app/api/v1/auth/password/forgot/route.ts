import { handler } from '@/server/http/route';
import { requestPasswordReset } from '@/server/identity/auth';

export const POST = handler(async (c) => requestPasswordReset(await c.body()), { auth: false });
