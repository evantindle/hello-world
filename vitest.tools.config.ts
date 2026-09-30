import { defineConfig } from 'vitest/config';

/** Offline tools (balance agents, the level solver): slow, never part of `npm test`. */
export default defineConfig({
  test: {
    include: ['tools/**/*.tool.ts'],
    environment: 'node',
    testTimeout: 30 * 60 * 1000,
  },
});
