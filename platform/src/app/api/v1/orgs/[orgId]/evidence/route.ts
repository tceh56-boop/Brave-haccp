import { handler, requireSession } from '@/server/http/route';
import { addEvidence, listEvidence, MAX_BYTES } from '@/server/ops/evidence';
import { Errors } from '@/server/http/errors';

type P = { orgId: string };

export const GET = handler<P>(async (c) => {
  const q = c.req.nextUrl.searchParams;
  return listEvidence(requireSession(c).user.id, c.params.orgId, q.get('entityType') || '', q.get('entityId'));
});

/** multipart/form-data: file, entityType, entityId, note. */
export const POST = handler<P>(async (c) => {
  const userId = requireSession(c).user.id;
  if (Number(c.req.headers.get('content-length') || 0) > MAX_BYTES + 64 * 1024) throw Errors.validation('Файл больше 10 МБ — уменьшите фото или разделите документ.');
  let form: FormData;
  try { form = await c.req.formData(); } catch { throw Errors.validation('Ожидается файл.'); }
  const file = form.get('file');
  if (!(file instanceof File)) throw Errors.validation('Выберите файл.');
  const bytes = Buffer.from(await file.arrayBuffer());
  return addEvidence(userId, c.params.orgId, { entityType: form.get('entityType'), entityId: form.get('entityId'), note: form.get('note') || null, filename: file.name || 'файл' }, bytes);
});
