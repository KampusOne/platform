export type SupportRequest = {
  id: string;
  subject: string;
  status: string;
  reply: string | null;
};

/** Saved requests can outlive API versions; only render usable records. */
export function supportRequests(payload: unknown): SupportRequest[] {
  if (!payload || typeof payload !== 'object' || !('requests' in payload) || !Array.isArray(payload.requests)) return [];
  return payload.requests.flatMap((value: unknown) => {
    if (!value || typeof value !== 'object') return [];
    const row = value as Record<string, unknown>;
    if (typeof row.id !== 'string' || !row.id || typeof row.subject !== 'string') return [];
    return [{
      id: row.id,
      subject: row.subject,
      status: typeof row.status === 'string' ? row.status : 'OPEN',
      reply: typeof row.reply === 'string' && row.reply.trim() ? row.reply : null,
    }];
  });
}
