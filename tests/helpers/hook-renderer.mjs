/** Deterministic host for exercising effect cleanup and stateful recovery hooks, not native UI proof. */
export function hookRenderer() {
  const hooks = [], effects = []; let cursor = 0;
  const changed = (a, b) => !a || a.length !== b.length || a.some((value, i) => value !== b[i]);
  const react = {
    useRef(value) { const i = cursor++; return hooks[i] ??= { current: value }; },
    useState(initial) { const i = cursor++; if (!hooks[i]) hooks[i] = { value: typeof initial === 'function' ? initial() : initial }; return [hooks[i].value, next => { hooks[i].value = typeof next === 'function' ? next(hooks[i].value) : next; }]; },
    useCallback(fn, deps) { const i = cursor++; if (!hooks[i] || changed(hooks[i].deps, deps)) hooks[i] = { fn, deps }; return hooks[i].fn; },
    useMemo(fn, deps) { const i = cursor++; if (!hooks[i] || changed(hooks[i].deps, deps)) hooks[i] = { value: fn(), deps }; return hooks[i].value; },
    useEffectEvent(fn) { const i = cursor++; if (!hooks[i]) hooks[i] = { latest: fn, event: (...args) => hooks[i].latest(...args) }; hooks[i].next = fn; return hooks[i].event; },
    useEffect(fn, deps) { const i = cursor++; if (!hooks[i] || changed(hooks[i].deps, deps)) effects.push({ i, fn, deps, cleanup: hooks[i]?.cleanup }); },
  };
  return { react, render(fn) { cursor = 0; const result = fn(); for (const hook of hooks) if (hook?.next) hook.latest = hook.next; const work = effects.splice(0); for (const effect of work) effect.cleanup?.(); for (const effect of work) hooks[effect.i] = { deps: effect.deps, cleanup: effect.fn() }; return result; }, unmount() { for (const hook of hooks) hook?.cleanup?.(); } };
}
export function virtualClock() {
  let now = 0, sequence = 0; const timers = new Map();
  return { timers, schedule(callback, delay) { timers.set(++sequence, { callback, at: now + delay }); return sequence; }, cancel(id) { timers.delete(id); }, async advance(delay) { now += delay; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); } for (let i = 0; i < 40; i++) await Promise.resolve(); } };
}
