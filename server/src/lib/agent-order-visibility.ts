import { sql } from 'drizzle-orm';
import { paidAgentOrderStatuses } from '@kampusone/contracts';

/** Failed, pending, cancelled and reversed orders belong to buyer/admin views. */
export function paidAgentOrders(alias = 'orders') {
  return sql`${sql.identifier(alias)}.status in (${sql.join(paidAgentOrderStatuses.map(status => sql`${status}`), sql`, `)})`;
}
