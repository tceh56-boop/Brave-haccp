import { handler } from '@/server/http/route';
import { register } from '@/server/identity/auth';

export const POST = handler(async (c) => register(await c.body(), c.ip), { auth: false });
