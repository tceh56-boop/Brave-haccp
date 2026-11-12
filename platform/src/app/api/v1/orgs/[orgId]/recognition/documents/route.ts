import { handler, requireSession } from '@/server/http/route';
import { Errors } from '@/server/http/errors';
import { recognizeDocument } from '@/server/ops/recognition';

type P = { orgId: string };
const MAX_BYTES = 20 * 1024 * 1024;

/** multipart/form-data: siteId, receiptId?, kind, file (одно или несколько: лист 1, лист 2…). Платно — по страницам. */
export const POST = handler<P>(async (c) => {
  const userId = requireSession(c).user.id;
  if (Number(c.req.headers.get('content-length') || 0) > MAX_BYTES) throw Errors.validation('Файлы больше 20 МБ — уменьшите фото.');
  let form: FormData;
  try { form = await c.req.formData(); } catch { throw Errors.validation('Ожидаются файлы.'); }
  const files = [];
  for (const f of form.getAll('file')) if (f instanceof File) files.push({ bytes: Buffer.from(await f.arrayBuffer()), mimeType: f.type, name: f.name || 'файл' });
  return recognizeDocument(userId, c.params.orgId, { siteId: form.get('siteId'), receiptId: form.get('receiptId') || null, kind: form.get('kind') || 'torg12' }, files);
});
