import { defineConfig } from 'vite';

// Relative base so the same build works at /, /sicalc/ (GitHub Pages) and inside Capacitor.
export default defineConfig({ base: './' });
