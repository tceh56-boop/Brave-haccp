/**
 * 2D-план предприятия: библиотека объектов, потоки, геометрия и поиск потенциальных рисков.
 * Общая для сервера и редактора (чистые функции, без зависимостей). Геометрия — в миллиметрах:
 * объект — прямоугольник с центром (x, y), размерами (w, h) и поворотом в градусах; маршрут — ломаная.
 * Размеры по умолчанию — условные заготовки для рисования: пока габарит не подтверждён по паспорту или замеру,
 * объект помечен «размер не подтверждён». Найденный риск — потенциальный: применимость подтверждает специалист.
 */

export type Layer = 'rooms' | 'building' | 'zones' | 'equipment' | 'engineering';
export interface KindDef { label: string; layer: Layer; w: number; h: number; solid: boolean; fill: string }

export const KINDS: Record<string, KindDef> = {
  room: { label: 'Помещение', layer: 'rooms', w: 6000, h: 4000, solid: false, fill: '#fbf7ef' },
  wall: { label: 'Стена', layer: 'building', w: 3000, h: 120, solid: true, fill: '#5b4a3a' },
  column: { label: 'Колонна', layer: 'building', w: 400, h: 400, solid: true, fill: '#5b4a3a' },
  door: { label: 'Дверь', layer: 'building', w: 900, h: 120, solid: false, fill: '#d9a441' },
  window: { label: 'Окно', layer: 'building', w: 1200, h: 120, solid: false, fill: '#9cc3d5' },
  zone: { label: 'Зона', layer: 'zones', w: 3000, h: 2000, solid: false, fill: 'transparent' },
  passage: { label: 'Проход', layer: 'zones', w: 1200, h: 3000, solid: false, fill: 'transparent' },
  table: { label: 'Производственный стол', layer: 'equipment', w: 1200, h: 600, solid: true, fill: '#e6dccb' },
  sink: { label: 'Мойка', layer: 'equipment', w: 600, h: 600, solid: true, fill: '#cfe3ec' },
  sink2: { label: 'Мойка 2-секционная', layer: 'equipment', w: 1200, h: 600, solid: true, fill: '#cfe3ec' },
  bath: { label: 'Моечная ванна', layer: 'equipment', w: 1000, h: 600, solid: true, fill: '#cfe3ec' },
  handwash: { label: 'Раковина для рук', layer: 'equipment', w: 450, h: 400, solid: true, fill: '#cfe3ec' },
  rack: { label: 'Стеллаж', layer: 'equipment', w: 1000, h: 500, solid: true, fill: '#e6dccb' },
  fridge: { label: 'Холодильный шкаф', layer: 'equipment', w: 700, h: 800, solid: true, fill: '#dbe8f3' },
  freezer: { label: 'Морозильный шкаф', layer: 'equipment', w: 700, h: 800, solid: true, fill: '#c9dcef' },
  chestfreezer: { label: 'Ларь морозильный', layer: 'equipment', w: 1600, h: 650, solid: true, fill: '#c9dcef' },
  coldroom: { label: 'Холодильная камера', layer: 'equipment', w: 2000, h: 2000, solid: true, fill: '#dbe8f3' },
  stove: { label: 'Плита', layer: 'equipment', w: 800, h: 700, solid: true, fill: '#f0d0c0' },
  oven: { label: 'Печь / жарочный шкаф', layer: 'equipment', w: 900, h: 800, solid: true, fill: '#f0d0c0' },
  combi: { label: 'Пароконвектомат', layer: 'equipment', w: 900, h: 800, solid: true, fill: '#f0d0c0' },
  fryer: { label: 'Фритюрница', layer: 'equipment', w: 400, h: 700, solid: true, fill: '#f0d0c0' },
  vacuum: { label: 'Вакуумный упаковщик', layer: 'equipment', w: 600, h: 500, solid: true, fill: '#e3dcef' },
  sousvide: { label: 'Су-вид (термостат, ванна)', layer: 'equipment', w: 600, h: 400, solid: true, fill: '#e3dcef' },
  blastchiller: { label: 'Шкаф шоковой заморозки', layer: 'equipment', w: 800, h: 800, solid: true, fill: '#c9dcef' },
  packing: { label: 'Упаковка / фасовка', layer: 'equipment', w: 1200, h: 700, solid: true, fill: '#e3dcef' },
  dishwasher: { label: 'Посудомоечная машина', layer: 'equipment', w: 700, h: 700, solid: true, fill: '#cfe3ec' },
  chemicals: { label: 'Хранение химии', layer: 'equipment', w: 800, h: 500, solid: true, fill: '#f3d6d6' },
  waste: { label: 'Отходы', layer: 'equipment', w: 600, h: 600, solid: true, fill: '#d9d2c5' },
  other: { label: 'Другое оборудование', layer: 'equipment', w: 800, h: 600, solid: true, fill: '#eee5d6' },
  water: { label: 'Вода (подвод)', layer: 'engineering', w: 200, h: 200, solid: false, fill: '#4a90b8' },
  drain: { label: 'Слив / трап', layer: 'engineering', w: 200, h: 200, solid: false, fill: '#2f6d8c' },
  vent: { label: 'Вентиляция (зонт)', layer: 'engineering', w: 1200, h: 800, solid: false, fill: 'transparent' },
  power: { label: 'Электрощит / розетка', layer: 'engineering', w: 200, h: 200, solid: false, fill: '#c8a03c' },
};

