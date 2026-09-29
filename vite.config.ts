import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the build works at any sub-path (GitHub Pages serves /hello-world/).
  base: './',
  build: { target: 'es2022' },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
