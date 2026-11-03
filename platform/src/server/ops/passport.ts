import { z } from 'zod';
import type { Tx } from '../db/pool';
import { Errors } from '../http/errors';
import { inOrg, parse, assertSiteAccess } from './common';
import { lotCard, expiryState, EXPIRY_LABEL, LOT_STATUS_LABEL } from './lots';

/**
 * Паспорт продукта (мастер-промт, раздел 2): одна партия — состав, версии документов на момент выпуска, происхождение
 * сырья до приёмки и поставщика, выпуск и контроль (ККТ, бракераж), маркировка, отклонения, отзывы, статус допуска.
 * Только чтение и только из зарегистрированных данных. Чего система не регистрирует (оборудование операции,
 * санитарная история участка) — показывается как «нет данных», а не придумывается.
 * Баланс и себестоимость — отдельно (lotEconomics), с правом cost.read.
 */

interface Origin { lot_id: string; parent_id: string | null; depth: number; link: string | null; quantity: number | null; unit: string | null; product: string; lot_no: string | null;
  status: string; receipt_id: string | null; document_no: string | null; document_date: string | null; received_at: string | null; supplier: string | null; supplier_inn: string | null;
  manufacturer: string | null; vsd_no: string | null; produced_by_order: string | null }

/** Назад по lot_links до партий приёмки (со всеми ветвями). */
async function origins(tx: Tx, orgId: string, lotId: string): Promise<Origin[]> {
  return (await tx.query(`with recursive up(lot_id, child_id, link, quantity, unit, depth, path) as (
      select $1::uuid, null::uuid, null::text, null::numeric, null::text, 0, array[$1::uuid]
      union all
      select k.parent_lot_id, up.lot_id, k.kind, k.quantity, k.unit, up.depth + 1, up.path || k.parent_lot_id
        from lot_links k join up on k.child_lot_id = up.lot_id where not k.parent_lot_id = any(up.path) and up.depth < 30)
    select up.lot_id, up.child_id as parent_id, up.depth, up.link, up.quantity::float8 as quantity, up.unit, p.name as product, l.lot_no, l.status,
      r.id as receipt_id, r.document_no, r.document_date, r.completed_at as received_at, sp.name as supplier, sp.inn as supplier_inn, rl.manufacturer, rl.vsd_no,
      (select o.id from production_orders o where o.output_lot_id = l.id) as produced_by_order
    from up join lots l on l.id = up.lot_id and l.organization_id = $2 join products p on p.id = l.product_id
      left join receipt_lines rl on rl.id = l.receipt_line_id left join receipts r on r.id = rl.receipt_id left join suppliers sp on sp.id = r.supplier_id
    order by up.depth, p.name`, [lotId, orgId])).rows;
}

/** Действовавшая на момент t версия документа (последняя утверждённая не позднее t). */
async function versionAt(tx: Tx, sql: string, params: unknown[]) {
  return (await tx.query(sql, params)).rows[0] || null;
}

