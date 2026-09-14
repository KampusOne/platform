import { z } from "@kampusone/contracts";
import { AppError } from "./errors";
export async function input<T>(
  context: { req: { json(): Promise<unknown> } },
  schema: z.ZodType<T>,
): Promise<T> {
  const parsed = schema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success)
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Check the highlighted information and try again.",
      { fields: parsed.error.flatten().fieldErrors },
    );
  return parsed.data;
}
export function id(value: string) {
  if (!z.string().uuid().safeParse(value).success)
    throw new AppError(400, "BAD_REQUEST", "Invalid record identifier.");
  return value;
}
