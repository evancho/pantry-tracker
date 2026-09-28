import { createWorker } from 'tesseract.js';
import { preprocessForOcr } from './images.js';
import { describeOcrError } from './ocr-message.js';
import { parseLabel } from './ocr-parse.js';

let workerPromise = null;
let progressHandler = () => {};
let busy = false;
let idleTimer = 0;
let forceBasicCore = false;

function assetUrl(relativePath) {
  const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin);
  return new URL(relativePath, baseUrl).href;
}

function useBasicCore() {
  if (forceBasicCore) return true;
  const ua = navigator.userAgent || '';
  if (/iP(hone|ad|od)/.test(ua)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label || '辨識逾時')), ms);
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

function resetWorker() {
  clearTimeout(idleTimer);
  const pending = workerPromise;
  workerPromise = null;
  if (!pending) return;
  pending.then((worker) => worker.terminate()).catch(() => {});
}

async function getWorker() {
  if (!workerPromise) {
    progressHandler({ status: 'loading language traineddata', progress: 0 });
    const corePath = useBasicCore()
      ? assetUrl('ocr-runtime/tesseract-core-lstm.wasm.js')
      : assetUrl('ocr-runtime');
    workerPromise = createWorker(['chi_tra', 'eng'], 1, {
      workerPath: assetUrl('ocr-runtime/worker.min.js'),
      corePath,
      langPath: assetUrl('tessdata'),
      workerBlobURL: false,
      gzip: true,
      cacheMethod: 'none',
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
  idleTimer = setTimeout(() => {
    if (busy || !workerPromise) return;
    resetWorker();
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

async function recognizePrepared(image) {
  const worker = await withTimeout(getWorker(), 45000, '辨識元件載入逾時');
  const result = await withTimeout(
    worker.recognize(image, {}, { text: true, blocks: true }),
    60000,
    '辨識逾時',
  );
  const lines = flattenLines(result.data);
  return parseLabel(lines.length ? { lines, text: result.data.text } : (result.data.text || ''));
}

export async function recognizeLabel(blob, onProgress) {
  busy = true;
  clearTimeout(idleTimer);
  progressHandler = onProgress || (() => {});
  try {
    let prepared = blob;
    try {
      prepared = await preprocessForOcr(blob);
    } catch (error) {
      console.error(error);
      prepared = blob;
    }
    try {
      const parsed = await recognizePrepared(prepared);
      if ((parsed.name || parsed.expiry) || prepared === blob) return parsed;
      return recognizePrepared(blob);
    } catch (error) {
      console.error(error);
      forceBasicCore = true;
      resetWorker();
      const message = String(error?.message || error || '');
      if (/逾時/.test(message) && !/元件/.test(message)) throw error;
      try {
        return await recognizePrepared(blob);
      } catch (retryError) {
        resetWorker();
        const wrapped = new Error(describeOcrError(retryError));
        wrapped.cause = retryError;
        throw wrapped;
      }
    }
  } finally {
    busy = false;
    scheduleRelease();
  }
}
