import { afterEach, describe, expect, it } from 'vitest';
import { aiAvailable, checkAnswer, setAiProvider } from '../src/server/ops/ai';

// Российская установка: зарубежный AI не включается сам по себе, только явным AI_PROVIDER=anthropic (152-ФЗ).
const saved = { p: process.env.AI_PROVIDER, k: process.env.ANTHROPIC_API_KEY, t: process.env.ANTHROPIC_AUTH_TOKEN };
const set = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };

describe('выбор провайдера AI по умолчанию', () => {
  afterEach(() => { set('AI_PROVIDER', saved.p); set('ANTHROPIC_API_KEY', saved.k); set('ANTHROPIC_AUTH_TOKEN', saved.t); setAiProvider(undefined); });

  it('ключ Anthropic без AI_PROVIDER не включает помощника', () => {
    setAiProvider(undefined); set('AI_PROVIDER', ''); set('ANTHROPIC_API_KEY', 'test-key'); set('ANTHROPIC_AUTH_TOKEN', undefined);
    expect(aiAvailable()).toBe(false);
  });

  it('AI_PROVIDER=off выключает помощника даже с ключом', () => {
    setAiProvider(undefined); set('AI_PROVIDER', 'off'); set('ANTHROPIC_API_KEY', 'test-key');
    expect(aiAvailable()).toBe(false);
  });

  it('AI_PROVIDER=anthropic с ключом включает зарубежного провайдера явно', () => {
    setAiProvider(undefined); set('AI_PROVIDER', 'anthropic'); set('ANTHROPIC_API_KEY', 'test-key');
    expect(aiAvailable()).toBe(true);
  });
});

// Время замера в тексте отклонения («Замер 12.11, 17:48.») не должно «подтверждать» числа в ответе модели:
// иначе в 17:48 проходит выдуманное «48 часов» (тест stage7 падал в зависимости от времени запуска).
describe('проверка чисел в ответе не берёт их из дат и времени', () => {
  const answer = (do_now: string[]) => ({ found: 'x', why: 'x', do_now, dont: [], who_confirms: 'x', closes_when: 'x', citations: [], limitations: 'x', confidence: 'low' }) as never;
  it('часы и минуты, день и месяц из времени замера не разрешают число', () => {
    const ctx = { что: '«Холодильник»: 7,5 °C при пределе от 0 до 4 °C. Замер 12.11, 17:48.', журнал: 'проверено 03.11.2026 в 9:05:30' };
    expect(checkAnswer(answer(['Хранить не более 48 часов', 'Повторить через 12 минут', 'Выдержать 5 минут', 'Охладить за 3 часа']), [], ctx).unsupported)
      .toEqual(['48 часов', '12 минут', '5 минут', '3 часа']);
  });
  it('числа из самих данных по-прежнему разрешены', () => {
    const ctx = { что: '«Холодильник»: 7,5 °C при пределе от 0 до 4 °C. Замер 12.11, 17:48.' };
    expect(checkAnswer(answer(['Температура 7,5 °C выше предела 4 °C']), [], ctx).unsupported).toEqual([]);
  });
});
