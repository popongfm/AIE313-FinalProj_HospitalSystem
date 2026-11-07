// Thin client for an OpenAI-compatible chat API (default: Groq). Keys come from environment secrets only.
export type LlmOpts = { apiKey?: string; model?: string; baseUrl?: string };
const env = (name: string): string | undefined => {
  const g = globalThis as unknown as { Deno?: { env: { get(k: string): string | undefined } }; process?: { env: Record<string, string | undefined> } };
  return g.Deno?.env.get(name) ?? g.process?.env[name];
};
export function extractSql(text: string): string {
  const fenced = /```(?:sql)?\s*([\s\S]*?)```/i.exec(text);
  return (fenced ? fenced[1] : text).trim();
}
async function complete(messages: { role: string; content: string }[], fetchFn: typeof fetch, opts: LlmOpts): Promise<string> {
  const apiKey = opts.apiKey ?? env('GROQ_API_KEY');
  if (!apiKey) throw new Error('LLM API key missing');
  const base = opts.baseUrl ?? env('LLM_BASE_URL') ?? 'https://api.groq.com/openai/v1';
  const res = await fetchFn(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: opts.model ?? env('LLM_MODEL') ?? 'llama-3.3-70b-versatile', temperature: 0, messages }),
  });
  if (!res.ok) throw new Error(`LLM request failed: ${res.status}`);
  const data = await res.json();
  return String(data?.choices?.[0]?.message?.content ?? '');
}
export async function generateSql(question: string, schemaPrompt: string, fetchFn: typeof fetch, opts: LlmOpts = {}): Promise<string> {
  return extractSql(await complete([{ role: 'system', content: schemaPrompt }, { role: 'user', content: question }], fetchFn, opts));
}
export async function summarize(question: string, columns: string[], rows: unknown[][], fetchFn: typeof fetch, opts: LlmOpts = {}): Promise<string> {
  const system = 'You are a hospital data assistant. Answer in the same language as the question, briefly, using ONLY the data provided. Never invent numbers.';
  const user = JSON.stringify({ question, columns, rows: rows.slice(0, 30) });
  return (await complete([{ role: 'system', content: system }, { role: 'user', content: user }], fetchFn, opts)).trim();
}
