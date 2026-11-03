'use client';
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { dt, n } from '@/lib/fmt';
import { KINDS, LAYERS, ZONE_CLASS, FLOWS, corners, swingZone, specification, findRisks, passages, roomOf, bbox, centerFromCorner, areaM2,
  type PlanObject, type PlanRoute, type Layer, type Risk } from '@/lib/floorplan';

/**
 * Редактор 2D-плана. Всё в миллиметрах; отображение (SVG) отделено от данных. Сохранение — целиком, с ревизией.
 * Ввод оборудования — как в спецификации чертежа: Ш×Г, X от левой стены, Y от верхней стены (левый верхний угол).
 */

type P = [number, number];
interface Plan { id: string; name: string; width_mm: number; height_mm: number; revision: number; min_passage_mm: number | null; min_passage_basis: string | null; background_file_id: string | null; bg_mm_per_px: string | null; bg_offset_x: string; bg_offset_y: string }
interface Decision { decision: string; rationale: string; measure: string | null; decided_by: string; decided_at: string }
interface TtkRoute extends PlanRoute { dish: string; dish_id: string; version: number; from_id: string; to_id: string }
interface Data { plan: Plan; objects: PlanObject[]; routes: PlanRoute[]; ttk_routes: TtkRoute[]; risks: (Risk & { decision: Decision | null })[];
  versions: { version: number; change_note: string; approved_at: string; approved_by: string; content_hash: string }[]; equipment: { id: string; name: string }[] }
type Mode = { t: 'select' } | { t: 'place'; kind: string } | { t: 'route'; flow: string; points: P[] } | { t: 'calibrate'; points: P[] };

const uid = () => crypto.randomUUID();
const snapTo = (v: number, s: number) => (s ? Math.round(v / s) * s : Math.round(v));
const WALL = 200;

