'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useOrg } from '@/lib/org';
import { api } from '@/lib/api';
import { dt } from '@/lib/fmt';

interface File_ { id: string; filename: string; mime: string; size_bytes: number; sha256: string; note: string | null; uploaded_at: string; uploaded_by_name: string }

/** Доказательства к записи: фото с телефона или PDF; файл не удаляется и не заменяется — только добавляется. */
export function Evidence({ entityType, entityId, title = 'Доказательства', docs = false, readPerm = 'evidence.read', addPerm = 'evidence.add', hint }:
  { entityType: string; entityId: string; title?: string; docs?: boolean; readPerm?: string; addPerm?: string; hint?: string }) {
  const { org, can } = useOrg();
  const [files, setFiles] = useState<File_[] | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const load = useCallback(() => api<File_[]>(`/orgs/${org.id}/evidence?entityType=${entityType}&entityId=${entityId}`).then(setFiles).catch((e) => setErr(e.message)), [org.id, entityType, entityId]);
  const readable = can(readPerm);
  useEffect(() => { if (readable) load(); }, [load, readable]);
  if (!readable) return null;

  async function upload(f: File) {
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append('file', f); fd.append('entityType', entityType); fd.append('entityId', entityId); if (note) fd.append('note', note);
      const res = await fetch(`/api/v1/orgs/${org.id}/evidence`, { method: 'POST', body: fd, credentials: 'same-origin' });
      const j = await res.json().catch(() => null);
      if (!j?.ok) throw new Error(j?.error?.message || 'Не удалось загрузить файл.');
      setNote(''); await load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  }

  return (
    <div className="card">
      <h2>{title}</h2>
      {err && <div className="err" role="alert">{err}</div>}
      {!files ? <p className="muted">Загрузка…</p> : files.length === 0 ? <p className="small muted">Файлов нет.</p> : (
        <ul className="list">{files.map((f) => (
          <li key={f.id}>
            <a href={`/api/v1/orgs/${org.id}/evidence/${f.id}`} target="_blank" rel="noopener">{f.filename}</a>
            <div className="small muted">{dt(f.uploaded_at, org.timezone)} · {f.uploaded_by_name} · {Math.max(1, Math.round(f.size_bytes / 1024))} КБ{f.note ? ` · ${f.note}` : ''}</div>
            <div className="small muted" title="Контрольная сумма SHA-256">SHA-256: {f.sha256.slice(0, 16)}…</div>
          </li>
        ))}</ul>
      )}
      {can(addPerm) && (
        <>
          <label htmlFor={`en-${entityId}`}>Подпись к файлу (необязательно)</label>
          <input id={`en-${entityId}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder={hint || 'Например: показания термометра'} />
          <input ref={input} type="file" accept={`image/jpeg,image/png,image/webp,image/heic,application/pdf${docs ? ',.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document' : ''}`} aria-label="Файл доказательства" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
          <button type="button" className="btn block secondary" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Загрузка…' : docs ? 'Добавить PDF, DOCX или фото' : 'Добавить фото или PDF'}</button>
          <p className="small muted">До 10 МБ. Загруженный файл не удаляется и не заменяется.</p>
        </>
      )}
    </div>
  );
}
