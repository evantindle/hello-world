import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['dist', 'node_modules', 'test-results', 'playwright-report', 'e2e-out']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // Simulation code must replay bit-for-bit in every browser (replays, shared links, level
    // solutions, multiplayer). Only + - * / and sqrt are exactly rounded everywhere.
    files: ['src/physics/**/*.ts', 'src/geom/**/*.ts', 'src/game/reshape.ts', 'src/game/placement.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...['hypot', 'atan2', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'exp', 'pow', 'log', 'cbrt'].map(
          (property) => ({
            object: 'Math',
            property,
            message: 'Not bit-reproducible across browsers: use + - * / and Math.sqrt (see hyp() in core/vec).',
          }),
        ),
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "BinaryExpression[operator='**']",
          message: 'Not bit-reproducible across browsers: multiply it out or use Math.sqrt.',
        },
      ],
    },
  },
]);
