// OpenAI-compatible chat completion WITH tool calling (default Groq). Keys come from environment secrets only.
import type { AssistantMsg, Msg, ToolDef } from './agent.ts';
const env = (name: string): string | undefined => (globalThis as unknown as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(name);

// Groq retired llama-3.3-70b-versatile on 2026-08-16 (console.groq.com/docs/deprecations); override with the LLM_MODEL secret.
export const DEFAULT_MODEL = 'openai/gpt-oss-120b';
// "LLM request failed: 404 model_not_found: The model ... does not exist" -> goes to the function logs and chat_logs.
// Built from the provider's error code/message only; the API key is never part of it.
export async function llmHttpError(res: Response): Promise<Error> {
  let detail = '';
  try {
    const e = (await res.json())?.error;
    detail = [e?.code ?? e?.type, e?.message && String(e.message).slice(0, 160)].filter(Boolean).join(': ');
  } catch { /* body is not JSON */ }
  return new Error(`LLM request failed: ${res.status}${detail ? ' ' + detail : ''}`);
}

export function makeLlm(fetchFn: typeof fetch = fetch, opts: { apiKey?: string; model?: string; baseUrl?: string } = {}) {
  return async (messages: Msg[], tools: ToolDef[]): Promise<AssistantMsg> => {
    const apiKey = opts.apiKey ?? env('GROQ_API_KEY');
    if (!apiKey) throw new Error('LLM API key missing');
    const base = opts.baseUrl ?? env('LLM_BASE_URL') ?? 'https://api.groq.com/openai/v1';
    const res = await fetchFn(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: opts.model ?? env('LLM_MODEL') ?? DEFAULT_MODEL, temperature: 0, messages, tools, tool_choice: 'auto' }),
    });
    if (!res.ok) throw await llmHttpError(res);
    const m = (await res.json())?.choices?.[0]?.message;
    if (!m) throw new Error('LLM returned no message');
    return { role: 'assistant', content: m.content ?? null, tool_calls: m.tool_calls };
  };
}
