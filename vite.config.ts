import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({ base: '/my-gantt-chart/', plugins: [react()], test: { environment: 'jsdom' } });
