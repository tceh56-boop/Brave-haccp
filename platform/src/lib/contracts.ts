/** Виды договоров (как на сервере, src/server/ops/contracts.ts). */
export const CONTRACT_KINDS: [string, string][] = [
  ['pest_control', 'Дезинсекция и дератизация'], ['lab', 'Лабораторные исследования'], ['waste', 'Вывоз отходов (ТКО, пищевые)'], ['lease', 'Аренда помещения'],
  ['water', 'Водоснабжение и водоотведение'], ['laundry', 'Стирка спецодежды'], ['ventilation', 'Обслуживание вентиляции'], ['equipment_service', 'Обслуживание оборудования'],
  ['medical', 'Медосмотры работников'], ['disinfection', 'Дезинфекция'], ['grease_trap', 'Чистка жироуловителя'], ['other', 'Прочее'],
];

export interface Contract {
  id: string; site_id: string | null; site_name: string | null; kind: string; kind_label: string; title: string; counterparty: string; counterparty_inn: string | null; number: string | null;
  signed_on: string | null; valid_from: string | null; valid_to: string | null; auto_renew: boolean; subject: string | null; status: string; terminated_on: string | null; terminate_reason: string | null;
  files: number; state: 'ok' | 'expiring' | 'expired' | 'no_file' | 'terminated' | 'not_started'; label: string;
}

export const STATE_BADGE: Record<Contract['state'], string> = { ok: 'ok', expiring: 'warn', not_started: 'warn', no_file: 'warn', expired: 'crit', terminated: '' };
export const ddmm = (s: string | null) => (s ? s.slice(0, 10).split('-').reverse().join('.') : '—');
