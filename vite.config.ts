import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';
import firebaseConfig from './firebase-applet-config.json' with {type: 'json'};
import {buildCsp, securityHeaders} from './config/security-headers.ts';

/**
 * Production-only hardening: a Content-Security-Policy <meta> tag in index.html and a
 * ready-made `_headers` file (Netlify / Cloudflare Pages). Skipped in dev so Vite's HMR keeps working.
 * Set VITE_DISABLE_CSP=true when building to switch this off.
 */
function securityPlugin(): Plugin {
  const disabled = process.env.VITE_DISABLE_CSP === 'true';
  return {
    name: 'naijapages-security',
    apply: 'build',
    transformIndexHtml(html) {
      if (disabled) return html;
      const tag = `<meta http-equiv="Content-Security-Policy" content="${buildCsp(firebaseConfig.authDomain)}" />`;
      return html.replace('<head>', `<head>\n    ${tag}`);
    },
    generateBundle() {
      if (disabled) return;
      const lines = ['/*', ...Object.entries(securityHeaders(firebaseConfig.authDomain)).map(([k, v]) => `  ${k}: ${v}`)];
      lines.push('/assets/*', '  Cache-Control: public, max-age=31536000, immutable', '/index.html', '  Cache-Control: no-cache');
      this.emitFile({type: 'asset', fileName: '_headers', source: lines.join('\n') + '\n'});
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), securityPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    build: {
      // The Firebase SDK alone is ~590 kB; it is split out and cached separately, so this limit just silences the size warning.
      chunkSizeWarningLimit: 700,
      // Split big, rarely-changing code into its own files so returning visitors re-download less.
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {name: 'firebase', test: /node_modules[\\/](@firebase|firebase)[\\/]/, priority: 20},
              {name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 15},
              {name: 'seed-data', test: /src[\\/]data[\\/]/, priority: 10},
            ],
          },
        },
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: {
        '/api': {
          target: process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8787',
          changeOrigin: false,
          xfwd: true,
        },
      },
    },
  };
});
