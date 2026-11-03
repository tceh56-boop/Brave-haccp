'use client';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { scene3d, FLOWS, type PlanObject, type PlanRoute, type Risk } from '@/lib/floorplan';

/**
 * 3D-вид, построенный из утверждаемого 2D-плана (данные одни, отображение отдельно). Метр = единица сцены;
 * X плана → X, Y плана → Z, высота → Y. Условные высоты и габариты показаны полупрозрачными.
 * Не заменяет инженерный проект и экспертную оценку.
 */

type View = 'iso' | 'top' | 'side' | 'inside';
interface Props { objects: PlanObject[]; routes: (PlanRoute & { dish?: string })[]; risks: Risk[]; width: number; height: number }

const m = (mm: number) => mm / 1000;

function labelSprite(text: string, color = '#1f1a14', bg = '#ffffff') {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = bg; g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.fill(); g.lineWidth = 6; g.strokeStyle = '#2b6cb0'; g.stroke();
  g.fillStyle = color; g.font = 'bold 56px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 68);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c) }));
  s.scale.set(0.28, 0.28, 0.28);
  return s;
}

export default function Plan3D({ objects, routes, risks, width, height }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const ctx = useRef<{ camera: THREE.PerspectiveCamera; controls: OrbitControls; renderer: THREE.WebGLRenderer; groups: Record<string, THREE.Group>; walker: THREE.Mesh; center: THREE.Vector3 } | null>(null);
  const [view, setView] = useState<View>('iso');
  const [show, setShow] = useState({ walls: true, equipment: true, zones: true, routes: true, risks: true });
  const [cut, setCut] = useState(true);   // срез стен на 1 м — только отображение
  const [play, setPlay] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);

  // построение сцены при изменении плана
  useEffect(() => {
    const el = host.current; if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); }
    catch { setErr('Браузер не поддерживает WebGL — 3D-вид недоступен. 2D-план работает.'); return; }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setSize(el.clientWidth, el.clientHeight); el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#f3efe8');
    const center = new THREE.Vector3(m(width) / 2, 0, m(height) / 2);
    const camera = new THREE.PerspectiveCamera(50, el.clientWidth / el.clientHeight, 0.05, 500);
    const controls = new OrbitControls(camera, renderer.domElement); controls.target.copy(center); controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight('#ffffff', '#b9ad9c', 1.1));
    const sun = new THREE.DirectionalLight('#ffffff', 0.9); sun.position.set(center.x + 5, 12, center.z - 4); scene.add(sun);
    const groups: Record<string, THREE.Group> = { walls: new THREE.Group(), equipment: new THREE.Group(), zones: new THREE.Group(), routes: new THREE.Group(), risks: new THREE.Group() };
    Object.values(groups).forEach((g) => scene.add(g));
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(m(width), m(height)), new THREE.MeshLambertMaterial({ color: '#e7e1d6' }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(center.x, -0.002, center.z); scene.add(ground);

    for (const b of scene3d(objects)) {
      const rot = -(b.rotation * Math.PI) / 180;
      if (b.part === 'floor' || b.part === 'zone') {
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(m(b.w), m(b.d)), new THREE.MeshLambertMaterial({ color: b.color, transparent: b.part === 'zone', opacity: b.part === 'zone' ? 0.35 : 1 }));
        mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = rot; mesh.position.set(m(b.x), b.part === 'zone' ? 0.004 : 0, m(b.y));
        (b.part === 'zone' ? groups.zones : groups.walls).add(mesh); continue;
      }
      const wallish = b.part === 'wall' || b.part === 'partition' || b.part === 'lintel';
      if (cut && b.part === 'lintel') continue;
      const h = cut && wallish ? Math.min(b.h, 1000) : b.h;
      const mat = new THREE.MeshLambertMaterial({ color: wallish ? '#8a7a68' : b.color, transparent: b.conventional && b.part === 'equipment', opacity: b.conventional && b.part === 'equipment' ? 0.75 : 1 });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(m(b.w), m(h), m(b.d)), mat);
      mesh.position.set(m(b.x), m(b.z) + m(h) / 2, m(b.y)); mesh.rotation.y = rot;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: b.part === 'equipment' ? '#2b6cb0' : '#1f1a14' }));
      mesh.add(edges);
      (b.part === 'equipment' ? groups.equipment : groups.walls).add(mesh);
      if (b.no) { const s = labelSprite(String(b.no)); s.position.set(m(b.x), m(b.h) + 0.25, m(b.y)); groups.equipment.add(s); }
    }
    for (const r of routes) {
      const pts = r.points.map(([x, y]) => new THREE.Vector3(m(x), 0.12, m(y)));
      const col = FLOWS[r.flow]?.color || '#333';
      for (let i = 0; i + 1 < pts.length; i++) {
        const curve = new THREE.LineCurve3(pts[i], pts[i + 1]);
        groups.routes.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 1, r.dish ? 0.025 : 0.04, 8, false), new THREE.MeshLambertMaterial({ color: col })));
        const dir = pts[i + 1].clone().sub(pts[i]);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 12), new THREE.MeshLambertMaterial({ color: col }));
        cone.position.copy(pts[i].clone().add(dir.clone().multiplyScalar(0.55)));
        cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()); groups.routes.add(cone);
      }
    }
    for (const r of risks.filter((x) => x.at && x.type !== 'unconfirmed_size')) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), new THREE.MeshLambertMaterial({ color: '#c0392b', transparent: true, opacity: 0.85 }));
      s.position.set(m(r.at![0]), 1.6, m(r.at![1])); groups.risks.add(s);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1.6), new THREE.MeshBasicMaterial({ color: '#c0392b' })); stem.position.set(m(r.at![0]), 0.8, m(r.at![1])); groups.risks.add(stem);
    }
    const walker = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), new THREE.MeshLambertMaterial({ color: '#d9822b' })); walker.visible = false; scene.add(walker);

    ctx.current = { camera, controls, renderer, groups, walker, center };
    let raf = 0;
    const loop = () => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
    loop();
    const onResize = () => { camera.aspect = el.clientWidth / el.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(el.clientWidth, el.clientHeight); };
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); controls.dispose(); renderer.dispose(); el.removeChild(renderer.domElement); ctx.current = null; };
  }, [objects, routes, risks, width, height, cut]);

  // положение камеры по выбранному виду
  useEffect(() => {
    const c = ctx.current; if (!c) return;
    const { camera, controls, center } = c, span = Math.max(m(width), m(height));
    if (view === 'top') { camera.position.set(center.x, span * 1.25, center.z + 0.001); controls.target.copy(center); }
    if (view === 'iso') { camera.position.set(center.x + span * 0.7, span * 0.75, center.z + span * 0.8); controls.target.copy(center); }
    if (view === 'side') { camera.position.set(center.x, 1.6, center.z + span * 1.1); controls.target.set(center.x, 1, center.z); }
    if (view === 'inside') { camera.position.set(center.x, 1.6, center.z + m(height) * 0.35); controls.target.set(center.x, 1.4, center.z - m(height) * 0.2); }
    controls.update();
  }, [view, width, height, objects, cut]);

  useEffect(() => { const c = ctx.current; if (!c) return; for (const [k, g] of Object.entries(c.groups)) g.visible = show[k as keyof typeof show]; }, [show, objects, cut]);

  // проигрывание маршрута: точка движется по отрезкам с постоянной скоростью
  useEffect(() => {
    const c = ctx.current; if (!c) return;
    const r = routes.find((x) => x.id === play);
    if (!r) { c.walker.visible = false; return; }
    const pts = r.points.map(([x, y]) => new THREE.Vector3(m(x), 0.3, m(y)));
    const len = pts.slice(1).reduce((s, p, i) => s + p.distanceTo(pts[i]), 0);
    let start = 0, raf = 0;
    const step = (t: number) => {
      if (!start) start = t;
      let d = (((t - start) / 1000) * 1.2) % (len || 1);
      for (let i = 0; i + 1 < pts.length; i++) { const seg = pts[i].distanceTo(pts[i + 1]); if (d <= seg) { c.walker.position.lerpVectors(pts[i], pts[i + 1], seg ? d / seg : 0); break; } d -= seg; }
      c.walker.visible = true; raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [play, routes, objects, cut]);

  const png = () => { const c = ctx.current; if (!c) return; const a = document.createElement('a'); a.href = c.renderer.domElement.toDataURL('image/png'); a.download = '3d-план.png'; a.click(); };

  if (err) return <div className="note">{err}</div>;
  return (
    <div>
      <div className="row noprint" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
        {([['iso', 'Изометрия'], ['top', 'Сверху'], ['side', 'Сбоку'], ['inside', 'Изнутри']] as [View, string][]).map(([k, l]) =>
          <button key={k} className={`btn small ${view === k ? '' : 'secondary'}`} onClick={() => setView(k)}>{l}</button>)}
        <select aria-label="Проиграть маршрут" value={play} onChange={(e) => setPlay(e.target.value)} style={{ width: 'auto' }}>
          <option value="">— проиграть маршрут —</option>
          {routes.map((r) => <option key={r.id} value={r.id}>{r.dish ? `ТТК «${r.dish}»: ` : ''}{FLOWS[r.flow]?.label}{r.label && !r.dish ? ` · ${r.label}` : ''}</option>)}
        </select>
        <label className="small" style={{ fontWeight: 400 }}><input type="checkbox" style={{ width: 16, minHeight: 16 }} checked={cut} onChange={(e) => setCut(e.target.checked)} /> срез стен на 1 м</label>
        <button className="btn small secondary" onClick={png}>PNG</button>
      </div>
      <div className="small noprint" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 6 }}>
        {(Object.keys(show) as (keyof typeof show)[]).map((k) => <label key={k} style={{ fontWeight: 400 }}><input type="checkbox" style={{ width: 16, minHeight: 16 }} checked={show[k]}
          onChange={(e) => setShow({ ...show, [k]: e.target.checked })} /> {{ walls: 'Стены и пол', equipment: 'Оборудование', zones: 'Зоны', routes: 'Потоки и маршруты ТТК', risks: 'Риски' }[k]}</label>)}
      </div>
      <div ref={host} style={{ width: '100%', height: '70vh', borderRadius: 8, overflow: 'hidden', border: '1px solid #ddd', touchAction: 'none' }} />
      <p className="small muted">3D строится из 2D-плана — правки делаются в 2D. Полупрозрачное оборудование — условные габариты или высота. Высоты задаются в свойствах объекта (по умолчанию условные).
        Вид не заменяет инженерный проект и экспертную оценку.</p>
    </div>
  );
}
