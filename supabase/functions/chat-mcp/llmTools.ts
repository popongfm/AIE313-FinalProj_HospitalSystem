// OpenAI-compatible chat completion WITH tool calling (default Groq). Keys come from environment secrets only.
import type { AssistantMsg, Msg, ToolDef } from './agent.ts';
const env = (name: string): string | undefined => (globalThis as unknown as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(name);

export function makeLlm(fetchFn: typeof fetch = fetch, opts: { apiKey?: string; model?: string; baseUrl?: string } = {}) {
  return async (messages: Msg[], tools: ToolDef[]): Promise<AssistantMsg> => {
    const apiKey = opts.apiKey ?? env('GROQ_API_KEY');
    if (!apiKey) throw new Error('LLM API key missing');
    const base = opts.baseUrl ?? env('LLM_BASE_URL') ?? 'https://api.groq.com/openai/v1';
    const res = await fetchFn(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: opts.model ?? env('LLM_MODEL') ?? 'llama-3.3-70b-versatile', temperature: 0, messages, tools, tool_choice: 'auto' }),
    });
    if (!res.ok) throw new Error(`LLM request failed: ${res.status}`);
    const m = (await res.json())?.choices?.[0]?.message;
    if (!m) throw new Error('LLM returned no message');
    return { role: 'assistant', content: m.content ?? null, tool_calls: m.tool_calls };
  };
}
