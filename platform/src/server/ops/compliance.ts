import { z } from 'zod';
import { inOrg, parse, getSite, assertSiteAccess } from './common';
import { CLAUSES, DOCS, FEATURES, applies, type NormProfile } from '../norms/library';
import { runCheck, type CheckStatus } from '../norms/checks';
import { contextFor } from '../readiness/engine';

/**
 * «Готов ли я к проверке»: все требования встроенной нормативной библиотеки, применимые к предприятию по его профилю,
 * с результатом проверки по данным системы. Каждый пункт — дословный текст и ссылка «документ, пункт»;
 * нарушение — с тем, что именно не так и где исправить. Пункты, которые по данным не проверить, — «проверить на месте».
 */

export type ItemStatus = CheckStatus | 'onsite';
interface Item { id: string; doc: string; doc_kind: string; clause: string; title: string; text: string; applies_note: string | null; status: ItemStatus; detail: string; href?: string | null; items?: string[] }

export async function getCompliance(userId: string, orgId: string, siteIdInput?: unknown) {
  const siteId = siteIdInput ? parse(z.uuid(), siteIdInput) : null;
  return inOrg(userId, orgId, 'org.read', async (tx, m) => {
    if (siteId) { await getSite(tx, orgId, siteId); assertSiteAccess(m, siteId); }
    const sites = (await tx.query(`select id from sites where organization_id = $1 and status = 'active' and ($2::uuid is null or id = $2)`, [orgId, siteId])).rows
      .map((s) => s.id).filter((id) => !m.site_ids.length || m.site_ids.includes(id));
    const pr = (await tx.query(`select 1 from org_regulatory_profiles where organization_id = $1`, [orgId])).rows[0];
    const ctx = await contextFor(tx, orgId, sites);
    const { today, profile } = ctx;
    const items: Item[] = [];
    const notApplicable: Omit<Item, 'status' | 'detail'>[] = [];
    for (const c of CLAUSES) {
      const reg = DOCS[c.doc].region;
      const note = [c.appliesNote, reg && `территориальное разъяснение (${reg.subject}) — справочно, только для предприятий этого субъекта`].filter(Boolean).join('; ');
      const head = { id: c.id, doc: DOCS[c.doc].code, doc_kind: DOCS[c.doc].kind, clause: c.clause, title: c.title, text: c.text, applies_note: note || null };
      if (!applies(c, profile)) { notApplicable.push(head); continue; }
      if (!c.check) { items.push({ ...head, status: 'onsite' as ItemStatus, detail: 'Проверяется на месте: по записям системы не подтвердить. Проверьте сами и устраните, если не выполнено.' }); continue; }
      const r = await runCheck(c.check, ctx);
      items.push({ ...head, status: r.status as ItemStatus, detail: r.detail, href: r.href || null, items: r.items || [] });
    }
    const count = (s: ItemStatus) => items.filter((i) => i.status === s).length;
    return {
      today, profile, profile_set: !!pr, features: FEATURES,
      docs: Object.values(DOCS).map((d) => ({ code: d.code, kind: d.kind, title: d.title, issued: d.issued, effective_from: d.effectiveFrom, effective_to: d.effectiveTo, edition: d.edition })),
      summary: { fail: count('fail'), warn: count('warn'), ok: count('ok'), onsite: count('onsite'), na: notApplicable.length },
      items: items.sort((a, b) => order(a.status) - order(b.status)), not_applicable: notApplicable,
    };
  });
}

const order = (s: ItemStatus) => ({ fail: 0, warn: 1, onsite: 2, ok: 3 })[s];
