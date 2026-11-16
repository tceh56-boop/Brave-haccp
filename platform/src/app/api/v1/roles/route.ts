import { handler } from '@/server/http/route';
import { ROLES, PERMISSIONS, MODULES } from '@/server/access/roles';

export const GET = handler(async () => ({
  roles: Object.entries(ROLES).map(([code, r]) => ({ code, label: r.label, summary: r.summary, permissions: r.permissions })),
  permissions: PERMISSIONS,
  modules: Object.entries(MODULES).map(([code, d]) => ({ code, label: d.label, summary: d.summary })),
}), { auth: false });
