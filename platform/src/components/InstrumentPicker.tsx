'use client';
import { useEffect, useState } from 'react';
import { useOrg } from '@/lib/org';
import { api } from '@/lib/api';

/**
 * Выбор прибора из реестра оборудования для замера (этап 15). Приборов на площадке нет — ничего не показывает.
 * Пригодный прибор один — выбирается сам. Прибор с истёкшей поверкой виден, но не выбирается (сервер его тоже не примет).
 */

interface Instrument { id: string; name: string; serial_no: string | null; usable: boolean; reason: string | null }

export function InstrumentPicker({ siteId, value, onChange, id = 'instr' }: { siteId: string | null | undefined; value: string; onChange: (v: string) => void; id?: string }) {
  const { org } = useOrg();
  const [list, setList] = useState<Instrument[]>([]);
  useEffect(() => {
    if (!siteId) return;
    api<Instrument[]>(`/orgs/${org.id}/equipment/instruments?siteId=${siteId}`).then((l) => {
      setList(l);
      const ok = l.filter((i) => i.usable);
      if (ok.length === 1) onChange(ok[0].id);
    }).catch(() => setList([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.id, siteId]);
  if (!list.length) return null;
  return (
    <>
      <label htmlFor={id}>Прибор</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— чем измеряли —</option>
        {list.map((i) => <option key={i.id} value={i.id} disabled={!i.usable}>{i.name}{i.serial_no ? ` № ${i.serial_no}` : ''}{i.usable ? '' : ` — ${i.reason}`}</option>)}
      </select>
    </>
  );
}
