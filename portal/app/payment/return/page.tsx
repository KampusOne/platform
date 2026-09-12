import type { Metadata } from "next";

import { PaymentReturn } from "@/components/payment-return";

export const metadata: Metadata = { title: "Payment status" };

type PaymentSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PaymentReturnPage({
  searchParams,
}: {
  searchParams: PaymentSearchParams;
}) {
  const query = await searchParams;
  return (
    <PaymentReturn
      reference={first(query.reference) ?? first(query.trxref) ?? ""}
    />
  );
}
