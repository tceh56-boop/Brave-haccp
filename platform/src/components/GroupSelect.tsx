'use client';

export interface Group { id: string; parent_id: string | null; name: string; dishes: number; children: number; params?: Record<string, unknown> }

/** Плоский список папок деревом (с отступами) для выбора. exclude — папка и её потомки (нельзя переместить внутрь себя). */
export function flatTree(groups: Group[], exclude?: string) {
  const out: { id: string; label: string }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const g of groups.filter((x) => x.parent_id === parent)) {
      if (g.id === exclude) continue;
      out.push({ id: g.id, label: `${'  '.repeat(depth)}${depth ? '└ ' : ''}${g.name}` });
      walk(g.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function GroupSelect({ id, groups, value, onChange, exclude, empty = '— без папки —' }: { id: string; groups: Group[]; value: string; onChange: (v: string) => void; exclude?: string; empty?: string }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} style={{ whiteSpace: 'pre' }}>
      <option value="">{empty}</option>
      {flatTree(groups, exclude).map((g) => <option key={g.id} value={g.id}>{g.label.replace(/ /g, ' ')}</option>)}
    </select>
  );
}
