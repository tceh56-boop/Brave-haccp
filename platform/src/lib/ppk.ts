/** Программа производственного контроля — формы данных клиента (сервер: server/ops/ppk.ts). */
export interface PpkLine { text: string; basis: string[]; gap?: string | null; href?: string | null }
export interface PpkSection { no: number; title: string; lines: PpkLine[]; table?: { head: string[]; rows: string[][] } | null }
export interface PpkParams { responsibleUserId?: string | null; approverTitle?: string | null; city?: string | null; orderNo?: string | null }
export interface PpkDoc {
  org: { name: string; legal_form: string | null; inn: string | null; region: string | null };
  sites: { name: string; address: string | null }[];
  profile_text: string; params: PpkParams;
  responsible: { name: string; position: string | null } | null;
  sections: PpkSection[];
  docs: { code: string; title: string; issued: string; effective_to: string | null }[];
  basis: { id: string; doc: string; clause: string; text: string }[];
  gaps: { section: string; text: string; href: string | null }[];
}
export interface PpkVersion { version: number; change_note: string; approved_at: string; approved_by_name: string }

/** «СанПиН 2.3/2.4.4282-26, п. 35; ТР ТС 021/2011, ст. 15 ч. 2» */
export function refOf(d: PpkDoc, ids: string[]) {
  const m = new Map(d.basis.map((b) => [b.id, b]));
  return ids.map((id) => m.get(id)).filter(Boolean).map((b) => `${b!.doc}, ${b!.clause}`).join('; ');
}
