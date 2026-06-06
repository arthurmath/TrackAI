import { defineConfig } from 'vite';

// Rapier (compat build) embeds its WASM as base64, so no extra WASM plugin is
// required. We still flag the package for optimizeDeps so esbuild handles it.
export default defineConfig({
  assetsInclude: ['**/*.glb', '**/*.gltf', '**/*.hdr', '**/*.exr'],
  server: {
    port: 5173,
    open: true,
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
  },
});
