import { createRequire } from 'node:module';

// Mobile CI installs mobile dependencies; the root regression job installs the server.
export const typescript = (() => {
  for (const packagePath of ['../../mobile/package.json', '../../server/package.json']) {
    try {
      return createRequire(new URL(packagePath, import.meta.url))('typescript');
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error;
    }
  }
  throw new Error('Install the locked mobile or server dependencies before running these regressions.');
})();
