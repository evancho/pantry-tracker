import { createWorker } from 'tesseract.js';
import { preprocessForOcr } from './images.js';
import { parseLabel } from './ocr-parse.js';

let workerPromise = null;
let progressHandler = () => {};
let busy = false;
let idleTimer = 0;

function assetUrl(relativePath) {
  const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin);
  return new URL(relativePath, baseUrl).href;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('辨識逾時')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function getWorker() {
  if (!workerPromise) {
    progressHandler({ status: 'loading language traineddata', progress: 0 });
    workerPromise = createWorker(['chi_tra', 'eng'], 1, {
      workerPath: assetUrl('ocr-runtime/worker.min.js'),
      corePath: assetUrl('ocr-runtime'),
      langPath: assetUrl('tessdata'),
      workerBlobURL: false,
      gzip: true,
      cacheMethod: 'write',
      logger: (message) => progressHandler(message),
      errorHandler: (error) => console.error(error),
    }).then(async (worker) => {
      await worker.setParameters({
        tessedit_pageseg_mode: '3',
        user_defined_dpi: '300',
      });
      return worker;
    }).catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

function scheduleRelease() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    if (busy || !workerPromise) return;
    const pending = workerPromise;
    workerPromise = null;
    try {
      const worker = await pending;
      await worker.terminate();
    } catch {
      // The worker is already gone.
    }
  }, 90000);
}

function flattenLines(data) {
  const lines = [];
  for (const block of data.blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        lines.push({
          text: line.text || '',
          confidence: line.confidence,
          bbox: line.bbox,
        });
      }
    }
  }
  return lines;
}

export async function recognizeLabel(blob, onProgress) {
  busy = true;
  clearTimeout(idleTimer);
  progressHandler = onProgress || (() => {});
  try {
    const worker = await getWorker();
    const canvas = await preprocessForOcr(blob);
    const result = await withTimeout(
      worker.recognize(canvas, {}, { text: true, blocks: true }),
      90000,
    );
    const lines = flattenLines(result.data);
    return parseLabel(lines.length ? { lines, text: result.data.text } : (result.data.text || ''));
  } finally {
    busy = false;
    scheduleRelease();
  }
}
