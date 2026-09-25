export class AIProviderError extends Error {
  readonly status: 400 | 422 | 429 | 502 | 503 | 504;
  readonly reason: string;
  constructor(status: AIProviderError["status"], reason: string, message: string) {
    super(message); this.name = "AIProviderError"; this.status = status; this.reason = reason;
  }
}
