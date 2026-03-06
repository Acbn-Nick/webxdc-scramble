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
