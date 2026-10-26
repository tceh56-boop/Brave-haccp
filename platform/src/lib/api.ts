'use client';

/** Вызов API v1 из браузера: { ok, data } или ошибка с понятным текстом. */
export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}

/** body — JSON; form — файлы (multipart/form-data). */
export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: opts.method || (opts.body === undefined && !opts.form ? 'GET' : 'POST'),
    headers: opts.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: opts.form ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    credentials: 'same-origin',
  });
  let json: { ok: boolean; data?: T; error?: { code: string; message: string } };
  try { json = await res.json(); } catch { throw new ApiError('NETWORK', 'Нет ответа от сервера. Проверьте связь.', res.status); }
  if (!json.ok) throw new ApiError(json.error?.code || 'ERROR', json.error?.message || 'Ошибка.', res.status);
  return json.data as T;
}
