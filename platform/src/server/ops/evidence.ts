import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import type { Membership } from '../access/guard';
import { inOrg, parse, optText, assertSiteAccess } from './common';

/**
 * Доказательства (ТЗ v2 §5, §12): фото и документы к записи — приёмке, партии, замеру, отклонению, CAPA, этапу
 * ХАССП, записи журнала, редакции норматива. Файл неизменяем, хранится с SHA-256; удалить или подменить нельзя,
 * можно только добавить новый. Тип файла проверяется по содержимому, а не по имени.
 */

export const MAX_BYTES = 10 * 1024 * 1024;

const ENTITY: Record<string, { table: string; site: string | null }> = {
  incident: { table: 'incidents', site: 'site_id' },
  capa: { table: 'capas', site: 'site_id' },
  receipt: { table: 'receipts', site: 'site_id' },
  lot: { table: 'lots', site: 'site_id' },
  measurement: { table: 'measurements', site: 'site_id' },
  journal_entry: { table: 'journal_entries', site: 'site_id' },
  haccp_step: { table: 'haccp_steps', site: null },
  haccp_hazard: { table: 'haccp_hazards', site: null },
  reg_version: { table: 'reg_source_versions', site: null },
  lab_result: { table: 'lab_results', site: 'site_id' },
  equipment: { table: 'equipment', site: 'site_id' },
  equipment_event: { table: 'equipment_events', site: 'site_id' },
};
export const ENTITY_LABEL: Record<string, string> = {
  incident: 'Отклонение', capa: 'CAPA', receipt: 'Приёмка', lot: 'Партия', measurement: 'Замер', journal_entry: 'Запись журнала',
  haccp_step: 'Этап ХАССП', haccp_hazard: 'Опасность ХАССП', reg_version: 'Редакция норматива', lab_result: 'Лабораторное исследование', equipment: 'Оборудование', equipment_event: 'ТО / поверка / ремонт',
};

/** Тип по сигнатуре файла. */
export function sniff(b: Buffer): string | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (b.length >= 12 && b.subarray(4, 8).toString('latin1') === 'ftyp' && /^(heic|heix|mif1|msf1)$/.test(b.subarray(8, 12).toString('latin1'))) return 'image/heic';
  return null;
}

async function entitySite(tx: Tx, orgId: string, m: Membership, type: string, id: string): Promise<string | null> {
  const e = ENTITY[type];
  if (!e) throw Errors.validation('К этой записи доказательства не прикрепляются.');
  const r = (await tx.query(`select ${e.site ? `${e.site} as site_id` : 'null::uuid as site_id'} from ${e.table} where id = $1 and organization_id = $2`, [id, orgId])).rows[0];
  if (!r) throw Errors.notFound('Запись не найдена.');
  if (r.site_id) assertSiteAccess(m, r.site_id);
  return r.site_id;
}

const AddInput = z.object({
  entityType: z.string(), entityId: z.uuid(),
  filename: z.string().trim().min(1).max(200).transform((s) => s.replace(/[\\/\r\n\0"]/g, '_')),
  note: optText(500),
});

export async function addEvidence(userId: string, orgId: string, input: unknown, bytes: Buffer) {
  const d = parse(AddInput, input);
  if (!bytes.length) throw Errors.validation('Файл пустой.');
  if (bytes.length > MAX_BYTES) throw Errors.validation('Файл больше 10 МБ — уменьшите фото или разделите документ.');
  const mime = sniff(bytes);
  if (!mime) throw Errors.validation('Поддерживаются фото (JPEG, PNG, WebP, HEIC) и PDF.');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return inOrg(userId, orgId, 'evidence.add', async (tx, m) => {
    const siteId = await entitySite(tx, orgId, m, d.entityType, d.entityId);
    const dup = (await tx.query(`select id from evidence_files where organization_id = $1 and entity_type = $2 and entity_id = $3 and sha256 = $4`, [orgId, d.entityType, d.entityId, sha256])).rows[0];
    if (dup) return { id: dup.id, sha256, duplicate: true };
    const f = (await tx.query(`insert into evidence_files (organization_id, site_id, entity_type, entity_id, filename, mime, size_bytes, sha256, content, note, uploaded_by)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`, [orgId, siteId, d.entityType, d.entityId, d.filename, mime, bytes.length, sha256, bytes, d.note, userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId, actorUserId: userId, action: 'evidence.add', entityType: d.entityType, entityId: d.entityId,
      after: { evidence_id: f.id, filename: d.filename, mime, size: bytes.length, sha256 } });
    return { id: f.id, sha256, duplicate: false };
  });
}

export async function listEvidence(userId: string, orgId: string, entityType: string, entityId: unknown) {
  const id = parse(z.uuid(), entityId);
  return inOrg(userId, orgId, 'evidence.read', async (tx, m) => {
    await entitySite(tx, orgId, m, entityType, id);
    return (await tx.query(`select f.id, f.filename, f.mime, f.size_bytes, f.sha256, f.note, f.uploaded_at, u.full_name as uploaded_by_name
      from evidence_files f join users u on u.id = f.uploaded_by where f.organization_id = $1 and f.entity_type = $2 and f.entity_id = $3 order by f.uploaded_at`, [orgId, entityType, id])).rows;
  });
}

export async function getEvidenceFile(userId: string, orgId: string, fileId: unknown) {
  const id = parse(z.uuid(), fileId);
  return inOrg(userId, orgId, 'evidence.read', async (tx, m) => {
    const f = (await tx.query(`select * from evidence_files where id = $1 and organization_id = $2`, [id, orgId])).rows[0];
    if (!f) throw Errors.notFound('Файл не найден.');
    if (f.site_id) assertSiteAccess(m, f.site_id);
    return f as { id: string; filename: string; mime: string; size_bytes: number; sha256: string; content: Buffer; entity_type: string; entity_id: string };
  });
}
