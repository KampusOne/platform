export type PendingText = {
    id: string;
    body: string;
    replyToMessageId?: string;
    retry?: {
        attempts: number;
        nextAttemptAt: number;
        blocked: boolean;
        error?: string;
    };
};
export type QueuedText = {
    threadId: string;
    message: PendingText;
};
export function retryableTextError(error: unknown) {
    if (!error || typeof error !== 'object')
        return false;
    const value = error as {
        status?: number;
        code?: string;
    };
    return ['NETWORK_UNAVAILABLE', 'NETWORK_ERROR', 'REQUEST_TIMEOUT', 'OFFLINE'].includes(value.code ?? '') || value.status === 408 || value.status === 429 || typeof value.status === 'number' && value.status >= 500;
}
/** Only previously submitted plain text. One transfer at a time; no financial or media operations. */
export class TextRetryCoordinator {
    private active = false;
    private stopped = false;
    private epoch = 0;
    private running = false;
    private dirty = false;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private controller: AbortController | null = null;
    private storageFailures = 0;
    constructor(private list: () => Promise<QueuedText[]>, private send: (value: QueuedText, signal: AbortSignal) => Promise<void>, private acknowledge: (value: QueuedText) => Promise<void>, private defer: (value: QueuedText, retry: NonNullable<PendingText['retry']>) => Promise<void>, private now = Date.now, private schedule = (callback:()=>void,delay:number)=>setTimeout(callback,delay), private cancel = (timer:ReturnType<typeof setTimeout>)=>clearTimeout(timer), private random = Math.random) { }
    setAvailable(value: boolean) { if (this.stopped || value === this.active)
        return; this.active = value; this.epoch++; this.controller?.abort(); if (this.timer)
        this.cancel(this.timer); this.timer = undefined; if (value) {
        this.storageFailures = 0;
        this.wake();
    } }
    stop() { this.stopped = true; this.setAvailable(false); this.active = false; this.epoch++; this.controller?.abort(); if (this.timer)
        this.cancel(this.timer); this.timer = undefined; }
    wake() { if (!this.active || this.stopped)
        return; if (this.running) {
        this.dirty = true;
        return;
    } this.plan(0); }
    private plan(delay: number) { if (this.timer)
        this.cancel(this.timer); if (!this.active || this.stopped)
        return; this.timer = this.schedule(() => { this.timer = undefined; void this.tick(); }, Math.max(0, delay)); }
    private async tick() {
        if (this.running || !this.active || this.stopped)
            return;
        this.running = true;
        this.dirty = false;
        const epoch = this.epoch;
        let delay: number | undefined;
        try {
            const queue = (await this.list()).filter(value => value.message.retry && !value.message.retry.blocked && value.message.retry.attempts < 5).slice(0, 40);
            if (epoch !== this.epoch || !this.active)
                return;
            const now = this.now();
            queue.sort((a, b) => a.message.retry!.nextAttemptAt - b.message.retry!.nextAttemptAt);
            const value = queue[0];
            if (!value)
                return;
            if (value.message.retry!.nextAttemptAt > now) {
                delay = Math.min(300000, value.message.retry!.nextAttemptAt - now);
                return;
            }
            const controller = new AbortController();
            this.controller = controller;
            try {
                await this.send(value, controller.signal);
                if (epoch === this.epoch && this.active && !controller.signal.aborted)
                    await this.acknowledge(value);
            }
            catch (error) {
                if (epoch !== this.epoch || !this.active || controller.signal.aborted)
                    return;
                const attempts = value.message.retry!.attempts + 1;
                const blocked = !retryableTextError(error) || attempts >= 5;
                await this.defer(value, { attempts, blocked, nextAttemptAt: now + Math.min(300000, (error as {
                        status?: number;
                    })?.status === 429 ? 30000 : 2000 * 2 ** attempts * (0.75 + this.random() * 0.5)), error: error instanceof Error ? error.message.slice(0, 240) : 'Message confirmation failed. Retry when connected.' });
            }
            finally {
                if (this.controller === controller)
                    this.controller = null;
            }
            this.storageFailures = 0;
            delay = 0;
        }
        catch {
            // Storage failure never authorizes an unpersisted send or an infinite retry loop.
            if (++this.storageFailures <= 3)
                delay = Math.min(30000, 5000 * 2 ** (this.storageFailures - 1));
        }
        finally {
            this.running = false;
            if (this.active && !this.stopped) {
                if (this.dirty)
                    this.plan(0);
                else if (delay !== undefined)
                    this.plan(delay);
            }
        }
    }
}
