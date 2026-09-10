import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { ApiError } from "@kampusone/contracts";

import type { Bindings, Variables } from "../types";

type AppContext = Context<{ Bindings: Bindings; Variables: Variables }>;
type ErrorCode = ApiError["error"]["code"];

export class AppError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorResponse(
  context: AppContext,
  status: ContentfulStatusCode,
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
) {
  return context.json<ApiError>(
    {
      error: {
        code,
        message,
        requestId: context.get("requestId"),
        ...(details ? { details } : {}),
      },
    },
    status,
  );
}
