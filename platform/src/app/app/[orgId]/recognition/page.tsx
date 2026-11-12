'use client';
import { useCallback, useEffect, useState } from 'react';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { n } from '@/lib/fmt';

/** Распознавание документов: подключение Yandex Cloud (на сервере), включение, виды документов, месячный лимит, расход. */

interface R {
  server: { configured: boolean; missing: string[]; auth: string | null; folder: string | null; model: string; llm: boolean };
  settings: { enabled: boolean; kinds: string[]; monthly_pages: number; updated_by: string | null };
  kinds: Record<string, string>; usage: { kind: string; pages: number; tokens: number; calls: number; failed: number }[]; pages_used: number;
}

export default function Recognition() {
  const { org } = useOrg();
  const [x, setX] = useState<R | null>(null);
  const [f, setF] = useState<{ enabled: boolean; kinds: string[]; monthlyPages: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(() => api<R>(`/orgs/${org.id}/recognition`).then((d) => { setX(d); setF({ enabled: d.settings.enabled, kinds: d.settings.kinds, monthlyPages: String(d.settings.monthly_pages) }); })
    .catch((e) => setError(e.message)), [org.id, setError]);
  useEffect(() => { load(); }, [load]);
  if (!x || !f) return <><h1>Распознавание документов</h1>{error ? <div className="err">{error}</div> : <p className="muted">Загрузка…</p>}</>;
  const s = x.server;
  return (
    <>
      <h1>Распознавание документов</h1>
      <p className="small muted">Фото или PDF накладной ТОРГ-12 и УПД, QR-код кассового чека, банкетный бланк → черновик, который проверяет и подтверждает человек. Распознавание — Yandex Vision и YandexGPT (платно, по страницам).</p>

      <div className="card">
        <h2>Подключение Yandex Cloud</h2>
        {s.configured ? (
          <div className="kv">
            <span>Состояние</span><b><span className="badge ok">настроено на сервере</span></b>
            <span>Доступ</span><b>{s.auth === 'api_key' ? 'API-ключ сервисного аккаунта' : 'IAM-токен (временный)'}</b>
            <span>Каталог</span><b>{s.folder}</b>
            <span>Модель</span><b>{s.llm ? s.model : 'отключена — только таблица OCR'}</b>
          </div>
        ) : (
          <>
            <p><span className="badge warn">не настроено</span> На сервере не заданы: {s.missing.join(', ')}.</p>
            <p className="small">Администратор сервера добавляет ключи в файл <code>.env</code> (ключи в базе и на экране не хранятся) и перезапускает систему. Пошагово — «Распознавание документов» в инструкции по развёртыванию.</p>
          </>
        )}
        {s.configured && s.auth === 'iam_token' && <p className="small muted">IAM-токен действует до 12 часов — для постоянной работы нужен API-ключ.</p>}
        {s.configured && s.llm && (
          <button className="btn secondary small" disabled={busy} onClick={() => {
            if (!window.confirm('Проверка — один короткий платный запрос к YandexGPT. Выполнить?')) return;
            run(async () => { const r = await api<{ tokens: number }>(`/orgs/${org.id}/recognition/check`, { body: { confirmPaid: true } }); setMsg(`Подключение работает (токенов: ${r.tokens}).`); load(); });
          }}>Проверить подключение (платный запрос)</button>
        )}
      </div>

      <div className="card">
        <h2>На предприятии</h2>
        <label className="row" style={{ fontWeight: 400 }}><input type="checkbox" style={{ width: 22, minHeight: 22 }} checked={f.enabled} disabled={!s.configured && !f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> Распознавание включено</label>
        <p className="small" style={{ marginBottom: 4 }}><b>Документы</b></p>
        <div className="chips">{Object.entries(x.kinds).map(([k, l]) => <button key={k} type="button" aria-pressed={f.kinds.includes(k)} onClick={() => setF({ ...f, kinds: f.kinds.includes(k) ? f.kinds.filter((y) => y !== k) : [...f.kinds, k] })}>{l}</button>)}</div>
        <label htmlFor="lm">Лимит на месяц, страниц</label>
        <input id="lm" inputMode="numeric" value={f.monthlyPages} onChange={(e) => setF({ ...f, monthlyPages: e.target.value })} />
        <p className="small muted">Когда лимит исчерпан, документы вносятся вручную — расход не выходит за выбранную сумму.</p>
        {error && <div className="err" role="alert">{error}</div>}
        {msg && <div className="okbox" role="status">{msg}</div>}
        <button className="btn block" disabled={busy} onClick={() => run(async () => { await api(`/orgs/${org.id}/recognition`, { body: { enabled: f.enabled, kinds: f.kinds, monthlyPages: f.monthlyPages } }); setMsg('Сохранено.'); load(); })}>Сохранить</button>
        {x.settings.updated_by && <p className="small muted">Изменил(а): {x.settings.updated_by}</p>}
      </div>

      <div className="card">
        <h2>Расход в этом месяце</h2>
        <p>{n(x.pages_used)} из {n(x.settings.monthly_pages)} страниц</p>
        {x.usage.length === 0 ? <p className="small muted">Обращений не было.</p> : (
          <ul className="list">{x.usage.map((u) => <li key={u.kind} className="small">{x.kinds[u.kind] || 'Проверка подключения'}: обращений {u.calls}{u.failed ? ` (с ошибкой ${u.failed})` : ''}, страниц {u.pages}, токенов модели {u.tokens}</li>)}</ul>
        )}
      </div>
    </>
  );
}
