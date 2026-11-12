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
export async function complete(system: string, user: string, maxTokens = 4000, opts: { model?: string; assistant?: boolean; json?: boolean } = {}) {
  const c = yandexConfig();
  // RECOGNITION_LLM_DISABLED выключает модель только для разбора документов; помощник (assistant) включается своей настройкой AI_PROVIDER
  if (c.llmDisabled && !opts.assistant) throw new Error('Модель отключена (RECOGNITION_LLM_DISABLED=1): используется только таблица распознавания.');
  const res = await fetch(LLM_URL, { method: 'POST', headers: yandexHeaders(c), signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({ modelUri: `gpt://${c.folderId}/${opts.model || c.model}`, completionOptions: { stream: false, temperature: 0, maxTokens }, ...(opts.json ? { jsonObject: true } : {}),
      messages: [{ role: 'system', text: system }, { role: 'user', text: user }] }) });
  const body = await res.json().catch(() => ({})) as { result?: { alternatives?: { message?: { text?: string } }[]; usage?: { totalTokens?: string } }; message?: string };
  if (!res.ok) throw new Error(`YandexGPT: ${res.status} ${body.message || ''}`.trim());
  return { text: body.result?.alternatives?.[0]?.message?.text || '', tokens: Number(body.result?.usage?.totalTokens || 0) };
}

/**
 * OpenAI-совместимый API Yandex AI Studio (chat/completions) — нужен ЦЕХ AI-агенту: в нём документирован вызов функций (tools).
 * Адрес меняется настройкой YANDEX_CHAT_URL. Каталог передаётся заголовком OpenAI-Project, модель — как gpt://<каталог>/<модель>.
 */
export const CHAT_URL = process.env.YANDEX_CHAT_URL || 'https://ai.api.cloud.yandex.net/v1/chat/completions';

export interface ChatToolCall { id?: string; type?: 'function'; function: { name: string; arguments: string | Record<string, unknown> } }
export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };
export interface ChatTool { type: 'function'; function: { name: string; description: string; parameters: unknown } }
export interface ChatResult { message: { content?: string | null; tool_calls?: ChatToolCall[] }; finish_reason: string | null; model: string; usage: { prompt_tokens?: number; completion_tokens?: number } | null }

export async function chat(messages: ChatMessage[], opts: { model?: string; tools?: ChatTool[]; maxTokens?: number; json?: boolean } = {}): Promise<ChatResult> {
  const c = yandexConfig();
  const headers = { ...yandexHeaders(c), 'OpenAI-Project': c.folderId! };
  const res = await fetch(CHAT_URL, { method: 'POST', headers, signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({ model: `gpt://${c.folderId}/${opts.model || c.model}`, messages, temperature: 0, max_tokens: opts.maxTokens || 4000,
      ...(opts.tools?.length ? { tools: opts.tools, tool_choice: 'auto' } : {}), ...(opts.json ? { response_format: { type: 'json_object' } } : {}) }) });
  const body = await res.json().catch(() => ({})) as { choices?: { message?: ChatResult['message']; finish_reason?: string }[]; model?: string; usage?: ChatResult['usage']; error?: { message?: string }; message?: string };
  if (!res.ok) throw new Error(`YandexGPT: ${res.status} ${body.error?.message || body.message || ''}`.trim());
  const ch = body.choices?.[0];
  return { message: ch?.message || {}, finish_reason: ch?.finish_reason || null, model: body.model || opts.model || c.model, usage: body.usage || null };
}
