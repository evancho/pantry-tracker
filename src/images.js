export async function compressImage(file, { maxEdge = 1600, quality = 0.78 } = {}) {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error('無法壓縮照片'));
      }, 'image/jpeg', quality);
    });
    return blob;
  } finally {
    bitmap.close?.();
  }
}

function dataUrlToBlob(dataUrl) {
  const [header, body] = String(dataUrl).split(',');
  const mime = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
  const binary = atob(body || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function canvasToJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (blob, error) => {
      if (settled) return;
      settled = true;
      if (blob) resolve(blob);
      else reject(error || new Error('無法準備辨識用的照片'));
    };
    const timer = setTimeout(() => {
      try {
        finish(dataUrlToBlob(canvas.toDataURL('image/jpeg', quality)));
      } catch (error) {
        finish(null, error);
      }
    }, 1200);
    if (typeof canvas.toBlob !== 'function') return;
    canvas.toBlob((blob) => {
      clearTimeout(timer);
      if (blob) {
        finish(blob);
        return;
      }
      try {
        finish(dataUrlToBlob(canvas.toDataURL('image/jpeg', quality)));
      } catch (error) {
        finish(null, error);
      }
    }, 'image/jpeg', quality);
  });
}

export async function preprocessForOcr(blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const maxEdge = 1400;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);
    const data = image.data;
    const factor = 1.15;
    for (let i = 0; i < data.length; i += 4) {
      const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      const contrasted = Math.min(255, Math.max(0, (gray - 128) * factor + 128));
      data[i] = contrasted;
      data[i + 1] = contrasted;
      data[i + 2] = contrasted;
    }
    ctx.putImageData(image, 0, 0);
    return canvasToJpeg(canvas, 0.85);
  } finally {
    bitmap.close?.();
  }
}
