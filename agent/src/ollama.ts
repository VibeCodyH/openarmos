// Thin Ollama client. Everything runs against the local model — no cloud call.

import { config } from "./config.ts";

// Reasoning models (qwen3, etc.) emit a <think>…</think> block; we ask Ollama to
// disable it via `think:false`, and strip any that leaks through as a fallback.
const stripThink = (s: string): string =>
  s.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

export async function generate(prompt: string, system?: string, timeoutMs = 20_000): Promise<string> {
  const res = await fetch(`${config.ollamaUrl}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: config.ollamaModel,
      prompt,
      system,
      stream: false,
      think: false,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { response?: string };
  return stripThink(data.response ?? "");
}
