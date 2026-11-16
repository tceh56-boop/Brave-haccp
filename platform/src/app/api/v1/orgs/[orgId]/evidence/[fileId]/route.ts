import { NextResponse } from 'next/server';
import { handler, requireSession } from '@/server/http/route';
import { getEvidenceFile } from '@/server/ops/evidence';

type P = { orgId: string; fileId: string };

/** Файл доказательства: изображения — для просмотра, PDF и прочее — скачиванием; без исполнения содержимого. */
export const GET = handler<P>(async (c) => {
  const f = await getEvidenceFile(requireSession(c).user.id, c.params.orgId, c.params.fileId);
  const inline = f.mime.startsWith('image/') && f.mime !== 'image/heic';
  return new NextResponse(new Uint8Array(f.content), { headers: {
    'content-type': f.mime, 'content-length': String(f.size_bytes), 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox",
    'cache-control': 'private, max-age=3600', 'x-sha256': f.sha256,
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
  } });
});
