import { NextResponse } from 'next/server';
import { handler, requireSession } from '@/server/http/route';
import { buildPack } from '@/server/ops/pack';

type P = { orgId: string; siteId: string };

/** ?from&to — ZIP-пакет документов для проверки за период. */
export const GET = handler<P>(async (c) => {
  const q = c.req.nextUrl.searchParams;
  const r = await buildPack(requireSession(c).user.id, c.params.orgId, { siteId: c.params.siteId, from: q.get('from'), to: q.get('to') });
  return new NextResponse(new Uint8Array(r.archive), { headers: {
    'content-type': 'application/zip', 'x-sha256': r.sha256, 'cache-control': 'no-store',
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(r.filename)}`,
  } });
});
