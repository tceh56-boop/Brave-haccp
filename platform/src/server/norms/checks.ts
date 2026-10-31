import { READINESS_KEYS, runReadinessItem, isBad, type Ctx, type RStatus } from '../readiness/engine';

/**
 * Проверки требований нормативной библиотеки — адаптер к единому движку готовности (readiness/engine.ts).
 * Своей логики здесь нет: каждый ключ проверки — пункт движка.
 */

export type CheckStatus = 'ok' | 'fail' | 'warn';
export interface CheckResult { status: CheckStatus; detail: string; href?: string; items?: string[] }

/** Ключи проверок — ключи движка готовности (readiness/engine.ts): одна реализация на всю систему. */
export const CHECK_KEYS = READINESS_KEYS;
const MAP: Record<RStatus, CheckStatus> = { ok: 'ok', not_applicable: 'ok', warning: 'warn', not_checked: 'warn', missing: 'fail', overdue: 'fail', expired: 'fail', incomplete: 'fail', blocked: 'fail' };

export async function runCheck(key: string, ctx: Ctx): Promise<CheckResult> {
  const keys = key === 'staff_medical' ? ['staff_medical', 'staff_hygiene'] : [key];   // п. 24: и медосмотр, и гигиеническая аттестация
  const items = [];
  for (const k of keys) items.push(await runReadinessItem(k, ctx));
  const worst = items.find((i) => isBad(i.status)) || items.find((i) => MAP[i.status] === 'warn') || items[0];
  return { status: MAP[worst.status], detail: items.map((i) => i.detail).join(' '), href: worst.href || undefined, items: items.flatMap((i) => i.items || []) };
}
