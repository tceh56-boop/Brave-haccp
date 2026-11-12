import { afterEach, describe, expect, it } from 'vitest';
import { aiAvailable, setAiProvider } from '../src/server/ops/ai';

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
