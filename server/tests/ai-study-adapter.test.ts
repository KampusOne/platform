import { describe, expect, it, vi } from "vitest";
import { assertAIConfiguration, generateAI, selectAIProvider, type AIEnvironment, type AIMode } from "../src/lib/ai-provider";

const env: AIEnvironment = { AI_ASSISTANT_ENABLED: "true", GEMINI_API_KEY: "synthetic-google-key", GEMINI_MODEL: "gemini-test", HF_TOKEN: "hf_SYNTHETIC", HF_CHAT_MODEL: "test/model:nscale", HF_VISION_MODEL: "test/vision" };

describe("study provider adapter boundaries", () => {
  it.each(["study", "summary", "notes", "quiz"] as AIMode[])("requires explicit HF selection for %s", mode => {
    expect(selectAIProvider(mode)).toBe("gemini");
    expect(selectAIProvider(mode, undefined, "huggingface")).toBe("huggingface");
  });
  it.each(["application/pdf", "image/jpeg", "image/png", "image/webp"])("rejects HF study media %s before an outbound call", async mimeType => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(generateAI(env, { mode: "study", provider: "huggingface", prompt: "Read this", media: { mimeType, data: "PRIVATE_SOURCE" } }, fetcher)).rejects.toMatchObject({ reason: "AI_UNSUPPORTED_MEDIA", status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("allows the text/plain configuration used before the route extracts UTF-8 text", () => {
    expect(assertAIConfiguration(env, "summary", "text/plain", "huggingface").provider).toBe("huggingface");
  });
  it("keeps timetable image/text on HF and timetable PDF on Gemini", () => {
    expect(selectAIProvider("timetable")).toBe("huggingface");
    expect(selectAIProvider("timetable", "image/jpeg")).toBe("huggingface");
    expect(selectAIProvider("timetable", "application/pdf")).toBe("gemini");
  });
  it("pins the selected HF model, limits output and keeps only recent study history", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ finish_reason: "stop", message: { content: "A short answer" } }] }));
    const history = Array.from({ length: 10 }, (_, i) => ({ prompt: "question-" + i, text: "answer-" + i }));
    expect(await generateAI(env, { mode: "study", provider: "huggingface", prompt: "New question", history }, fetcher)).toEqual({ text: "A short answer", provider: "huggingface" });
    const init = fetcher.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("test/model:nscale");
    expect(body.max_tokens).toBe(4096);
    expect(body.stream).toBe(false);
    expect(body.messages).toHaveLength(14);
    expect(body.messages[1].content).toBe("question-4");
    expect(init?.signal).toBeDefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["", "not JSON", JSON.stringify({ error: { message: "Permission denied PRIVATE_INPUT" } }), "x".repeat(17000)])("keeps non-project Gemini denials generic and redacted (%#)", async body => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 403 }));
    await expect(generateAI(env, { mode: "study", prompt: "Question" }, fetcher)).rejects.toMatchObject({ reason: "AI_PROVIDER_AUTH" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not expose raw Google project IDs, keys or request text", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { message: "Your project has been denied access PRIVATE_INPUT synthetic-google-key" } }, { status: 403 }));
    const error = await generateAI(env, { mode: "study", prompt: "Question" }, fetcher).catch(value => value as Error & { reason: string });
    expect(error).toMatchObject({ reason: "AI_PROJECT_ACCESS_DENIED" });
    expect(String(error)).not.toContain("PRIVATE_INPUT");
    expect(String(error)).not.toContain("synthetic-google-key");
  });
  it("never misclassifies an HF rejection as Google's project restriction", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { message: "project has been denied access" } }, { status: 403 }));
    await expect(generateAI(env, { mode: "study", provider: "huggingface", prompt: "Question" }, fetcher)).rejects.toMatchObject({ reason: "AI_PROVIDER_AUTH" });
  });
  it("rejects truncated HF outputs instead of saving a misleading completed answer", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ finish_reason: "length", message: { content: "Incomplete" } }] }));
    await expect(generateAI(env, { mode: "study", provider: "huggingface", prompt: "Question" }, fetcher)).rejects.toMatchObject({ reason: "AI_INCOMPLETE" });
  });
});