export async function productPassport(userId: string, orgId: string, lotId: string) {
  return inOrg(userId, orgId, 'trace.read', async (tx, m) => {
    const id = parse(z.uuid(), lotId);
    const l = (await tx.query(`select l.*, p.name as product, p.opened_shelf_hours, p.opened_shelf_basis, s.name as site_name from lots l join products p on p.id = l.product_id
      join sites s on s.id = l.site_id where l.id = $1 and l.organization_id = $2`, [id, orgId])).rows[0];
    if (!l) throw Errors.notFound('Партия не найдена.');
    assertSiteAccess(m, l.site_id);
    const card = await lotCard(tx, orgId, l);
    const tree = await origins(tx, orgId, id);
    const rootProduce = tree.find((x) => x.produced_by_order);

    // выпуск: задание, ТТК, контроль, бракераж, факт против нормы
    let production: Record<string, unknown> | null = null, documents: Record<string, unknown> | null = null;
    if (rootProduce) {
      const o = (await tx.query(`select o.*, d.name as dish, d.id as dish_id, v.version as ttk_version, v.approved_at as ttk_approved_at, au.full_name as ttk_approved_by,
          cu.full_name as completed_by_name, su.full_name as started_by_name, asu.full_name as assessed_by_name, st.name as site
        from production_orders o join dishes d on d.id = o.dish_id join ttk_versions v on v.id = o.ttk_version_id left join users au on au.id = v.approved_by
          left join users cu on cu.id = o.completed_by left join users su on su.id = o.started_by left join users asu on asu.id = o.assessed_by join sites st on st.id = o.site_id
        where o.id = $1`, [rootProduce.produced_by_order])).rows[0];
      const checks = (await tx.query(`select rc.name, rc.unit, rc.min_value, rc.max_value, rc.basis, c.value::float8 as value, c.ok, c.recorded_at, u.full_name as recorded_by
        from production_checks c join release_checks rc on rc.id = c.check_id join users u on u.id = c.recorded_by where c.order_id = $1 order by c.recorded_at`, [o.id])).rows;
      production = {
        order_id: o.id, dish_id: o.dish_id, dish: o.dish, site: o.site, planned_kg: Number(o.planned_g) / 1000, actual_kg: o.actual_g === null ? null : Number(o.actual_g) / 1000,
        started_at: o.started_at, started_by: o.started_by_name, completed_at: o.completed_at, completed_by: o.completed_by_name,
        organoleptic: o.organoleptic, release_decision: o.release_decision, assessed_by: o.assessed_by_name, checks, deviation: o.consumption_deviation,
        equipment: null, workstation: null,                                     // не регистрируется до этапов 2 и 4
      };
      // состав по ТТК выпуска (для п/ф карточка партии состав не показывает)
      if (!card.composition) {
        card.composition = (await tx.query(`select coalesce(p.name, d.name, l.name_raw) as name from ttk_lines l left join products p on p.id = l.product_id left join dishes d on d.id = l.sub_dish_id
          where l.version_id = $1 and l.kind = 'item' order by l.position`, [o.ttk_version_id])).rows.map((r) => r.name as string);
      }
      const at = o.completed_at;
      documents = {
        ttk: { version: o.ttk_version, approved_at: o.ttk_approved_at, approved_by: o.ttk_approved_by },
        tu: await versionAt(tx, `select version, designation, approved_at from tech_spec_versions where dish_id = $1 and approved_at <= $2 order by version desc limit 1`, [o.dish_id, at]),
        ti: await versionAt(tx, `select version, designation, approved_at from ti_versions where dish_id = $1 and approved_at <= $2 order by version desc limit 1`, [o.dish_id, at]),
        ppk: await versionAt(tx, `select version, approved_at from ppk_versions where organization_id = $1 and approved_at <= $2 order by version desc limit 1`, [orgId, at]),
        haccp: await versionAt(tx, `select version, approved_at from haccp_plans where organization_id = $1 and status = 'approved' and approved_at <= $2 order by version desc limit 1`, [orgId, at])
          ?? await versionAt(tx, `select version, approved_at from haccp_plans where organization_id = $1 and approved_at is not null and approved_at <= $2 order by version desc limit 1`, [orgId, at]),
      };
    }

    const labels = (await tx.query(`select lb.code, lb.kind, lb.created_at, (select coalesce(sum(copies), 0)::int from label_prints p where p.label_id = lb.id) as printed
      from labels lb where lb.lot_id = $1 order by lb.created_at`, [id])).rows;
    const lotIds = tree.map((x) => x.lot_id);
    const incidents = (await tx.query(`select id, title, severity, status, created_at from incidents where organization_id = $1
      and ((entity_type = 'lot' and entity_id = any($2::uuid[])) or (entity_type = 'production_order' and entity_id = $3::uuid)) order by created_at`,
    [orgId, lotIds, production?.order_id ?? null])).rows;
    const recalls = (await tx.query(`select distinct r.id, r.status, r.hazard, r.decision, r.opened_at from recalls r join recall_lots rl on rl.recall_id = r.id
      where rl.lot_id = any($1::uuid[]) order by r.opened_at`, [lotIds])).rows;

    // статус допуска — только из зарегистрированных фактов
    const st = expiryState(l);
    const reasons: string[] = [];
    if (l.status !== 'available') reasons.push(`статус партии: ${LOT_STATUS_LABEL[l.status].toLowerCase()}${l.status_reason ? ` — ${l.status_reason}` : ''}`);
    if (st === 'expired') reasons.push('истёк срок годности');
    if (st === 'unconfirmed') reasons.push('срок годности не подтверждён');
    if (production?.release_decision === 'rejected') reasons.push('бракераж: не допущено');
    if (recalls.some((r) => r.status === 'open')) reasons.push('партия цепочки в открытом отзыве');
    if (production && (production.checks as { ok: boolean }[]).some((c) => !c.ok) && !(production.checks as { ok: boolean }[]).slice(-1)[0]?.ok) reasons.push('последний замер ККТ вне предела');
    const missing: string[] = [];
    if (tree.some((x) => x.depth > 0 && !x.produced_by_order && !x.receipt_id && x.link !== 'opened' && x.link !== 'transfer')) missing.push('у части исходных партий нет приёмки');
    if (!tree.some((x) => x.receipt_id) && !rootProduce) missing.push('нет документа приёмки');
    if (rootProduce && !documents?.tu) missing.push('ТУ на продукт не утверждены (если ТУ требуются)');
    missing.push('оборудование и участок операции не регистрируются (этапы 2 и 4)', 'санитарная история участка не связана с выпуском (этап 2)');

    return {
      lot: { id: l.id, product: l.product, lot_no: l.lot_no, quantity: Number(l.quantity), unit: l.unit, site: l.site_name, status: l.status, status_label: LOT_STATUS_LABEL[l.status],
        manufactured_at: l.manufactured_at, expires_at: l.expires_at, expiry_basis: l.expiry_basis, expiry_state: st, expiry_label: EXPIRY_LABEL[st], opened_at: l.opened_at },
      admission: { allowed: reasons.length === 0, reasons },
      card, production, documents, origins: tree, labels, incidents, recalls, missing,
      generated_at: new Date().toISOString(),
    };
  });
}
