export function describeOcrError(error) {
  const message = String(error?.message || error || '');
  if (/逾時|timeout/i.test(message)) {
    return '辨識逾時。請讓包裝上的字更清楚、再試一次，或手動輸入名稱與期限。';
  }
  if (/network|fetch|Failed to load|importScripts|Worker|tesseract core|語料|元件/i.test(message)) {
    return '辨識元件沒有載入成功。請連上網路後再按一次。辨識仍在這台裝置上進行，不會上傳照片。';
  }
  return '無法辨識這張照片，請手動輸入名稱與期限。';
}
