import { defineConfig } from 'vite';
import tailwind from '@tailwindcss/vite';
import backend from './server/vite-api.mjs';
export default defineConfig({
  plugins:[tailwind(),backend()],
  worker:{format:'es'},
  optimizeDeps:{include:['pdfjs-dist','tesseract.js']},
  build:{rollupOptions:{output:{assetFileNames(asset){
    return asset.names.includes('eng.traineddata.gz')?'assets/ocr/eng.traineddata.gz':'assets/[name]-[hash][extname]';
  }}}}
});
