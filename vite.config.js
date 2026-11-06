import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The `--ssr` test bundles are built without the browser plugin chain, and
  // esbuild's default classic runtime made every component in them need a React
  // import none of them have.
  esbuild: { jsx: 'automatic' },
})