export default function PlanEditor({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = use(params);
  const { org, can } = useOrg();
  const manage = can('plan.manage'), approve = can('plan.approve');
  const [data, setData] = useState<Data | null>(null);
  const [objects, setObjects] = useState<PlanObject[]>([]);
  const [routes, setRoutes] = useState<PlanRoute[]>([]);
  const [bg, setBg] = useState<{ file_id: string | null; mm_per_px: number | null; offset_x: number; offset_y: number }>({ file_id: null, mm_per_px: null, offset_x: 0, offset_y: 0 });
  const [bgSize, setBgSize] = useState<{ w: number; h: number } | null>(null);
  const [bgOpacity, setBgOpacity] = useState(0.5);
  const [pass, setPass] = useState<{ min_mm: number | null; basis: string }>({ min_mm: null, basis: '' });
  const [showUpTo, setShowUpTo] = useState(2000);   // только отображение
  const [dirty, setDirty] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ t: 'select' });
  const [placeKind, setPlaceKind] = useState('table');
  const [flow, setFlow] = useState('raw');
  const [snap, setSnap] = useState(50);
  const [layers, setLayers] = useState<Record<Layer | 'routes' | 'risks' | 'background' | 'dims' | 'passages' | 'ttk', boolean>>({ rooms: true, building: true, zones: true, equipment: true, engineering: true, routes: true, risks: true, background: true, dims: true, passages: true, ttk: true });
  const [view, setView] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ kind: 'obj' | 'pan'; start: P; orig: P; id?: string } | null>(null);
  const { busy, error, run, setError } = useSubmit();

  const load = useCallback(() => api<Data>(`/orgs/${org.id}/plans/${planId}`).then((d) => {
    setData(d); setObjects(d.objects); setRoutes(d.routes);
    setPass({ min_mm: d.plan.min_passage_mm, basis: d.plan.min_passage_basis || '' }); setBg({ file_id: d.plan.background_file_id, mm_per_px: d.plan.bg_mm_per_px === null ? null : Number(d.plan.bg_mm_per_px), offset_x: Number(d.plan.bg_offset_x), offset_y: Number(d.plan.bg_offset_y) });
    setView((v) => v || { x: -500, y: -500, w: d.plan.width_mm + 1000, h: d.plan.height_mm + 1000 }); setDirty(false);
  }).catch((e) => setError(e.message)), [org.id, planId, setError]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!bg.file_id) { setBgSize(null); return; }
    const img = new Image(); img.onload = () => setBgSize({ w: img.naturalWidth, h: img.naturalHeight }); img.src = `/api/v1/orgs/${org.id}/evidence/${bg.file_id}`;
  }, [bg.file_id, org.id]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  // схемы ТТК: точки — центры мест этапов в текущем положении объектов
  const ttkRoutes = useMemo(() => (data?.ttk_routes || []).flatMap((r) => { const a = objects.find((o) => o.id === r.from_id), b = objects.find((o) => o.id === r.to_id);
    return a && b ? [{ ...r, points: [[a.x_mm, a.y_mm], [b.x_mm, b.y_mm]] as [number, number][] }] : []; }), [data, objects]);
  const risks = useMemo(() => findRisks(objects, [...routes, ...ttkRoutes], { minPassage: pass.min_mm, basis: pass.basis }), [objects, routes, ttkRoutes, pass]);
  const gaps = useMemo(() => passages(objects), [objects]);
  const spec = useMemo(() => specification(objects), [objects]);
  const noOf = useMemo(() => new Map(spec.map((s) => [s.id, s.no])), [spec]);
  if (!data || !view) return error ? <div className="err">{error}</div> : <p className="muted">Загрузка…</p>;
  const plan = data.plan, tz = org.timezone;
  const selected = objects.find((o) => o.id === sel) || null;
  const selRoute = routes.find((r) => r.id === sel) || null;

  const toMm = (e: { clientX: number; clientY: number }): P => {
    const s = svg.current!, pt = s.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const r = pt.matrixTransform(s.getScreenCTM()!.inverse()); return [r.x, r.y];
  };
  const change = (fn: () => void) => { if (!manage) return; fn(); setDirty(true); };
  const update = (id: string, patch: Partial<PlanObject>) => change(() => setObjects((os) => os.map((o) => (o.id === id ? { ...o, ...patch } : o))));
  const zoom = (k: number, at?: P) => setView((v) => { const c = at || [v!.x + v!.w / 2, v!.y + v!.h / 2]; return { x: c[0] - (c[0] - v!.x) * k, y: c[1] - (c[1] - v!.y) * k, w: v!.w * k, h: v!.h * k }; });

  const onDown = (e: React.PointerEvent) => {
    const p = toMm(e);
    if (mode.t === 'place') {
      const k = KINDS[mode.kind];
      const o: PlanObject = { id: uid(), kind: mode.kind, x_mm: snapTo(p[0], snap), y_mm: snapTo(p[1], snap), w_mm: k.w, h_mm: k.h, rotation: 0, size_confirmed: false, props: mode.kind === 'room' ? { wall_mm: WALL } : {} };
      change(() => setObjects((os) => [...os, o])); setSel(o.id); setMode({ t: 'select' }); return;
    }
    if (mode.t === 'route') { setMode({ ...mode, points: [...mode.points, [snapTo(p[0], snap), snapTo(p[1], snap)]] }); return; }
    if (mode.t === 'calibrate') {
      const pts = [...mode.points, p];
      if (pts.length < 2) { setMode({ ...mode, points: pts }); return; }
      const measured = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
      const real = Number((prompt(`Измерено по плану: ${Math.round(measured)} мм. Реальная длина этого отрезка на чертеже, мм:`) || '').replace(',', '.'));
      if (real > 0 && measured > 0 && bg.mm_per_px) change(() => setBg({ ...bg, mm_per_px: bg.mm_per_px! * (real / measured) }));
      setMode({ t: 'select' }); return;
    }
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { kind: 'pan', start: [e.clientX, e.clientY], orig: [view.x, view.y] };
    setSel(null);
  };
  const onObjDown = (e: React.PointerEvent, o: PlanObject) => {
    if (mode.t !== 'select') return;
    e.stopPropagation(); setSel(o.id);
    if (!manage) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { kind: 'obj', start: toMm(e), orig: [o.x_mm, o.y_mm], id: o.id };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    if (d.kind === 'pan') {
      const s = svg.current!.getBoundingClientRect(), k = view.w / s.width;
      setView({ ...view, x: d.orig[0] - (e.clientX - d.start[0]) * k, y: d.orig[1] - (e.clientY - d.start[1]) * k });
    } else {
      const p = toMm(e);
      update(d.id!, { x_mm: snapTo(d.orig[0] + p[0] - d.start[0], snap), y_mm: snapTo(d.orig[1] + p[1] - d.start[1], snap) });
    }
  };
  const onUp = () => { drag.current = null; };

  const save = () => run(async () => {
    const r = await api<{ revision: number }>(`/orgs/${org.id}/plans/${planId}`, { method: 'PUT', body: { revision: plan.revision, objects, routes, background: bg, passage: { min_mm: pass.min_mm, basis: pass.basis || null } } });
    setMsg(`Сохранено (ревизия ${r.revision}).`); await load();
  });
  const upload = (f: File) => run(async () => {
    const fd = new FormData(); fd.append('file', f); fd.append('entityType', 'floor_plan'); fd.append('entityId', planId); fd.append('note', 'подложка плана');
    const res = await fetch(`/api/v1/orgs/${org.id}/evidence`, { method: 'POST', body: fd, credentials: 'same-origin' });
    const j = await res.json(); if (!j.ok) throw new Error(j.error?.message || 'Не удалось загрузить файл.');
    change(() => setBg({ file_id: j.data.id, mm_per_px: 10, offset_x: 0, offset_y: 0 }));
    setMsg('Подложка загружена. Откалибруйте масштаб: «Калибровка» → два клика по концам известного размера → реальная длина.');
  });
  const exportSvg = () => {
    const s = svg.current!.cloneNode(true) as SVGSVGElement;
    s.setAttribute('viewBox', `${-1500} ${-1500} ${plan.width_mm + 3000} ${plan.height_mm + 3000}`); s.setAttribute('width', '1600'); s.removeAttribute('style');
    const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(s)}`], { type: 'image/svg+xml' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${plan.name}.svg`; a.click(); URL.revokeObjectURL(a.href);
  };

  const fs = Math.max(80, view.w / 90);                                               // размер подписи в мм
  const show = (o: PlanObject) => layers[KINDS[o.kind]?.layer ?? 'equipment'];
  const tf = (o: PlanObject) => `translate(${o.x_mm} ${o.y_mm}) rotate(${o.rotation})`;
  const room = selected ? roomOf(selected, objects) : null;
  const selSpec = selected ? spec.find((s) => s.id === selected.id) : null;

  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/plan`}>← Планы</Link></p>
      <h1 style={{ marginBottom: 4 }}>{plan.name}</h1>
      <p className="small muted" style={{ marginTop: 0 }}>Лист {plan.width_mm} × {plan.height_mm} мм · ревизия {plan.revision}{data.versions[0] ? ` · утверждена версия ${data.versions[0].version}` : ' · не утверждён'}{dirty ? ' · есть несохранённые изменения' : ''}</p>
      {error && <div className="err" role="alert">{error}</div>}
      {msg && <div className="okbox" role="status">{msg}</div>}

      <div className="card noprint" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <button className={`btn small ${mode.t === 'select' ? '' : 'secondary'}`} onClick={() => setMode({ t: 'select' })}>Выбор</button>
        {manage && <>
          <select aria-label="Объект" value={placeKind} onChange={(e) => setPlaceKind(e.target.value)} style={{ width: 'auto' }}>
            {(Object.keys(LAYERS) as Layer[]).map((l) => <optgroup key={l} label={LAYERS[l]}>{Object.entries(KINDS).filter(([, k]) => k.layer === l).map(([c, k]) => <option key={c} value={c}>{k.label}</option>)}</optgroup>)}
          </select>
          <button className={`btn small ${mode.t === 'place' ? '' : 'secondary'}`} onClick={() => setMode({ t: 'place', kind: placeKind })}>Поставить</button>
          <select aria-label="Поток" value={flow} onChange={(e) => setFlow(e.target.value)} style={{ width: 'auto' }}>{Object.entries(FLOWS).map(([c, f]) => <option key={c} value={c}>{f.label}</option>)}</select>
          {mode.t === 'route'
            ? <button className="btn small" onClick={() => { if (mode.points.length >= 2) change(() => setRoutes((rs) => [...rs, { id: uid(), flow: mode.flow, points: mode.points }])); setMode({ t: 'select' }); }}>Закончить маршрут ({mode.points.length} т.)</button>
            : <button className="btn small secondary" onClick={() => setMode({ t: 'route', flow, points: [] })}>Маршрут</button>}
        </>}
        <button className="btn small secondary" onClick={() => zoom(0.8)} aria-label="Приблизить">+</button>
        <button className="btn small secondary" onClick={() => zoom(1.25)} aria-label="Отдалить">−</button>
        <button className="btn small secondary" onClick={() => setView({ x: -500, y: -500, w: plan.width_mm + 1000, h: plan.height_mm + 1000 })}>Весь лист</button>
        <label className="small">привязка <select value={snap} onChange={(e) => setSnap(Number(e.target.value))} style={{ width: 'auto' }}>{[0, 10, 50, 100, 250, 500].map((s) => <option key={s} value={s}>{s ? `${s} мм` : 'нет'}</option>)}</select></label>
        {manage && <button className="btn small" disabled={busy || !dirty} onClick={save}>Сохранить</button>}
        <button className="btn small secondary" onClick={exportSvg}>SVG</button>
        <button className="btn small secondary" onClick={() => window.print()}>Печать / PDF</button>
      </div>
      {mode.t === 'place' && <div className="note noprint">Кликните по плану, чтобы поставить «{KINDS[mode.kind].label}». Габарит — условный, исправьте по паспорту.</div>}
      {mode.t === 'route' && <div className="note noprint">Маршрут «{FLOWS[mode.flow].label}»: кликайте точки по пути движения, затем «Закончить маршрут».</div>}
      {mode.t === 'calibrate' && <div className="note noprint">Калибровка: кликните по двум концам известного размера на чертеже ({mode.points.length}/2).</div>}

      <div className="small noprint" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, margin: '6px 0' }}>
        {([...Object.keys(LAYERS), 'routes', 'ttk', 'passages', 'risks', 'dims', 'background'] as (keyof typeof layers)[]).map((k) => (
          <label key={k} style={{ fontWeight: 400 }}><input type="checkbox" style={{ width: 16, minHeight: 16 }} checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} />
            {' '}{(LAYERS as Record<string, string>)[k] || { routes: 'Потоки', ttk: 'Маршруты по ТТК', passages: 'Проходы', risks: 'Риски', dims: 'Размеры', background: 'Подложка' }[k as string]}</label>))}
      </div>

      <div style={{ border: '1px solid var(--line, #ddd)', borderRadius: 8, background: '#fff', touchAction: 'none' }}>
        <svg ref={svg} viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} style={{ width: '100%', height: '70vh', display: 'block', cursor: mode.t === 'select' ? 'grab' : 'crosshair' }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onWheel={(e) => zoom(e.deltaY > 0 ? 1.1 : 0.9, toMm(e))} xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="g100" width="100" height="100" patternUnits="userSpaceOnUse"><path d="M100 0H0V100" fill="none" stroke="#eee" strokeWidth={view.w / 3000} /></pattern>
            <pattern id="g1000" width="1000" height="1000" patternUnits="userSpaceOnUse"><rect width="1000" height="1000" fill="url(#g100)" /><path d="M1000 0H0V1000" fill="none" stroke="#ddd" strokeWidth={view.w / 1500} /></pattern>
            {Object.entries(FLOWS).map(([c, f]) => <marker key={c} id={`arr-${c}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill={f.color} /></marker>)}
          </defs>
          <rect x={0} y={0} width={plan.width_mm} height={plan.height_mm} fill="url(#g1000)" stroke="#ccc" strokeWidth={view.w / 800} />
          {layers.background && bg.file_id && bgSize && bg.mm_per_px && (
            <image href={`/api/v1/orgs/${org.id}/evidence/${bg.file_id}`} x={bg.offset_x} y={bg.offset_y} width={bgSize.w * bg.mm_per_px} height={bgSize.h * bg.mm_per_px} opacity={bgOpacity} preserveAspectRatio="none" />)}

          {/* помещения: внутренняя грань — граница помещения, стена — наружу */}
          {objects.filter((o) => o.kind === 'room' && show(o)).map((o) => { const t = Number(o.props?.wall_mm ?? WALL); return (
            <g key={o.id} transform={tf(o)} onPointerDown={(e) => onObjDown(e, o)} style={{ cursor: 'move' }}>
              {t > 0 && <rect x={-o.w_mm / 2 - t / 2} y={-o.h_mm / 2 - t / 2} width={o.w_mm + t} height={o.h_mm + t} fill="none" stroke="#1f1a14" strokeWidth={t} />}
              <rect x={-o.w_mm / 2} y={-o.h_mm / 2} width={o.w_mm} height={o.h_mm} fill={o.zone_class ? `${ZONE_CLASS[o.zone_class].color}14` : KINDS.room.fill} stroke={sel === o.id ? '#d9822b' : 'none'} strokeWidth={view.w / 300} />
              <text x={-o.w_mm / 2 + 150} y={-o.h_mm / 2 + fs * 1.4} fontSize={fs} fill="#7a6a58">{o.label || 'Помещение'} · {areaM2(o)} м²</text>
            </g>); })}
          {layers.dims && objects.filter((o) => o.kind === 'room' && show(o) && Math.round(o.rotation) % 90 === 0).map((o) => {
            const b = bbox(o), t = Number(o.props?.wall_mm ?? WALL), off = t + fs * 2, turned = Math.round(o.rotation / 90) % 2 === 1;
            return (<g key={`d${o.id}`} stroke="#2b6cb0" fill="#2b6cb0" strokeWidth={view.w / 1500} fontSize={fs}>
              <line x1={b.x1} y1={b.y1 - off} x2={b.x2} y2={b.y1 - off} /><line x1={b.x1} y1={b.y1 - off - fs / 2} x2={b.x1} y2={b.y1 - t} /><line x1={b.x2} y1={b.y1 - off - fs / 2} x2={b.x2} y2={b.y1 - t} />
              <text x={(b.x1 + b.x2) / 2} y={b.y1 - off - fs / 3} textAnchor="middle" stroke="none">{Math.round(turned ? o.h_mm : o.w_mm)}</text>
              <line x1={b.x1 - off} y1={b.y1} x2={b.x1 - off} y2={b.y2} /><line x1={b.x1 - off - fs / 2} y1={b.y1} x2={b.x1 - t} y2={b.y1} /><line x1={b.x1 - off - fs / 2} y1={b.y2} x2={b.x1 - t} y2={b.y2} />
              <text x={b.x1 - off - fs / 3} y={(b.y1 + b.y2) / 2} textAnchor="middle" stroke="none" transform={`rotate(-90 ${b.x1 - off - fs / 3} ${(b.y1 + b.y2) / 2})`}>{Math.round(turned ? o.w_mm : o.h_mm)}</text>
            </g>);
          })}
          {/* зоны и проходы */}
          {objects.filter((o) => (o.kind === 'zone' || o.kind === 'passage') && show(o)).map((o) => { const c = o.zone_class ? ZONE_CLASS[o.zone_class].color : '#888'; return (
            <g key={o.id} transform={tf(o)} onPointerDown={(e) => onObjDown(e, o)} style={{ cursor: 'move' }}>
              <rect x={-o.w_mm / 2} y={-o.h_mm / 2} width={o.w_mm} height={o.h_mm} fill={`${c}22`} stroke={sel === o.id ? '#d9822b' : c} strokeDasharray={`${fs} ${fs / 2}`} strokeWidth={view.w / 600} />
              <text x={0} y={0} fontSize={fs} textAnchor="middle" fill={c}>{o.label || (o.zone_class ? ZONE_CLASS[o.zone_class].label : KINDS[o.kind].label)}</text>
            </g>); })}
          {/* стены, колонны, окна, двери с дугой открывания */}
          {objects.filter((o) => KINDS[o.kind]?.layer === 'building' && show(o)).map((o) => (
            <g key={o.id} transform={tf(o)} onPointerDown={(e) => onObjDown(e, o)} style={{ cursor: 'move' }}>
              {o.kind === 'door' ? (() => { const w = o.w_mm, inward = (o.props?.swing as string) !== 'out', hingeLeft = (o.props?.hinge as string) !== 'right', hx = hingeLeft ? -w / 2 : w / 2;
                // «внутрь» — к центру помещения, в стене которого дверь (наибольшее помещение рядом)
                const host = objects.filter((r) => r.kind === 'room').map((r) => ({ r, b: bbox(r), t: Number(r.props?.wall_mm ?? WALL) }))
                  .filter(({ b, t }) => o.x_mm >= b.x1 - t - 1 && o.x_mm <= b.x2 + t + 1 && o.y_mm >= b.y1 - t - 1 && o.y_mm <= b.y2 + t + 1).sort((a, c) => c.r.w_mm * c.r.h_mm - a.r.w_mm * a.r.h_mm)[0]?.r;
                const a = (o.rotation * Math.PI) / 180, toIn = host ? (-Math.sin(a)) * (host.x_mm - o.x_mm) + Math.cos(a) * (host.y_mm - o.y_mm) : 1;
                const s = (toIn >= 0 ? 1 : -1) * (inward ? 1 : -1);
                return <><rect x={-w / 2} y={-o.h_mm / 2} width={w} height={o.h_mm} fill="#fff" stroke={sel === o.id ? '#d9822b' : '#c0392b'} strokeWidth={view.w / 600} />
                  <path d={`M${hx} 0 L${hx} ${s * w} A${w} ${w} 0 0 ${(hingeLeft ? 1 : -1) * s > 0 ? 0 : 1} ${-hx} 0`} fill="none" stroke="#555" strokeDasharray={`${fs / 2} ${fs / 3}`} strokeWidth={view.w / 1500} /></>; })()
                : <rect x={-o.w_mm / 2} y={-o.h_mm / 2} width={o.w_mm} height={o.h_mm} fill={KINDS[o.kind].fill} stroke={sel === o.id ? '#d9822b' : 'none'} strokeWidth={view.w / 400} />}
            </g>))}
          {/* оборудование: номер — как в спецификации; пунктир — зона открывания двери */}
          {objects.filter((o) => (KINDS[o.kind]?.layer === 'equipment' || KINDS[o.kind]?.layer === 'engineering') && show(o)).map((o) => { const z = swingZone(o); return (
            <g key={o.id}>
              {z && <polygon points={z.map((p) => p.join(',')).join(' ')} fill="none" stroke="#2b6cb0" strokeDasharray={`${fs / 2} ${fs / 3}`} strokeWidth={view.w / 1500} />}
              <g transform={tf(o)} onPointerDown={(e) => onObjDown(e, o)} style={{ cursor: manage ? 'move' : 'pointer' }}>
                <rect x={-o.w_mm / 2} y={-o.h_mm / 2} width={o.w_mm} height={o.h_mm} fill={KINDS[o.kind].fill} stroke={sel === o.id ? '#d9822b' : o.size_confirmed ? '#2b6cb0' : '#b08a3c'}
                  strokeWidth={view.w / (sel === o.id ? 250 : 700)} strokeDasharray={o.size_confirmed ? undefined : `${fs / 2} ${fs / 4}`} />
              </g>
              {noOf.has(o.id) && <g><circle cx={o.x_mm} cy={o.y_mm} r={fs * 0.9} fill="#fff" stroke="#2b6cb0" strokeWidth={view.w / 1500} /><text x={o.x_mm} y={o.y_mm + fs * 0.35} fontSize={fs} textAnchor="middle" fill="#1f1a14">{noOf.get(o.id)}</text></g>}
            </g>); })}
          {/* проходы между оборудованием — зелёные размеры; уже минимума — красные */}
          {layers.passages && gaps.filter((g) => g.gap <= showUpTo || (!!pass.min_mm && g.gap < pass.min_mm)).map((g) => { const narrow = !!pass.min_mm && g.gap < pass.min_mm, col = narrow ? '#c0392b' : '#2e8b57', e = fs / 3;
            const tick = g.axis === 'x' ? [[g.from[0], g.from[1] - e, g.from[0], g.from[1] + e], [g.to[0], g.to[1] - e, g.to[0], g.to[1] + e]] : [[g.from[0] - e, g.from[1], g.from[0] + e, g.from[1]], [g.to[0] - e, g.to[1], g.to[0] + e, g.to[1]]];
            return (<g key={g.key} stroke={col} strokeWidth={view.w / 1500}>
              <line x1={g.from[0]} y1={g.from[1]} x2={g.to[0]} y2={g.to[1]} />{tick.map((t, i) => <line key={i} x1={t[0]} y1={t[1]} x2={t[2]} y2={t[3]} />)}
              <text x={g.mid[0] + (g.axis === 'y' ? fs / 3 : 0)} y={g.mid[1] - (g.axis === 'x' ? fs / 4 : 0)} fontSize={fs * 0.85} fill={col} stroke="none" textAnchor={g.axis === 'x' ? 'middle' : 'start'}>{g.gap}</text>
            </g>); })}
          {/* маршруты потоков */}
          {layers.routes && routes.map((r) => (
            <polyline key={r.id} points={r.points.map((p) => p.join(',')).join(' ')} fill="none" stroke={FLOWS[r.flow].color} strokeWidth={view.w / (sel === r.id ? 200 : 400)} strokeDasharray={FLOWS[r.flow].dash}
              markerEnd={`url(#arr-${r.flow})`} onPointerDown={(e) => { if (mode.t === 'select') { e.stopPropagation(); setSel(r.id); } }} style={{ cursor: 'pointer' }} />))}
          {layers.ttk && ttkRoutes.map((r) => (
            <g key={r.id}><polyline points={r.points.map((p) => p.join(',')).join(' ')} fill="none" stroke={FLOWS[r.flow].color} strokeWidth={view.w / 500} strokeDasharray={`${fs / 4} ${fs / 4}`} opacity={0.8} markerEnd={`url(#arr-${r.flow})`}>
              <title>{r.label}</title></polyline></g>))}
          {mode.t === 'route' && mode.points.length > 0 && <polyline points={mode.points.map((p) => p.join(',')).join(' ')} fill="none" stroke={FLOWS[mode.flow].color} strokeWidth={view.w / 300} />}
          {/* риски */}
          {layers.risks && risks.filter((r) => r.at && r.type !== 'unconfirmed_size').map((r, i) => (
            <g key={r.key}><circle cx={r.at![0]} cy={r.at![1]} r={fs * 1.1} fill="#c0392b" opacity={0.85} /><text x={r.at![0]} y={r.at![1] + fs * 0.35} fontSize={fs} textAnchor="middle" fill="#fff">!{i + 1}</text></g>))}
        </svg>
      </div>

      {(selected || selRoute) && (
        <div className="card noprint">
          {selected && <>
            <div className="between"><h2 style={{ margin: 0 }}>{selected.label || KINDS[selected.kind].label}{selSpec ? ` · № ${selSpec.no}` : ''}</h2>
              {manage && <span><button className="btn small secondary" onClick={() => { const c = { ...selected, id: uid(), x_mm: selected.x_mm + 200, y_mm: selected.y_mm + 200 }; change(() => setObjects((os) => [...os, c])); setSel(c.id); }}>Копия</button>{' '}
                <button className="btn small danger" onClick={() => { change(() => setObjects((os) => os.filter((o) => o.id !== selected.id))); setSel(null); }}>Удалить</button></span>}</div>
            <fieldset disabled={!manage} style={{ border: 0, padding: 0, margin: 0 }}>
              <div className="grid2">
                <div><label>Тип</label><select value={selected.kind} onChange={(e) => update(selected.id, { kind: e.target.value })}>{Object.entries(KINDS).map(([c, k]) => <option key={c} value={c}>{k.label}</option>)}</select></div>
                <div><label>Наименование</label><input value={selected.label || ''} onChange={(e) => update(selected.id, { label: e.target.value })} placeholder={KINDS[selected.kind].label} /></div>
                <div><label>Ширина (Ш), мм</label><input inputMode="numeric" value={Math.round(selected.w_mm)} onChange={(e) => Number(e.target.value) > 0 && update(selected.id, { w_mm: Number(e.target.value) })} /></div>
                <div><label>Глубина (Г), мм</label><input inputMode="numeric" value={Math.round(selected.h_mm)} onChange={(e) => Number(e.target.value) > 0 && update(selected.id, { h_mm: Number(e.target.value) })} /></div>
                {selected.kind !== 'room' && <>
                  <div><label>X от левой стены, мм</label><input inputMode="numeric" value={selSpec?.x ?? Math.round(bbox(selected).x1)}
                    onChange={(e) => { const c = centerFromCorner(room, Number(e.target.value), selSpec?.y ?? bbox(selected).y1, selected.w_mm, selected.h_mm, selected.rotation); update(selected.id, { x_mm: c.x_mm }); }} /></div>
                  <div><label>Y от верхней стены, мм</label><input inputMode="numeric" value={selSpec?.y ?? Math.round(bbox(selected).y1)}
                    onChange={(e) => { const c = centerFromCorner(room, selSpec?.x ?? bbox(selected).x1, Number(e.target.value), selected.w_mm, selected.h_mm, selected.rotation); update(selected.id, { y_mm: c.y_mm }); }} /></div>
                </>}
                {selected.kind === 'room' && <>
                  <div><label>Левая грань X, мм</label><input inputMode="numeric" value={Math.round(bbox(selected).x1)} onChange={(e) => update(selected.id, { x_mm: Number(e.target.value) + selected.w_mm / 2 })} /></div>
                  <div><label>Верхняя грань Y, мм</label><input inputMode="numeric" value={Math.round(bbox(selected).y1)} onChange={(e) => update(selected.id, { y_mm: Number(e.target.value) + selected.h_mm / 2 })} /></div>
                  <div><label>Толщина стен, мм</label><input inputMode="numeric" value={Number(selected.props?.wall_mm ?? WALL)} onChange={(e) => update(selected.id, { props: { ...selected.props, wall_mm: Number(e.target.value) || 0 } })} /></div>
                </>}
                <div><label>Поворот, °</label><div className="row">{[0, 90, 180, 270].map((a) => <button key={a} type="button" className={`btn small ${Math.round(selected.rotation) === a ? '' : 'secondary'}`} onClick={() => update(selected.id, { rotation: a })}>{a}</button>)}</div></div>
                {(selected.kind === 'room' || selected.kind === 'zone' || selected.kind === 'passage') && <div><label>Назначение</label>
                  <select value={selected.zone_class || ''} onChange={(e) => update(selected.id, { zone_class: e.target.value || null })}><option value="">—</option>{Object.entries(ZONE_CLASS).map(([c, z]) => <option key={c} value={c}>{z.label}</option>)}</select></div>}
                {selected.kind === 'door' && <>
                  <div><label>Открывание</label><select value={(selected.props?.swing as string) || 'in'} onChange={(e) => update(selected.id, { props: { ...selected.props, swing: e.target.value } })}><option value="in">внутрь</option><option value="out">наружу</option></select></div>
                  <div><label>Петли</label><select value={(selected.props?.hinge as string) || 'left'} onChange={(e) => update(selected.id, { props: { ...selected.props, hinge: e.target.value } })}><option value="left">слева</option><option value="right">справа</option></select></div>
                </>}
                {KINDS[selected.kind].layer === 'equipment' && <>
                  <div><label>№ в спецификации</label><input inputMode="numeric" value={(selected.props?.no as number) ?? ''} placeholder={selSpec ? String(selSpec.no) : 'авто'} onChange={(e) => update(selected.id, { props: { ...selected.props, no: e.target.value ? Number(e.target.value) : undefined } })} /></div>
                  <div><label>Зона открывания двери, мм</label><input inputMode="numeric" value={(selected.props?.swing_mm as number) ?? ''} placeholder="нет" onChange={(e) => update(selected.id, { props: { ...selected.props, swing_mm: Number(e.target.value) || undefined } })} /></div>
                  <div><label>Фасад (сторона двери)</label><select value={(selected.props?.front as string) || 'bottom'} onChange={(e) => update(selected.id, { props: { ...selected.props, front: e.target.value } })}>
                    <option value="bottom">низ</option><option value="top">верх</option><option value="left">слева</option><option value="right">справа</option></select></div>
                  <div><label>Карточка оборудования</label><select value={selected.equipment_id || ''} onChange={(e) => update(selected.id, { equipment_id: e.target.value || null })}><option value="">—</option>{data.equipment.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}</select></div>
                </>}
              </div>
              {KINDS[selected.kind].layer === 'equipment' && <label className="row" style={{ fontWeight: 400, marginTop: 8 }}><input type="checkbox" style={{ width: 22, minHeight: 22 }} checked={!!selected.size_confirmed} onChange={(e) => update(selected.id, { size_confirmed: e.target.checked })} /> Габарит подтверждён по паспорту или замеру</label>}
            </fieldset>
            {selSpec && selSpec.to_right !== null && <p className="small muted">До правой стены {selSpec.to_right} мм · до нижней {selSpec.to_bottom} мм</p>}
          </>}
          {selRoute && <>
            <div className="between"><h2 style={{ margin: 0 }}>Маршрут: {FLOWS[selRoute.flow].label}</h2>
              {manage && <button className="btn small danger" onClick={() => { change(() => setRoutes((rs) => rs.filter((r) => r.id !== selRoute.id))); setSel(null); }}>Удалить</button>}</div>
            <p className="small muted">{selRoute.points.length} точек · длина {n(Math.round(selRoute.points.reduce((s, p, i, a) => (i ? s + Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) : 0), 0)))} мм</p>
          </>}
        </div>
      )}

      {manage && (
        <div className="card noprint">
          <h2>Подложка (чертёж)</h2>
          <p className="small muted">PNG или JPG чертежа. PDF и DWG сначала сохраните как изображение. После загрузки откалибруйте масштаб по известному размеру.</p>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
          {bg.file_id && <div className="row" style={{ marginTop: 6, flexWrap: 'wrap', gap: 8 }}>
            <button className="btn small secondary" onClick={() => setMode({ t: 'calibrate', points: [] })}>Калибровка</button>
            <label className="small">мм/пикс <input style={{ width: 90 }} inputMode="decimal" value={bg.mm_per_px ?? ''} onChange={(e) => change(() => setBg({ ...bg, mm_per_px: Number(e.target.value.replace(',', '.')) || null }))} /></label>
            <label className="small">X <input style={{ width: 80 }} inputMode="numeric" value={bg.offset_x} onChange={(e) => change(() => setBg({ ...bg, offset_x: Number(e.target.value) || 0 }))} /></label>
            <label className="small">Y <input style={{ width: 80 }} inputMode="numeric" value={bg.offset_y} onChange={(e) => change(() => setBg({ ...bg, offset_y: Number(e.target.value) || 0 }))} /></label>
            <label className="small">прозрачность <input type="range" min={0.1} max={1} step={0.1} value={bgOpacity} onChange={(e) => setBgOpacity(Number(e.target.value))} /></label>
          </div>}
        </div>
      )}

      {data.ttk_routes.length > 0 && <div className="card noprint">
        <h2>Маршруты продуктов по ТТК</h2>
        <p className="small muted">Строятся из этапов утверждённых ТТК, привязанных к местам на этом плане: прямые между местами (схема последовательности, а не трассировка пути).
          Цвет — состояние продукта на отрезке. Риски по ним — в общем списке.</p>
        <ul className="list small">{[...new Map(data.ttk_routes.map((r) => [r.dish_id, r])).values()].map((r) => (
          <li key={r.dish_id}><Link href={`/app/${org.id}/menu/${r.dish_id}`}>{r.dish}</Link> (ТТК v{r.version}): {data.ttk_routes.filter((x) => x.dish_id === r.dish_id).length} переходов</li>))}</ul>
      </div>}

      <div className="card noprint">
        <h2>Проходы</h2>
        <p className="small muted">Расстояния между соседним оборудованием считаются по плану автоматически (зелёные размеры). Минимальную ширину прохода система не задаёт:
          укажите её и основание — норматив, проект или инструкцию оборудования. Проходы уже минимума станут рисками.</p>
        <fieldset disabled={!manage} style={{ border: 0, padding: 0, margin: 0 }}>
          <div className="grid2">
            <div><label htmlFor="mp">Минимальная ширина прохода, мм</label><input id="mp" inputMode="numeric" value={pass.min_mm ?? ''} placeholder="не задана"
              onChange={(e) => change(() => setPass({ ...pass, min_mm: e.target.value ? Number(e.target.value) : null }))} /></div>
            <div><label htmlFor="mpb">Основание</label><input id="mpb" value={pass.basis} onChange={(e) => change(() => setPass({ ...pass, basis: e.target.value }))} placeholder="документ и пункт" /></div>
          </div>
        </fieldset>
        <label className="small">Показывать на плане проходы до <select value={showUpTo} onChange={(e) => setShowUpTo(Number(e.target.value))} style={{ width: 'auto' }}>
          {[1000, 1500, 2000, 3000, 100000].map((v) => <option key={v} value={v}>{v > 10000 ? 'все' : `${v} мм`}</option>)}</select> (настройка вида, не норма)</label>
        {gaps.length > 0 && <p className="small">Самый узкий проход: {Math.min(...gaps.map((g) => g.gap))} мм{pass.min_mm ? ` · уже ${pass.min_mm} мм: ${gaps.filter((g) => g.gap < pass.min_mm!).length}` : ''}.</p>}
      </div>

      <div className="card">
        <h2>Спецификация (мм)</h2>
        {spec.length === 0 ? <p className="small muted">Оборудования на плане нет.</p> : (
          <div className="scroll"><table className="tbl small"><thead><tr><th>№</th><th>Оборудование</th><th>Ш×Г</th><th>X</th><th>Y</th><th>до прав.</th><th>до низа</th></tr></thead>
            <tbody>{spec.map((s) => <tr key={s.id} onClick={() => setSel(s.id)} style={{ cursor: 'pointer', background: sel === s.id ? '#fdf1dc' : undefined }}>
              <td>{s.no}</td><td>{s.name}{!s.size_confirmed && <span className="muted"> · габарит условный</span>}</td><td>{s.w}×{s.d}</td><td>{s.x ?? '—'}</td><td>{s.y ?? '—'}</td><td>{s.to_right ?? '—'}</td><td>{s.to_bottom ?? '—'}</td></tr>)}</tbody></table></div>)}
        <p className="small muted">X — от левой стены, Y — от верхней стены до левого верхнего угла элемента. Пунктирная рамка — габарит не подтверждён; синий пунктир перед фасадом — зона открывания двери.</p>
      </div>

      <RiskPanel orgId={org.id} planId={planId} risks={risks} decisions={data.risks} dirty={dirty} canDecide={approve} onDone={load} />

      <div className="card noprint">
        <h2>Версии</h2>
        {data.versions.length === 0 && <p className="small muted">План не утверждался.</p>}
        <ul className="list small">{data.versions.map((v) => <li key={v.version}>Версия {v.version} — {v.change_note} · {v.approved_by}, {dt(v.approved_at, tz)} · <span className="muted">SHA-256 {v.content_hash.slice(0, 12)}…</span></li>)}</ul>
        {approve && <>
          <label htmlFor="cn">Что утверждается или изменено</label><input id="cn" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Расстановка оборудования, вариант 6" />
          <button className="btn block" disabled={busy || dirty || note.trim().length < 3} onClick={() => run(async () => { const r = await api<{ version: number }>(`/orgs/${org.id}/plans/${planId}/approve`, { body: { changeNote: note } }); setMsg(`Утверждена версия ${r.version}.`); setNote(''); await load(); })}>Утвердить версию</button>
          {dirty && <p className="small muted">Сначала сохраните изменения.</p>}
        </>}
      </div>
    </>
  );
}

