import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import zipPack from 'vite-plugin-zip-pack';

// Strip type="module" and crossorigin from inline scripts for webXDC compatibility
function stripModuleAttrs() {
  return {
    name: 'strip-module-attrs',
    enforce: 'post',
    generateBundle(_, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type === 'asset' && file.fileName.endsWith('.html')) {
          file.source = file.source
            .replace(/ type="module"/g, '')
            .replace(/ crossorigin/g, '');
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [
    viteSingleFile(),
    stripModuleAttrs(),
    zipPack({
      inDir: 'dist',
      outDir: 'dist',
      outFileName: 'scramble.xdc',
    }),
  ],
  base: './',
  // `npm run dev` + `npm start` in server/: open /?relay to try the web embed
  server: {
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
  build: {
    outDir: 'dist',
    target: 'es2015',
    rollupOptions: {
      output: {
        format: 'iife',
      },
    },
  },
});
