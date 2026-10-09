import { AIProviderError } from './ai-error.ts';
import type { AIInput, AIMessage, AITool } from './ai-provider.ts';

export type WorkersAIBinding = {
  run(model: string, input: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown>;
};
export type WorkersAIEnvironment = {
  AI?: WorkersAIBinding;
  AI_TEXT_PROVIDER?: string;
  WORKERS_AI_CHAT_MODEL?: string;
  WORKERS_AI_PRO_MODEL?: string;
};
export function workersAIConfiguration(env: WorkersAIEnvironment, tier = 'standard') {
  const chat = env.WORKERS_AI_CHAT_MODEL?.trim() || '@cf/meta/llama-3.1-8b-instruct-fast';
  const model = tier === 'pro' ? env.WORKERS_AI_PRO_MODEL?.trim() || '@cf/meta/llama-3.3-70b-instruct-fp8-fast' : chat;
  return { model, configured: typeof env.AI?.run === 'function' && /^@cf\/[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(model) };
}
/** Return the same completion shape as the HF adapter. Never execute tools here. */
export async function workersAICompletion(env: WorkersAIEnvironment, input: AIInput, messages: AIMessage[], tools: AITool[] | undefined, maxTokens: number, timeoutMs: number): Promise<unknown> {
  const config = workersAIConfiguration(env, input.tier);
  if (!config.configured) throw new AIProviderError(503, 'AI_NOT_CONFIGURED', 'This AI option is temporarily unavailable. Your draft is kept.');
  // The native API accepts traditional function results as role=tool messages.
  const nativeMessages = messages.map(message => message.tool_calls?.length ? {
    role: message.role, content: JSON.stringify(message.tool_calls.map(call => ({ name: call.function.name, arguments: JSON.parse(call.function.arguments) }))),
  } : { role: message.role, content: message.content });
  let result: unknown;
  try {
    result = await env.AI!.run(config.model, {
      messages: nativeMessages, max_tokens: maxTokens, temperature: 0.2, stream: false,
      ...(tools?.length ? { tools: tools.map(tool => tool.function) } : {}),
    }, { signal: AbortSignal.timeout(Math.max(1, timeoutMs)) });
  } catch (error) {
    if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) throw new AIProviderError(504, 'AI_TIMEOUT', 'AI took too long. Your draft is kept.');
    // Cloudflare AiError embeds an internal code. Log only the classified code.
    const code = /\b(3036|3040|5035|5016|5018|3023|3041|3007|3008)\b/.exec(error instanceof Error ? error.message : '')?.[1];
    console.warn(JSON.stringify({ event: 'ai.provider.failed', provider: 'workers-ai', code: code ?? 'unclassified' }));
    if (code === '3036') throw new AIProviderError(503, 'AI_PROVIDER_QUOTA', 'Kira has reached its service allowance. Your draft is kept; please try again later.');
    if (code === '3040') throw new AIProviderError(503, 'AI_PROVIDER_BUSY', 'Kira is busy right now. Your draft is kept; try again shortly.');
    if (code === '3007' || code === '3008') throw new AIProviderError(504, 'AI_TIMEOUT', 'AI took too long. Your draft is kept.');
    throw new AIProviderError(503, 'AI_PROVIDER_UNAVAILABLE', 'AI could not respond right now. Your draft is kept; please try again later.');
  }
  if (!result || typeof result !== 'object') throw new AIProviderError(502, 'AI_INVALID_OUTPUT', 'AI returned an unreadable answer. Your draft is kept.');
  const value = result as { response?: unknown; tool_calls?: unknown; choices?: unknown; usage?: { completion_tokens?: number }; finish_reason?: unknown };
  // Some newer models already return OpenAI-format choices.
  if (Array.isArray(value.choices)) return value;
  const calls = Array.isArray(value.tool_calls) ? value.tool_calls.map((entry, index) => {
    if (entry && typeof entry === 'object' && 'function' in entry) return entry;
    if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || entry.arguments === undefined) throw new AIProviderError(502, 'AI_INVALID_OUTPUT', 'That action was not understood. Nothing was changed.');
    return { id: `call_cf_${index}`, type: 'function', function: { name: entry.name, arguments: typeof entry.arguments === 'string' ? entry.arguments : JSON.stringify(entry.arguments) } };
  }) : [];
  // The native response has no finish_reason; usage reveals token exhaustion.
  return { choices: [{ finish_reason: value.finish_reason ?? (Number(value.usage?.completion_tokens) >= maxTokens ? 'length' : calls.length ? 'tool_calls' : 'stop'), message: { content: value.response, tool_calls: calls } }] };
}
