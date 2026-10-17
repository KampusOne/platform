import { AppError } from './errors';

export function cataloguePage(raw: string | undefined, pageSize: number) {
  if (raw !== undefined && (!/^[1-9]\d{0,5}$/.test(raw) || Number(raw) > 100000))
    throw new AppError(400, 'BAD_REQUEST', 'Choose a valid page.');
  const page = Number(raw ?? 1);
  return { enabled: raw !== undefined, page, pageSize, offset: (page - 1) * pageSize };
}
export function cataloguePageInfo(request: { page: number; pageSize: number }, total: number) {
  return { page: request.page, pageSize: request.pageSize, total, totalPages: Math.max(1, Math.ceil(total / request.pageSize)) };
}
