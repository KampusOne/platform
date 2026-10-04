/**
 * Expo media hooks release their native SharedObject in a passive effect.
 * Invalidate callbacks in a layout-effect cleanup, before that release runs.
 * A lifetime belongs to one player/recorder, never to the whole component.
 */
export function createNativeMediaLifetime() {
  let active = true;
  return {
    isActive: () => active,
    activate() { active = true; },
    dispose() { active = false; },
    run<T>(operation: () => T): T | undefined {
      if (!active) return undefined;
      return operation();
    },
  };
}

export function isReleasedNativeMediaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return /shared object.*(?:already released|no longer available)|native object.*released|access.*released.*(?:player|recorder)/i.test(message);
}