function RiskPanel({ orgId, planId, risks, decisions, dirty, canDecide, onDone }: { orgId: string; planId: string; risks: Risk[]; decisions: (Risk & { decision: Decision | null })[]; dirty: boolean; canDecide: boolean; onDone: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [f, setF] = useState({ rationale: '', measure: '' });
  const { busy, error, run } = useSubmit();
  const dec = new Map(decisions.map((r) => [r.key, r.decision]));
  const shown = risks.filter((r) => r.type !== 'unconfirmed_size'), sizes = risks.filter((r) => r.type === 'unconfirmed_size');
  return (
    <div className="card">
      <h2>Потенциальные риски · {shown.length}</h2>
      <p className="small muted">Найдены по геометрии плана: это кандидаты, а не доказанные нарушения. Специалист подтверждает риск с мерой или отклоняет с обоснованием.</p>
      {shown.length === 0 && <p className="small">Наложений, перекрытых дверей и пересечений потоков не найдено.</p>}
      <ol className="small">{shown.map((r) => { const d = dec.get(r.key); return (
        <li key={r.key} style={{ marginBottom: 6 }}>
          <span className={`badge ${d ? (d.decision === 'confirmed' ? 'warn' : 'ok') : r.severity === 'high' ? 'crit' : 'warn'}`}>{d ? (d.decision === 'confirmed' ? 'подтверждён' : 'отклонён') : 'ждёт решения'}</span> {r.title}
          <div className="muted">{r.basis}{d ? ` · ${d.decided_by}: ${d.rationale}${d.measure ? `; мера: ${d.measure}` : ''}` : ''}</div>
          {canDecide && !dirty && (open === r.key ? (
            <div style={{ marginTop: 4 }}>
              <input aria-label="Обоснование" value={f.rationale} onChange={(e) => setF({ ...f, rationale: e.target.value })} placeholder="обоснование" />
              <input aria-label="Мера" value={f.measure} onChange={(e) => setF({ ...f, measure: e.target.value })} placeholder="мера управления (для подтверждённого)" style={{ marginTop: 4 }} />
              {error && <div className="err">{error}</div>}
              <div className="row" style={{ marginTop: 4 }}>
                {(['confirmed', 'rejected'] as const).map((k) => <button key={k} className={`btn small ${k === 'rejected' ? 'secondary' : ''}`} disabled={busy}
                  onClick={() => run(async () => { await api(`/orgs/${orgId}/plans/${planId}/risk`, { body: { riskKey: r.key, decision: k, rationale: f.rationale, measure: f.measure || null } }); setOpen(null); setF({ rationale: '', measure: '' }); onDone(); })}>
                  {k === 'confirmed' ? 'Подтвердить' : 'Отклонить'}</button>)}
              </div>
            </div>) : <button className="btn small secondary" onClick={() => setOpen(r.key)} style={{ marginTop: 4 }}>Решение</button>)}
        </li>); })}</ol>
      {sizes.length > 0 && <p className="small muted">Условных габаритов: {sizes.length} — проверки для них предварительные.</p>}
    </div>
  );
}
