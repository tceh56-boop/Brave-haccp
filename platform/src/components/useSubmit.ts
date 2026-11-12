'use client';
import { useState } from 'react';

/** Состояние отправки формы: занято, ошибка, повторная отправка заблокирована на время запроса. */
export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return { busy, error, setError, run };
}
