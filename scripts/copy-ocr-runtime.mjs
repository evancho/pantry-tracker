import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'public', 'ocr-runtime');
mkdirSync(dest, { recursive: true });

const files = [
  [
    'node_modules/tesseract.js/dist/worker.min.js',
    'worker.min.js',
  ],
  [
    'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js',
    'tesseract-core-lstm.wasm.js',
  ],
  [
    'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
    'tesseract-core-simd-lstm.wasm.js',
  ],
  [
    'node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
    'tesseract-core-relaxedsimd-lstm.wasm.js',
  ],
];

for (const [from, name] of files) {
  copyFileSync(join(root, from), join(dest, name));
}

console.log(`copied OCR runtime to ${dest}`);