export const LAYERS: Record<Layer, string> = { rooms: 'Помещения', building: 'Стены, двери, окна', zones: 'Зоны и проходы', equipment: 'Оборудование и мебель', engineering: 'Инженерные системы' };

/** Назначение зоны (помещения, участка): от него зависят проверки потоков. */
export const ZONE_CLASS: Record<string, { label: string; color: string }> = {
  raw: { label: 'Сырьё', color: '#c0392b' }, semi: { label: 'Полуфабрикаты', color: '#e67e22' }, ready: { label: 'Готовая продукция', color: '#27ae60' },
  waste: { label: 'Отходы', color: '#6d5d4b' }, clean: { label: 'Чистый инвентарь / посуда', color: '#2980b9' }, dirty: { label: 'Грязный инвентарь / посуда', color: '#7f8c8d' },
  chemicals: { label: 'Химия', color: '#8e44ad' }, staff: { label: 'Персонал (бытовые)', color: '#16a085' }, storage: { label: 'Склад', color: '#a67c52' },
};

export const FLOWS: Record<string, { label: string; color: string; dash?: string }> = {
  raw: { label: 'Сырьё', color: '#c0392b' }, semi: { label: 'Полуфабрикаты', color: '#e67e22' }, ready: { label: 'Готовая продукция', color: '#27ae60' },
  staff: { label: 'Персонал', color: '#16a085', dash: '6 4' }, clean_inventory: { label: 'Чистый инвентарь', color: '#2980b9' },
  dirty_inventory: { label: 'Грязный инвентарь', color: '#7f8c8d' }, waste: { label: 'Отходы', color: '#6d5d4b', dash: '10 4' },
  return_tare: { label: 'Возвратная тара', color: '#95a5a6', dash: '2 4' }, allergen: { label: 'Аллергены', color: '#8e44ad', dash: '8 3 2 3' },
};

/**
 * Пары потоков, пересечение которых — потенциальный риск перекрёстного загрязнения (принцип поточности:
 * «чистое» не пересекается с «грязным», сырьё — с готовым). Применимость к объекту подтверждает специалист.
 */
export const FLOW_CONFLICTS: [string, string, string][] = [
  ['raw', 'ready', 'Сырьё пересекает путь готовой продукции'],
  ['waste', 'ready', 'Отходы пересекают путь готовой продукции'],
  ['waste', 'semi', 'Отходы пересекают путь полуфабрикатов'],
  ['dirty_inventory', 'ready', 'Грязный инвентарь пересекает путь готовой продукции'],
  ['dirty_inventory', 'clean_inventory', 'Грязный инвентарь пересекает путь чистого'],
  ['return_tare', 'ready', 'Возвратная тара пересекает путь готовой продукции'],
  ['allergen', 'ready', 'Поток аллергенов пересекает путь готовой продукции'],
];
/** Поток через зону с неподходящим назначением. */
export const ZONE_CONFLICTS: [flow: string, zone: string, text: string][] = [
  ['ready', 'raw', 'Готовая продукция проходит через зону сырья'], ['ready', 'waste', 'Готовая продукция проходит через зону отходов'],
  ['ready', 'dirty', 'Готовая продукция проходит через зону грязного инвентаря'], ['ready', 'chemicals', 'Готовая продукция проходит через зону химии'],
  ['semi', 'waste', 'Полуфабрикаты проходят через зону отходов'], ['clean_inventory', 'dirty', 'Чистый инвентарь проходит через зону грязного'],
];

export interface PlanObject { id: string; kind: string; label?: string | null; x_mm: number; y_mm: number; w_mm: number; h_mm: number; rotation: number;
  zone_class?: string | null; equipment_id?: string | null; size_confirmed?: boolean; props?: Record<string, unknown> }
