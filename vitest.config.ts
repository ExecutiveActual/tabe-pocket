import { defineConfig } from 'vitest/config';
// the v1.1 island is ~25x the v1 map: multi-day runs need more than the 5 s default
export default defineConfig({ test: { testTimeout: 120000, hookTimeout: 120000 } });
