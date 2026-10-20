import { handler } from '@/server/http/route';
import { ROLES, PERMISSIONS } from '@/server/access/roles';

export const GET = handler(async () => ({
  roles: Object.entries(ROLES).map(([code, r]) => ({ code, label: r.label, summary: r.summary, permissions: r.permissions })),
  permissions: PERMISSIONS,
}), { auth: false });
