import { z } from "@kampusone/contracts";
import { AppError } from "./errors";
export async function input<T>(
  context: { req: { json(): Promise<unknown> } },
  schema: z.ZodType<T>,
  fieldLabels?: Record<string, string>,
): Promise<T> {
  const parsed = schema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success)
    throw new AppError(
      400,
      "BAD_REQUEST",
      fieldLabels
        ? parsed.error.issues.slice(0, 3).map(issue => {
            const label = fieldLabels[String(issue.path[0])];
            return label ? `${label}: ${issue.message}` : 'Review the order details and try again.';
          }).join(' ')
        : "Some information is missing or invalid. Review your entries and try again.",
      { fields: parsed.error.flatten().fieldErrors },
    );
  return parsed.data;
}
export function id(value: string) {
  if (!z.string().uuid().safeParse(value).success)
    throw new AppError(400, "BAD_REQUEST", "Invalid record identifier.");
  return value;
}
