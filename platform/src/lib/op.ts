'use client';
import { useState } from 'react';

/**
 * Ключ операции для идемпотентных действий склада: один и тот же, пока действие не выполнено, —
 * повторное нажатие или повтор после обрыва связи не спишет второй раз. После успеха — новый ключ.
 */
export function useOperationId() {
  const make = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [id, setId] = useState(make);
  return { id, next: () => setId(make()) };
}
