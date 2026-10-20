import { handler } from '@/server/http/route';
import { verifyEmail } from '@/server/identity/auth';

export const POST = handler(async (c) => verifyEmail(((await c.body()) as { token?: unknown })?.token), { auth: false });
