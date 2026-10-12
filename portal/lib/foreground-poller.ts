export type PollResult = 'changed' | 'unchanged' | 'done';
export type PollOptions = { intervalMs: number; maxAttempts: number; idleBackoff?: boolean; immediate?: boolean };
function transient(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const value = error as { status?: number; code?: string };
  return ['NETWORK_UNAVAILABLE', 'REQUEST_TIMEOUT'].includes(value.code ?? '') || value.status === 408 || value.status === 429 || typeof value.status === 'number' && value.status >= 500;
}
/** Serial, bounded status reads. Availability changes never reset the attempt budget. */
export class ForegroundPoller {
  private available = false;
  private stopped = false;
  private terminal = false;
  private running = false;
  private dirty = false;
  private attempts = 0;
  private failures = 0;
  private unchanged = 0;
  private epoch = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | null = null;
  constructor(private read: (signal: AbortSignal) => Promise<PollResult>, private options: PollOptions,
    private exhausted: () => void = () => {}, private schedule = setTimeout, private cancel = clearTimeout, private random = Math.random) {
    if (!Number.isFinite(options.intervalMs) || options.intervalMs < 1000 || !Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 1 || options.maxAttempts > 120) throw new Error('Invalid foreground refresh budget.');
  }
  setAvailable(value: boolean) {
    if (this.stopped || value === this.available) return;
    this.available = value;
    this.epoch++;
    this.controller?.abort();
    this.clearTimer();
    if (value) this.plan(this.options.immediate || this.attempts > 0 ? 0 : this.options.intervalMs);
  }
  restart() {
    if (this.stopped) return;
    this.epoch++;
    this.controller?.abort();
    this.attempts = this.failures = this.unchanged = 0;
    this.terminal = false;
    this.plan(0);
  }
  stop() { this.stopped = true; this.available = false; this.epoch++; this.controller?.abort(); this.clearTimer(); }
  private clearTimer() { if (this.timer !== undefined) this.cancel(this.timer); this.timer = undefined; }
  private plan(delay: number) {
    this.clearTimer();
    if (!this.available || this.stopped || this.terminal) return;
    if (this.running) { this.dirty = true; return; }
    if (this.attempts >= this.options.maxAttempts) { this.terminal = true; this.exhausted(); return; }
    this.timer = this.schedule(() => { this.timer = undefined; void this.tick(); }, Math.max(0, delay));
  }
  private async tick() {
    if (!this.available || this.stopped || this.terminal || this.running) return;
    this.running = true; this.dirty = false; this.attempts++;
    const epoch = this.epoch, controller = new AbortController(); this.controller = controller;
    let delay = this.options.intervalMs;
    try {
      const result = await this.read(controller.signal);
      if (controller.signal.aborted || epoch !== this.epoch) return;
      if (result === 'done') { this.terminal = true; return; }
      this.failures = 0;
      this.unchanged = result === 'changed' ? 0 : Math.min(this.unchanged + 1, 3);
      delay = Math.min(60_000, this.options.intervalMs * (this.options.idleBackoff ? 2 ** this.unchanged : 1));
    } catch (error) {
      if (controller.signal.aborted || epoch !== this.epoch) return;
      if (!transient(error)) { this.terminal = true; return; }
      this.failures = Math.min(this.failures + 1, 4);
      delay = Math.min(300_000, Math.max(this.options.intervalMs, (error as { status?: number }).status === 429 ? 30_000 : this.options.intervalMs * 2 ** this.failures) * (0.9 + this.random() * 0.2));
    } finally {
      this.running = false;
      if (this.controller === controller) this.controller = null;
      this.plan(this.dirty ? 0 : delay);
    }
  }
}
