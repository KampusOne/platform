import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { getDeviceCacheRevision, readOwnedDraft, saveOwnedDraft } from './device-cache';

export type MarketplaceCart = Record<string, number>;
type CartState = { items: MarketplaceCart; ready: boolean; error: string; saving: boolean };
const empty: CartState = { items: {}, ready: false, error: '', saving: false };
let state = empty, scope = '', epoch = 0, loading: Promise<void> | null = null;
let writes: Promise<void> = Promise.resolve();
let completedOrders: string[] = [];
const listeners = new Set<() => void>();
function notify(next: CartState) { state = next; for (const listener of listeners) listener(); }
const keyFor = (owner: string) => 'cart.' + owner;
function cartValue(value: unknown): MarketplaceCart {
  if (value === null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Your saved cart needs recovery. Try again before changing it.');
  const entries = Object.entries(value);
  if (entries.length > 50 || entries.some(([id,n]) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || !Number.isSafeInteger(n) || n < 1 || n > 99))
    throw new Error('Your saved cart needs recovery. Try again before changing it.');
  return Object.fromEntries(entries);
}
function activate(owner: string, revision: number) {
  const nextScope = owner ? owner + ':' + revision : '';
  if (scope !== nextScope) { scope = nextScope; epoch++; loading = null; completedOrders = []; notify(empty); }
  if (!owner || state.ready || loading) return;
  const turn = epoch;
  loading = readOwnedDraft<MarketplaceCart | {version:2;items:MarketplaceCart;completedOrders:string[]}>(keyFor(owner), revision).then(saved => {
    if (turn === epoch && revision === getDeviceCacheRevision()) {
      const record = saved && 'version' in saved && saved.version === 2 ? saved as {version:2;items:MarketplaceCart;completedOrders:string[]} : null;
      completedOrders = record && Array.isArray(record.completedOrders) ? record.completedOrders.filter(id=>typeof id==='string').slice(-200) : [];
      notify({ items: cartValue(record ? record.items : saved), ready: true, error: '', saving: false });
    }
  }).catch(error => {
    if (turn === epoch) notify({ ...empty, error: error instanceof Error ? error.message : 'Your cart could not be restored. Try again.' });
  }).finally(() => { if (turn === epoch) loading = null; });
}
function persist(owner: string, revision: number, items: MarketplaceCart): Promise<void> {
  const turn = epoch;
  const completed = [...completedOrders];
  const task = writes.then(async () => {
    if (turn !== epoch || revision !== getDeviceCacheRevision()) throw new Error('Your shopping session changed. Reopen the cart.');
    await saveOwnedDraft(keyFor(owner), {version:2,items,completedOrders:completed}, revision);
  });
  writes = task.catch(() => undefined);
  return task;
}

/** Called only after the server confirms payment. Receipt IDs and cart items
 * share one atomic encrypted record, so a retry cannot remove items twice. */
export async function confirmMarketplaceCartPurchase(owner: string, orderId: string, purchased: {product_id:string;quantity:number}[]) {
  const revision = getDeviceCacheRevision();
  activate(owner, revision);
  if (loading) await loading;
  if (!state.ready || revision !== getDeviceCacheRevision()) throw new Error('Your cart could not be restored. Your payment is confirmed; reopen Purchases to retry.');
  if (completedOrders.includes(orderId)) {await persist(owner,revision,state.items);return;}
  const items = {...state.items};
  for (const item of purchased) {
    const remaining = (items[item.product_id] ?? 0) - Number(item.quantity);
    if (remaining > 0) items[item.product_id] = remaining; else delete items[item.product_id];
  }
  completedOrders = [...completedOrders, orderId].slice(-200);
  notify({...state, items, saving:true});
  await persist(owner, revision, items);
  if (revision === getDeviceCacheRevision()) notify({...state, saving:false});
}

/** Catalogue, cart popup and checkout observe one owner-scoped cart. A covered screen cannot restore stale items. */
export function useMarketplaceCart(owner: string) {
  const revision = getDeviceCacheRevision(), expected = owner ? owner + ':' + revision : '';
  const subscribe = useCallback((listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, []);
  const snapshot = useCallback(() => scope === expected ? state : empty, [expected]);
  const current = useSyncExternalStore(subscribe, snapshot, () => empty);
  useEffect(() => { activate(owner, revision); }, [owner, revision]);
  const update = useCallback((change: MarketplaceCart | ((items: MarketplaceCart) => MarketplaceCart)) => {
    if (scope !== expected || !state.ready) return;
    const items = cartValue(typeof change === 'function' ? change(state.items) : change);
    notify({ items, ready: true, error: '', saving: true });
    void persist(owner, revision, items).then(() => {
      if (scope === expected && state.items === items) notify({ ...state, saving: false, error: '' });
    }).catch(error => {
      if (scope === expected && state.items === items) notify({ ...state, saving: false, error: error instanceof Error ? error.message : 'Your cart could not be saved. Keep this screen open and try again.' });
    });
  }, [owner, revision, expected]);
  const flush = useCallback(async () => {
    if (scope !== expected || !state.ready) throw new Error('Wait for your cart to restore before continuing.');
    const items = state.items;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        persist(owner, revision, items),
        new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Saving your cart took too long. Your items are kept here. Try again before checkout.')),5000);}),
      ]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
    if (scope !== expected || state.items !== items) throw new Error('Your cart changed. Review it before continuing.');
    notify({ ...state, saving: false, error: '' });
  }, [owner, revision, expected]);
  const retry = useCallback(() => { if (state.ready) void flush().catch(error => { if (scope === expected && revision === getDeviceCacheRevision()) notify({ ...state, error: error.message }); }); else activate(owner, revision); }, [owner, revision, expected, flush]);
  return { ...current, update, flush, retry };
}
