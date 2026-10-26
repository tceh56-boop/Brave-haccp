'use client';
import { useState } from 'react';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { n } from '@/lib/fmt';

export interface Prod { id: string; name: string; nutrition: { protein: number; fat: number; carbs: number; verified: boolean; source: string; dry_matter?: number | null; sucrose?: number | null; fat_mass?: number | null } | null;
  allergens: string[] | null; suggest: string[] }

/** Сырьё: пищевая ценность и профиль аллергенов по документу (новая запись заменяет прежнюю, история сохраняется). */
export function Ingredients({ products, allergenList, label, manage, onDone }: { products: Prod[]; allergenList: { code: string; label: string }[]; label: (c: string) => string; manage: boolean; onDone: () => void }) {
  const { org } = useOrg();
  const [edit, setEdit] = useState<string | null>(null);
  const [nu, setNu] = useState({ kcal: '', protein: '', fat: '', carbs: '', dryMatter: '', sucrose: '', fatMass: '', basis: '' });
  const [al, setAl] = useState<{ list: string[]; basis: string }>({ list: [], basis: '' });
  const { busy, error, run } = useSubmit();
  return (
    <div className="card">
      <h2>Сырьё: данные по документам</h2>
      <ul className="list">{products.map((x) => (
        <li key={x.id}>
          <div className="between"><b>{x.name}</b>{manage && edit !== x.id && <button className="linkbtn small" onClick={() => {
            const o = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
            setEdit(x.id); setNu({ kcal: '', protein: o(x.nutrition?.protein), fat: o(x.nutrition?.fat), carbs: o(x.nutrition?.carbs), dryMatter: o(x.nutrition?.dry_matter), sucrose: o(x.nutrition?.sucrose), fatMass: o(x.nutrition?.fat_mass), basis: '' });
            setAl({ list: x.allergens ?? x.suggest, basis: '' });
          }}>внести по документу</button>}</div>
          <div className="small">{x.nutrition ? <>Б {n(x.nutrition.protein)} · Ж {n(x.nutrition.fat)} · У {n(x.nutrition.carbs)} на 100 г — {x.nutrition.verified ? <span className="badge ok">по документу</span> : <span className="badge warn">не проверено</span>} <span className="muted">{x.nutrition.source}</span>
            {(x.nutrition.dry_matter != null || x.nutrition.sucrose != null || x.nutrition.fat_mass != null) && <div className="muted">{[x.nutrition.dry_matter != null && `сухие в-ва ${n(x.nutrition.dry_matter)}`, x.nutrition.sucrose != null && `сахароза ${n(x.nutrition.sucrose)}`, x.nutrition.fat_mass != null && `массовая доля жира ${n(x.nutrition.fat_mass)}`].filter(Boolean).join(' · ')} г на 100 г</div>}</> : <span className="badge crit">нет пищевой ценности</span>}</div>
          <div className="small">Аллергены: {x.allergens === null ? <span className="badge warn">профиля нет</span> : x.allergens.length ? x.allergens.map(label).join(', ') : 'не содержит'}
            {x.allergens === null && x.suggest.length > 0 && <span className="muted"> · по названию проверьте: {x.suggest.map(label).join(', ')}</span>}</div>
          {edit === x.id && (
            <div style={{ marginTop: 8 }}>
              <form onSubmit={(e) => { e.preventDefault(); run(async () => { const opt = (v: string) => (v.trim() ? v : null);
                await api(`/orgs/${org.id}/products/${x.id}/nutrition`, { body: { ...nu, dryMatter: opt(nu.dryMatter), sucrose: opt(nu.sucrose), fatMass: opt(nu.fatMass) } }); onDone(); }); }}>
                <h3>Пищевая ценность на 100 г</h3>
                <div className="grid2">
                  {(['kcal', 'protein', 'fat', 'carbs'] as const).map((k) => <div key={k}><label htmlFor={`${k}-${x.id}`}>{({ kcal: 'ккал', protein: 'Белки, г', fat: 'Жиры, г', carbs: 'Углеводы, г' })[k]}</label>
                    <input id={`${k}-${x.id}`} inputMode="decimal" required value={nu[k]} onChange={(e) => setNu({ ...nu, [k]: e.target.value })} /></div>)}
                </div>
                <p className="small muted" style={{ marginBottom: 0 }}>Для физико-химических показателей ТТК (если есть в документе или справочнике химического состава): сухие вещества = 100 − вода;
                  сахароза — для сахара, сиропов, карамели; массовая доля жира — для масел, майонезов, молочных продуктов.</p>
                <div className="grid2">
                  {(['dryMatter', 'sucrose', 'fatMass'] as const).map((k) => <div key={k}><label htmlFor={`${k}-${x.id}`}>{({ dryMatter: 'Сухие вещества, г', sucrose: 'Сахароза, г', fatMass: 'Массовая доля жира, г' })[k]}</label>
                    <input id={`${k}-${x.id}`} inputMode="decimal" value={nu[k]} onChange={(e) => setNu({ ...nu, [k]: e.target.value })} /></div>)}
                </div>
                <label htmlFor={`nb-${x.id}`}>Документ</label><input id={`nb-${x.id}`} required value={nu.basis} onChange={(e) => setNu({ ...nu, basis: e.target.value })} placeholder="маркировка изготовителя, удостоверение качества" />
                <button className="btn small" style={{ marginTop: 8 }} disabled={busy}>Сохранить пищевую ценность</button>
              </form>
              <form style={{ marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/orgs/${org.id}/products/${x.id}/allergens`, { body: { allergens: al.list, basis: al.basis } }); setEdit(null); onDone(); }); }}>
                <h3>Аллергены (отметьте, что содержит)</h3>
                <div className="chips">{allergenList.map((a) => <button type="button" key={a.code} aria-pressed={al.list.includes(a.code)} onClick={() => setAl({ ...al, list: al.list.includes(a.code) ? al.list.filter((c) => c !== a.code) : [...al.list, a.code] })}>{a.label}</button>)}</div>
                <label htmlFor={`ab-${x.id}`}>Документ</label><input id={`ab-${x.id}`} required value={al.basis} onChange={(e) => setAl({ ...al, basis: e.target.value })} placeholder="состав на маркировке, спецификация поставщика" />
                <div className="row" style={{ marginTop: 8 }}><button className="btn small" disabled={busy}>Сохранить профиль аллергенов</button><button type="button" className="btn small secondary" onClick={() => setEdit(null)}>Закрыть</button></div>
                <p className="small muted">Ничего не отмечено — «не содержит ни одного аллергена из перечня» (тоже по документу).</p>
              </form>
              {error && <div className="err">{error}</div>}
            </div>
          )}
        </li>))}</ul>
    </div>
  );
}

