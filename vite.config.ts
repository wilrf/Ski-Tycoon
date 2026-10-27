import { defineConfig } from 'vitest/config';

// Relative base so the build works under the GitHub Pages project path (/ski-tycoon/).
export default defineConfig({
  base: './',
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