export interface PlanRoute { id: string; flow: string; label?: string | null; points: [number, number][] }
type P = [number, number];

export function corners(o: Pick<PlanObject, 'x_mm' | 'y_mm' | 'w_mm' | 'h_mm' | 'rotation'>): P[] {
  const a = (o.rotation * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), hw = o.w_mm / 2, hh = o.h_mm / 2;
  return ([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] as P[]).map(([x, y]) => [o.x_mm + x * c - y * s, o.y_mm + x * s + y * c]);
}

/** Пересечение выпуклых многоугольников (теорема о разделяющей оси); касание по границе — не пересечение. */
export function polysOverlap(a: P[], b: P[], eps = 1): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
      const nx = y2 - y1, ny = x1 - x2, len = Math.hypot(nx, ny) || 1;
      const pa = a.map(([x, y]) => (x * nx + y * ny) / len), pb = b.map(([x, y]) => (x * nx + y * ny) / len);
      if (Math.max(...pa) <= Math.min(...pb) + eps || Math.max(...pb) <= Math.min(...pa) + eps) return false;
    }
  }
  return true;
}

function segIntersect(p1: P, p2: P, p3: P, p4: P): P | null {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])] : null;
}

function pointInPoly([x, y]: P, poly: P[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segHitsPoly(a: P, b: P, poly: P[]): P | null {
  if (pointInPoly(a, poly)) return a;
  if (pointInPoly(b, poly)) return b;
  for (let i = 0; i < poly.length; i++) { const x = segIntersect(a, b, poly[i], poly[(i + 1) % poly.length]); if (x) return x; }
  return null;
}

export interface Risk { key: string; type: 'overlap' | 'flow_cross' | 'flow_zone' | 'outside' | 'unconfirmed_size' | 'narrow'; severity: 'high' | 'medium' | 'low';
  title: string; at: P | null; objects: string[]; routes: string[]; basis: string }

const label = (o: PlanObject) => o.label || KINDS[o.kind]?.label || o.kind;
const mid = (a: P[]) => [a.reduce((s, p) => s + p[0], 0) / a.length, a.reduce((s, p) => s + p[1], 0) / a.length] as P;

/** Потенциальные риски плана: детерминированные ключи — решения специалиста привязываются к ним. */
export function findRisks(objects: PlanObject[], routes: PlanRoute[], opts: { minPassage?: number | null; basis?: string | null } = {}): Risk[] {
  const out: Risk[] = [];
  if (opts.minPassage) for (const p of passages(objects)) {
    if (p.gap < opts.minPassage) out.push({ key: `narrow:${p.key}`, type: 'narrow', severity: 'high', title: `Проход ${p.gap} мм меньше заданного минимума ${opts.minPassage} мм: ${p.label}`,
      at: p.mid, objects: [p.a, p.b], routes: [], basis: `Минимальная ширина прохода: ${opts.minPassage} мм — ${opts.basis || 'основание не указано'}` });
  }
  const solid = objects.filter((o) => KINDS[o.kind]?.solid);
  for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) {
    const a = solid[i], b = solid[j];
    if ((a.kind === 'wall' || a.kind === 'column') && (b.kind === 'wall' || b.kind === 'column')) continue;   // стыки стен — норма
    const ca = corners(a), cb = corners(b);
    if (polysOverlap(ca, cb)) {
      const [x, y] = [a.id, b.id].sort();
      out.push({ key: `overlap:${x}:${y}`, type: 'overlap', severity: 'high', title: `Габариты накладываются: ${label(a)} и ${label(b)}`, at: mid([...ca, ...cb]),
        objects: [a.id, b.id], routes: [], basis: 'Геометрия плана: объекты не могут занимать одно место' });
    }
  }
  const rooms = objects.filter((o) => o.kind === 'room');
  if (rooms.length) for (const o of objects.filter((x) => KINDS[x.kind]?.layer === 'equipment')) {
    const c = [o.x_mm, o.y_mm] as P;
    if (!rooms.some((r) => pointInPoly(c, corners(r)))) out.push({ key: `outside:${o.id}`, type: 'outside', severity: 'medium', title: `${label(o)} — вне помещений плана`, at: c, objects: [o.id], routes: [],
      basis: 'Геометрия плана' });
  }
  for (const o of objects.filter((x) => KINDS[x.kind]?.layer === 'equipment' && !x.size_confirmed)) {
    out.push({ key: `size:${o.id}`, type: 'unconfirmed_size', severity: 'low', title: `${label(o)}: габарит условный — укажите по паспорту или замеру`, at: [o.x_mm, o.y_mm], objects: [o.id], routes: [],
      basis: 'Проверки наложений и проходов верны только для подтверждённых габаритов' });
  }
  for (const o of objects.filter((x) => swingZone(x))) {
    const z = swingZone(o)!;
    for (const b of solid) {
      if (b.id === o.id) continue;
      if (polysOverlap(z, corners(b))) out.push({ key: `swing:${o.id}:${b.id}`, type: 'overlap', severity: 'medium', title: `Зона открывания двери: ${label(o)} упирается в ${label(b)}`,
        at: mid(z), objects: [o.id, b.id], routes: [], basis: 'Геометрия плана: дверь оборудования должна открываться полностью' });
    }
  }
  for (const [f1, f2, text] of FLOW_CONFLICTS) {
    for (const r1 of routes.filter((r) => r.flow === f1)) for (const r2 of routes.filter((r) => r.flow === f2)) {
      for (let i = 0; i + 1 < r1.points.length; i++) for (let j = 0; j + 1 < r2.points.length; j++) {
        const x = segIntersect(r1.points[i], r1.points[i + 1], r2.points[j], r2.points[j + 1]);
        if (x) out.push({ key: `cross:${r1.id}:${i}:${r2.id}:${j}`, type: 'flow_cross', severity: 'high', title: text, at: x, objects: [], routes: [r1.id, r2.id],
          basis: 'Принцип поточности: встречные и пересекающиеся потоки «чистого» и «грязного» не допускаются; применимость подтверждает специалист' });
      }
    }
  }
  for (const [flow, zone, text] of ZONE_CONFLICTS) {
    for (const r of routes.filter((x) => x.flow === flow)) for (const z of objects.filter((o) => o.zone_class === zone && (o.kind === 'zone' || o.kind === 'room'))) {
      const poly = corners(z);
      for (let i = 0; i + 1 < r.points.length; i++) {
        const hit = segHitsPoly(r.points[i], r.points[i + 1], poly);
        if (hit) { out.push({ key: `zone:${r.id}:${z.id}`, type: 'flow_zone', severity: 'high', title: `${text}: «${label(z)}»`, at: hit, objects: [z.id], routes: [r.id],
          basis: 'Принцип поточности; применимость подтверждает специалист' }); break; }
      }
    }
  }
  return out;
}

/**
 * Зона открывания двери оборудования (пунктир на плане): прямоугольник глубиной swing_mm перед фасадом.
 * Фасад — сторона «низа» объекта без поворота (props.front: 'bottom' | 'top' | 'left' | 'right').
 */
export function swingZone(o: PlanObject): P[] | null {
  const d = Number(o.props?.swing_mm || 0);
  if (!(d > 0)) return null;
  const front = (o.props?.front as string) || 'bottom';
  const lx = front === 'left' ? -o.w_mm / 2 - d / 2 : front === 'right' ? o.w_mm / 2 + d / 2 : 0;
  const ly = front === 'top' ? -o.h_mm / 2 - d / 2 : front === 'bottom' ? o.h_mm / 2 + d / 2 : 0;
  const w = front === 'left' || front === 'right' ? d : o.w_mm, h = front === 'top' || front === 'bottom' ? d : o.h_mm;
  const a = (o.rotation * Math.PI) / 180;
  return corners({ x_mm: o.x_mm + lx * Math.cos(a) - ly * Math.sin(a), y_mm: o.y_mm + lx * Math.sin(a) + ly * Math.cos(a), w_mm: w, h_mm: h, rotation: o.rotation });
}

export function bbox(o: PlanObject) {
  const c = corners(o);
  return { x1: Math.min(...c.map((p) => p[0])), y1: Math.min(...c.map((p) => p[1])), x2: Math.max(...c.map((p) => p[0])), y2: Math.max(...c.map((p) => p[1])) };
}

/** Помещение, в котором стоит объект (наименьшее по площади, содержащее центр). */
export function roomOf(o: PlanObject, objects: PlanObject[]) {
  return objects.filter((r) => r.kind === 'room' && pointInPoly([o.x_mm, o.y_mm], corners(r))).sort((a, b) => a.w_mm * a.h_mm - b.w_mm * b.h_mm)[0] || null;
}

/**
 * Спецификация оборудования, как на чертеже оснащения: №, наименование, Ш×Г, X — от левой стены, Y — от верхней стены
 * до левого верхнего угла элемента, расстояния до правой и нижней стены. Отсчёт — от внутренних граней помещения.
 */
export function specification(objects: PlanObject[]) {
  const eq = objects.filter((o) => KINDS[o.kind]?.layer === 'equipment');
  const numbered = eq.map((o) => ({ o, no: Number(o.props?.no) || null }));
  const auto = numbered.filter((x) => !x.no).sort((a, b) => a.o.y_mm - b.o.y_mm || a.o.x_mm - b.o.x_mm);
  let next = Math.max(0, ...numbered.map((x) => x.no || 0));
  for (const x of auto) x.no = ++next;
  return numbered.sort((a, b) => a.no! - b.no!).map(({ o, no }) => {
    const r = roomOf(o, objects), b = bbox(o), rb = r ? bbox(r) : null;
    const turned = Math.round(o.rotation / 90) % 2 === 1;
    return { id: o.id, no: no!, name: o.label || KINDS[o.kind].label, kind: o.kind, w: Math.round(turned ? o.h_mm : o.w_mm), d: Math.round(turned ? o.w_mm : o.h_mm),
      x: rb ? Math.round(b.x1 - rb.x1) : null, y: rb ? Math.round(b.y1 - rb.y1) : null, to_right: rb ? Math.round(rb.x2 - b.x2) : null, to_bottom: rb ? Math.round(rb.y2 - b.y2) : null,
      room: r ? r.label || 'помещение' : null, size_confirmed: !!o.size_confirmed };
  });
}

/** Перевод «X, Y левого верхнего угла от стен помещения» в центр объекта (для ввода по спецификации). */
export function centerFromCorner(room: PlanObject | null, x: number, y: number, w: number, h: number, rotation: number) {
  const rb = room ? bbox(room) : { x1: 0, y1: 0 };
  const turned = Math.round(rotation / 90) % 2 === 1;
  const bw = turned ? h : w, bh = turned ? w : h;
  return { x_mm: rb.x1 + x + bw / 2, y_mm: rb.y1 + y + bh / 2 };
}

export interface Passage { key: string; a: string; b: string; axis: 'x' | 'y'; from: P; to: P; mid: P; gap: number; label: string }

/**
 * Проходы между соседним оборудованием (зелёные размеры чертежа): от каждого объекта вправо и вниз до ближайшего
 * объекта, перекрывающегося с ним по другой оси, в том же помещении. Только для объектов без поворота «по диагонали».
 * Расстояния до стен — в спецификации (X, Y, до прав., до низа).
 */
export function passages(objects: PlanObject[]): Passage[] {
  const items = objects.filter((o) => KINDS[o.kind]?.layer === 'equipment' && Math.round(o.rotation) % 90 === 0)
    .map((o) => ({ o, b: bbox(o), room: roomOf(o, objects)?.id ?? null }));
  const out: Passage[] = [];
  for (const A of items) {
    for (const axis of ['x', 'y'] as const) {
      let best: { B: (typeof items)[number]; gap: number } | null = null;
      for (const B of items) {
        if (B === A || B.room !== A.room) continue;
        const overlap = axis === 'x' ? Math.min(A.b.y2, B.b.y2) - Math.max(A.b.y1, B.b.y1) : Math.min(A.b.x2, B.b.x2) - Math.max(A.b.x1, B.b.x1);
        if (overlap <= 0) continue;
        const gap = axis === 'x' ? B.b.x1 - A.b.x2 : B.b.y1 - A.b.y2;
        if (gap < -0.5) continue;                                                     // позади или внахлёст
        if (!best || gap < best.gap) best = { B, gap };
      }
      if (!best || best.gap <= 0.5) continue;                                          // ближайший сосед вплотную — прохода нет
      const B = best.B;
      const lo = axis === 'x' ? Math.max(A.b.y1, B.b.y1) : Math.max(A.b.x1, B.b.x1), hi = axis === 'x' ? Math.min(A.b.y2, B.b.y2) : Math.min(A.b.x2, B.b.x2);
      const c = (lo + hi) / 2;
      const from: P = axis === 'x' ? [A.b.x2, c] : [c, A.b.y2], to: P = axis === 'x' ? [B.b.x1, c] : [c, B.b.y1];
      out.push({ key: `${A.o.id}:${B.o.id}:${axis}`, a: A.o.id, b: B.o.id, axis, from, to, mid: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2], gap: Math.round(best.gap),
        label: `${label(A.o)} — ${label(B.o)}` });
    }
  }
  return out;
}

export function areaM2(o: Pick<PlanObject, 'w_mm' | 'h_mm'>) { return Math.round((o.w_mm * o.h_mm) / 1e4) / 100; }
