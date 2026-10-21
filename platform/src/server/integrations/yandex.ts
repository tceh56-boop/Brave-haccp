/**
 * Подключение к Yandex Cloud для распознавания документов (этап 17, настройка; логика распознавания — из MON CHEF).
 * Ключи — только в переменных окружения сервера (.env), в базе и в интерфейсе их нет:
 *   YANDEX_API_KEY  — API-ключ сервисного аккаунта (роли ai.vision.user и ai.languageModels.user) или
 *   YANDEX_IAM_TOKEN — IAM-токен (живёт до 12 часов; для постоянной работы — API-ключ);
 *   YANDEX_FOLDER_ID — каталог в Yandex Cloud;
 *   YANDEX_GPT_MODEL — модель для разбора текста, по умолчанию yandexgpt/latest;
 *   RECOGNITION_LLM_DISABLED=1 — только OCR без модели (как INVOICE_LLM_DISABLED в MON CHEF).
 * Обращения платные: каждое — только по явному действию пользователя, с учётом в лимите предприятия.
 */

export const OCR_URL = process.env.YANDEX_OCR_URL || 'https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText';
export const LLM_URL = process.env.YANDEX_LLM_URL || 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';

export interface YandexConfig { apiKey: string | null; iamToken: string | null; folderId: string | null; model: string; llmDisabled: boolean }

export function yandexConfig(): YandexConfig {
  const v = (k: string) => (process.env[k] || '').trim() || null;
  return { apiKey: v('YANDEX_API_KEY'), iamToken: v('YANDEX_IAM_TOKEN'), folderId: v('YANDEX_FOLDER_ID'), model: v('YANDEX_GPT_MODEL') || 'yandexgpt/latest',
    llmDisabled: process.env.RECOGNITION_LLM_DISABLED === '1' };
}

/** Состояние подключения для экрана настройки — без значений ключей. */
export function yandexStatus() {
  const c = yandexConfig();
  const missing = [!c.apiKey && !c.iamToken ? 'YANDEX_API_KEY' : null, !c.folderId ? 'YANDEX_FOLDER_ID' : null].filter(Boolean) as string[];
  return {
    configured: missing.length === 0, missing,
    auth: c.apiKey ? 'api_key' : c.iamToken ? 'iam_token' : null,
    folder: c.folderId ? `${c.folderId.slice(0, 4)}…${c.folderId.slice(-3)}` : null,
    model: c.model, llm: !c.llmDisabled,
  };
}

export function yandexHeaders(c = yandexConfig()): Record<string, string> {
  if ((!c.apiKey && !c.iamToken) || !c.folderId) throw new Error('Распознавание не настроено: на сервере не заданы YANDEX_API_KEY и YANDEX_FOLDER_ID.');
  return { 'content-type': 'application/json', 'x-folder-id': c.folderId, authorization: c.apiKey ? `Api-Key ${c.apiKey}` : `Bearer ${c.iamToken}` };
}

/** OCR страницы (изображение JPEG/PNG или PDF). Модель распознавания — как в MON CHEF: page, таблицы — table. */
export async function recognizeText(content: Buffer, mimeType: string, model: 'page' | 'table' = 'page') {
  const res = await fetch(OCR_URL, { method: 'POST', headers: yandexHeaders(),
    body: JSON.stringify({ mimeType, languageCodes: ['ru', 'en'], model, content: content.toString('base64') }), signal: AbortSignal.timeout(60_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Yandex Vision: ${res.status} ${(body as { message?: string }).message || ''}`.trim());
  return body as { result?: { textAnnotation?: { fullText?: string; blocks?: unknown[]; tables?: unknown[] } } };
}

/** Запрос к YandexGPT (температура 0 — разбор, а не сочинение). */
export async function complete(system: string, user: string, maxTokens = 4000) {
  const c = yandexConfig();
  if (c.llmDisabled) throw new Error('Модель отключена (RECOGNITION_LLM_DISABLED=1): используется только таблица распознавания.');
  const res = await fetch(LLM_URL, { method: 'POST', headers: yandexHeaders(c), signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({ modelUri: `gpt://${c.folderId}/${c.model}`, completionOptions: { stream: false, temperature: 0, maxTokens },
      messages: [{ role: 'system', text: system }, { role: 'user', text: user }] }) });
  const body = await res.json().catch(() => ({})) as { result?: { alternatives?: { message?: { text?: string } }[]; usage?: { totalTokens?: string } }; message?: string };
  if (!res.ok) throw new Error(`YandexGPT: ${res.status} ${body.message || ''}`.trim());
  return { text: body.result?.alternatives?.[0]?.message?.text || '', tokens: Number(body.result?.usage?.totalTokens || 0) };
}
