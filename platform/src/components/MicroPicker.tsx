'use client';
import { MICRO_GROUPS, MICRO_INDICATORS, resolveMicro } from '@/server/norms/micro';

export interface MicroValue { microGroupCode: string; micro: Record<string, string>; microIndex: string }

/**
 * Микробиологические показатели: выбор группы продукции ТР ТС 021/2011 — значения подставляются из регламента и
 * вручную не меняются. «Другая группа» — для продукции вне п. 1.8: значения и основание вводит технолог.
 * inherited — группа из папки (если у блюда своя не задана).
 */
export function MicroPicker({ value, onChange, dishName, inherited }: { value: MicroValue; onChange: (v: MicroValue) => void; dishName?: string; inherited?: { code: string | null; from: string } | null }) {
  const effective = value.microGroupCode || inherited?.code || '';
  const r = resolveMicro({ microGroupCode: effective || null, micro: effective === 'custom' || !effective ? value.micro : {}, microIndex: value.microIndex }, dishName || '');
  const sug = !effective && r.suggested;
  return (
    <div>
      <label htmlFor="mg">Группа продукции по ТР ТС 021/2011 (прил. 2, п. 1.8)</label>
      <select id="mg" value={value.microGroupCode} onChange={(e) => onChange({ ...value, microGroupCode: e.target.value })}>
        <option value="">{inherited?.code ? `из папки «${inherited.from}»: ${MICRO_GROUPS.find((g) => g.code === inherited.code)?.name || 'своя группа'}` : '— не выбрана —'}</option>
        {MICRO_GROUPS.map((g) => <option key={g.code} value={g.code}>{g.name}</option>)}
        <option value="custom">Другая группа — значения вводит технолог со ссылкой на документ</option>
      </select>
      {sug && (
        <div className="note small" style={{ marginTop: 6 }}>Система предлагает: <b>{r.suggested!.name}</b>.{' '}
          <button type="button" className="btn small" onClick={() => onChange({ ...value, microGroupCode: r.suggested!.code })}>Подтвердить</button></div>)}
      {effective === 'custom' ? (
        <>
          <label htmlFor="mi">Документ и группа (основание)</label>
          <input id="mi" value={value.microIndex} onChange={(e) => onChange({ ...value, microIndex: e.target.value })} placeholder="ТР ТС 021/2011, прил. 2, табл. 1, п. … «…»" />
          {MICRO_INDICATORS.map((m) => (
            <div key={m.code}><label htmlFor={`mc-${m.code}`}>{m.name} <span className="muted">· {m.method}</span></label>
              <input id={`mc-${m.code}`} value={value.micro[m.code] || ''} onChange={(e) => onChange({ ...value, micro: { ...value.micro, [m.code]: e.target.value } })} placeholder="значение из регламента или «не нормируется»" /></div>))}
        </>
      ) : effective || sug ? (
        <div className="scroll" style={{ marginTop: 6 }}>
          <table className="tbl small"><thead><tr><th>Показатель</th><th>Норматив</th></tr></thead>
            <tbody>{r.indicators.map((m) => <tr key={m.code}><td>{m.name}</td><td>{m.norm || <span className="muted">не нормируется</span>}</td></tr>)}</tbody></table>
          <p className="small muted">{sug ? 'Предложение — действует после подтверждения. ' : ''}Значения — {r.index || 'ТР ТС 021/2011'}.{r.note ? ` ${r.note}` : ''}</p>
        </div>
      ) : null}
    </div>
  );
}
