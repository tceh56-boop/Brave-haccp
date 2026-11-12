import { handler, requireSession } from '@/server/http/route';
import { resendVerification } from '@/server/identity/auth';

export const POST = handler(async (c) => resendVerification(requireSession(c).user.id));
