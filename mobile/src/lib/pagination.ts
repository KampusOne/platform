export const MARKETPLACE_PAGE_SIZE = 24;
export const LEARNING_PAGE_SIZE = 30;

export type PageInfo = { page: number; pageSize: number; total: number; totalPages: number };

/** Five page slots keep the complete control usable on a 320 px phone. */
export function pageSlots(page: number, totalPages: number): (number | 'gap')[] {
  if (totalPages <= 4) return Array.from({ length: Math.max(0, totalPages) }, (_, i) => i + 1);
  if (page <= 3) return [1, 2, 3, 'gap', totalPages];
  if (page >= totalPages - 2) return [1, 'gap', totalPages - 2, totalPages - 1, totalPages];
  return [1, 'gap', page, 'gap', totalPages];
}
