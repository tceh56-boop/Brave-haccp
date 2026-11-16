import { handler } from '@/server/http/route';
import { resetPassword } from '@/server/identity/auth';

export const POST = handler(async (c) => resetPassword(await c.body()), { auth: false });
