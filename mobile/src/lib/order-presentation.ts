export function orderStatusLabel(status: string, pickup = false): string {
  const labels: Record<string, string> = {
    PENDING_PAYMENT: 'Awaiting payment', PAID: 'Payment received', ACCEPTED: 'Preparing your items',
    READY: pickup ? 'Ready for pickup' : 'Ready for delivery', IN_DELIVERY: 'On the way',
    DELIVERED: pickup ? 'Collected' : 'Delivered', CANCELLED: 'Cancelled',
    PAYMENT_FAILED: 'Payment failed', DISPUTED: 'Under review', REFUNDED: 'Refunded',
  };
  return labels[status] ?? status.toLowerCase().replaceAll('_', ' ').replace(/^./, value => value.toUpperCase());
}

export function orderDate(value: string | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  return new Date(value).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function orderStages(status: string, pickup: boolean) {
  const states = ['PAID', 'ACCEPTED', 'READY', 'IN_DELIVERY', 'DELIVERED'];
  const position = states.indexOf(status);
  return [
    { label: 'Paid', icon: 'card-outline' as const, complete: position >= 0 },
    { label: 'Preparing', icon: 'bag-handle-outline' as const, complete: position >= 1 },
    { label: pickup ? 'Ready' : 'On the way', icon: pickup ? 'storefront-outline' as const : 'bicycle-outline' as const, complete: position >= (pickup ? 2 : 3) },
    { label: pickup ? 'Collected' : 'Delivered', icon: 'checkmark-outline' as const, complete: status === 'DELIVERED' },
  ];
}
