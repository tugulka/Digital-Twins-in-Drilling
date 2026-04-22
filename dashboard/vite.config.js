/**
 * @fileoverview Vite bundler config for the dashboard SPA.
 * Uses `@vitejs/plugin-react` for Fast Refresh and JSX transform.
 * @see https://vite.dev/config/
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
