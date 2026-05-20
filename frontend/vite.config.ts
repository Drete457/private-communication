/// <reference types="vitest/config" />

import path from 'path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';



// https://vitejs.dev/config/
const devProxyTarget = process.env.VITE_DEV_PROXY_TARGET ?? 'http://localhost:8080';
const devWsTarget = devProxyTarget.replace(/^http/, 'ws');
const BACKUP_CORE_VENDOR_PACKAGES = new Set([
  '@private-communication/pcbk-core',
  '@scure/bip39',
  'cbor-x',
  'hash-wasm'
]);
const BACKUP_STRENGTH_VENDOR_PACKAGES = new Set([
  '@zxcvbn-ts/core',
  '@zxcvbn-ts/language-common'
]);

const getNodeModulePackageName = (id: string): string | undefined => {
  const normalizedId = id.replace(/\\/g, '/');
  const nodeModulesMarker = '/node_modules/';
  const markerIndex = normalizedId.lastIndexOf(nodeModulesMarker);

  if (markerIndex === -1)
    return undefined;

  const packagePath = normalizedId.slice(markerIndex + nodeModulesMarker.length);
  const [firstSegment, secondSegment] = packagePath.split('/');

  if (!firstSegment)
    return undefined;

  if (firstSegment.startsWith('@') && secondSegment)
    return `${firstSegment}/${secondSegment}`;

  return firstSegment;
};

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const packageName = getNodeModulePackageName(id);

          if (!packageName)
            return undefined;

          if (packageName === 'react' || packageName === 'react-dom' || packageName === 'scheduler')
            return 'vendor-react';

          if (packageName === 'react-router' || packageName === 'react-router-dom')
            return 'vendor-router';

          if (packageName === 'zustand')
            return 'vendor-state';

          if (packageName === 'dexie')
            return 'vendor-storage';

          if (packageName === 'qrcode' || packageName === 'qr-scanner')
            return 'vendor-qr';

          if (BACKUP_CORE_VENDOR_PACKAGES.has(packageName))
            return 'vendor-backup-core';

          if (BACKUP_STRENGTH_VENDOR_PACKAGES.has(packageName))
            return 'vendor-backup-strength';

          if (packageName.startsWith('workbox-'))
            return 'vendor-pwa';

          return 'vendor';
        }
      }
    }
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      devOptions: {
        enabled: true,
        type: 'module'
      },
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'favicon-96x96.png', 'favicon.svg'],
      manifest: {
        name: 'Private Communication',
        short_name: 'PC',
        description: 'Secure end-to-end encrypted P2P communication',
        theme_color: '#0a1528',
        background_color: '#0a1528',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {
            src: '/web-app-manifest-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable'
          },
          {
            src: '/web-app-manifest-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']
      }
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@services': path.resolve(__dirname, './src/services'),
      '@crypto': path.resolve(__dirname, './src/crypto'),
      '@store': path.resolve(__dirname, './src/store'),
      '@types': path.resolve(__dirname, './src/types'),
    }
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}']
  },
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/health': devProxyTarget,
      '/api': {
        target: devProxyTarget,
        changeOrigin: true
      },
      '/ws': {
        target: devWsTarget,
        ws: true,
        changeOrigin: true
      }
    }
  }
});
