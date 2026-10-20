import { handler } from '@/server/http/route';

export const GET = handler(async (c) => ({ user: c.session?.user || null }), { auth: false });
