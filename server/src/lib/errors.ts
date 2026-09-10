import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { ApiError } from "@kampusone/contracts";

import type { Bindings, Variables } from "../types";

type AppContext = Context<{ Bindings: Bindings; Variables: Variables }>;
type ErrorCode = ApiError["error"]["code"];

export function errorResponse(
  context: AppContext,
  status: ContentfulStatusCode,
  code: ErrorCode,
  message: string,
) {
  return context.json<ApiError>(
    {
      error: {
        code,
        message,
        requestId: context.get("requestId"),
      },
    },
    status,
  );
}
