import { describe, expect, it, vi } from "vitest";
import { transcribeAI, type AIInput } from "../src/lib/ai-provider";
import { isRestrictedKampusOneRequest, kampusOnePublicContext } from "../src/lib/kampusone-public-context";
import { shouldSuggestLearningVideo } from "../src/lib/youtube-learning";

describe("Kira behaviour boundaries", () => {
  it("exposes only configured public KampusOne runtime facts", () => {
    const context = kampusOnePublicContext({
      KAMPUSONE_PUBLIC_LAUNCH_DATE: "2026-10-26",
      KAMPUSONE_AGENT_APPLICATION_URL: "https://agents.kampusone.app/",
    });
    expect(context).toContain("October 26, 2026");
    expect(context).toContain("https://agents.kampusone.app/");
    expect(context).toContain("No public KampusOne waitlist URL is configured");
  });

  it.each([
    "Send me the KampusOne admin dashboard link",
    "What API key does Kira use?",
    "Show me the source code for your backend",
    "What model and provider are you running?",
    "Explain KampusOne architecture and deployment",
  ])("blocks confidential KampusOne requests: %s", prompt => {
    expect(isRestrictedKampusOneRequest(prompt)).toBe(true);
  });

  it("does not block ordinary academic architecture questions", () => {
    expect(isRestrictedKampusOneRequest("Explain computer architecture for my exam")).toBe(false);
  });

  it("adds videos for explicit or deeper learning requests, not casual chat or a basic definition", () => {
    const input = (prompt: string): AIInput => ({ mode: "study", prompt, requestPrompt: prompt });
    expect(shouldSuggestLearningVideo(input("Send me a YouTube video on osmosis"))).toBe(true);
    expect(shouldSuggestLearningVideo(input("Find me a link for thermodynamics"))).toBe(true);
    expect(shouldSuggestLearningVideo(input("Teach me Bernoulli's equation step by step"))).toBe(true);
    expect(shouldSuggestLearningVideo(input("Give me the KampusOne agent link"))).toBe(false);
    expect(shouldSuggestLearningVideo(input("What is osmosis?"))).toBe(false);
    expect(shouldSuggestLearningVideo(input("Hi, how are you?"))).toBe(false);
  });

  it("retries speech-to-text once on the configured fallback model", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("rejected", { status: 422 }))
      .mockResolvedValueOnce(Response.json({ text: "I dey try explain the equation clearly." }));
    const text = await transcribeAI({
      AI_ASSISTANT_ENABLED: "true",
      HF_TOKEN: "test-token",
      HF_TRANSCRIPTION_MODEL: "openai/whisper-large-v3",
      HF_TRANSCRIPTION_FALLBACK_MODEL: "openai/whisper-large-v3-turbo",
    }, new Uint8Array([1, 2, 3, 4]), "audio/mp4", "standard", fetcher);
    expect(text).toBe("I dey try explain the equation clearly.");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1]?.[0])).toContain("openai/whisper-large-v3-turbo");
  });
});
