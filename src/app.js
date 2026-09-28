import { buildBackup, parseBackup } from './backup.js';
import { CHANGELOG } from './changelog.js';
import { deleteItem, loadAll, saveItem } from './db.js';
import {
  AREAS,
  SORTS,
  countdownLabel,
  daysUntilExpiry,
  defaultLeadDays,
  filterAndSort,
  formatDate,
  isValidArea,
  itemStatus,
  leadHint,
  normalizeLeadDays,
  summarize,
  summaryText,
  todayISO,
} from './domain.js';
import { APP_VERSION, APP_VERSION_LABEL } from './version.js';
import { compressImage } from './images.js';
import {
  checkReminders,
  notificationSupport,
  requestNotificationPermission,
  updateAppBadge,
} from './notify.js';
import { describeOcrError } from './ocr-message.js';
import { recognizeLabel } from './ocr.js';

const VIEW_KEY = 'pantry-tracker-view';
const AREA_CLASS = {
  冷凍: 'frozen',
  冷藏: 'chill',
  醬料櫃: 'sauce',
  上方調味粉櫃: 'spice',
  泡麵: 'noodle',
  罐頭區: 'can',
};

const state = {
  items: [],
  ready: false,
  error: '',
  query: '',
  sort: 'expiry-asc',
  density: 'standard',
  view: 'pantry',
};

let viewBeforeChangelog = 'pantry';

const urls = new Map();
let draft = null;
let previewUrl = '';
let ocrAfterPick = false;
let toastTimer = 0;

const ui = {};

function assetUrl(relativePath) {
  const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin);
  return new URL(relativePath, baseUrl).href;
}

const iconUrl = assetUrl('icons/icon-192.png');

function el(tag, attrs = {}, children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  if (children != null) {
    const list = Array.isArray(children) ? children : [children];
    for (const child of list) {
      if (child == null || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
  }
  return node;
}

function toast(message) {
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    ui.toast.hidden = true;
  }, 3400);
}

function storageErrorMessage(error) {
  if (error?.name === 'QuotaExceededError') return '儲存空間不足，請刪除一些照片或先匯出備份。';
  return '無法儲存，請確認瀏覽器允許網站儲存資料。';
}

function syncModal() {
  const open = ui.editor.open || ui.confirmDialog.open || ui.moreDialog.open;
  document.body.classList.toggle('modal-open', open);
}

function loadView() {
  try {
    const saved = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}');
    if (SORTS.some((option) => option.id === saved.sort)) state.sort = saved.sort;
    if (saved.density === 'compact' || saved.density === 'standard') state.density = saved.density;
  } catch {
    // Ignore a broken preference and use the defaults.
  }
}

function saveView() {
  localStorage.setItem(VIEW_KEY, JSON.stringify({ sort: state.sort, density: state.density }));
}

function urlFor(item) {
  if (!item.photoBlob) {
    const cached = urls.get(item.id);
    if (cached) {
      URL.revokeObjectURL(cached.url);
      urls.delete(item.id);
    }
    return '';
  }
  const key = `${item.updatedAt}:${item.photoBlob.size}`;
  const cached = urls.get(item.id);
  if (cached && cached.key === key) return cached.url;
  if (cached) URL.revokeObjectURL(cached.url);
  const url = URL.createObjectURL(item.photoBlob);
  urls.set(item.id, { key, url });
  return url;
}

function syncUrls(items) {
  const ids = new Set(items.map((item) => item.id));
  for (const [id, cached] of urls) {
    if (!ids.has(id)) {
      URL.revokeObjectURL(cached.url);
      urls.delete(id);
    }
  }
}

function statusClass(status) {
  if (status === '即將到期') return 'soon';
  if (status === '已過期') return 'expired';
  return 'ok';
}

function renderCard(item, today) {
  const status = itemStatus(item, today);
  const thumb = el('div', { class: 'thumb-wrap' });
  const photo = urlFor(item);
  if (photo) {
    thumb.append(el('img', { class: 'thumb', src: photo, alt: `${item.name}的照片` }));
  } else {
    thumb.append(el('div', { class: 'thumb thumb-empty', 'aria-hidden': 'true' }));
  }

  const edit = el('button', {
    type: 'button',
    'data-action': 'edit',
    'aria-label': `編輯${item.name}`,
  }, '編輯');
  const remove = el('button', {
    type: 'button',
    class: 'danger',
    'data-action': 'delete',
    'aria-label': `刪除${item.name}`,
  }, '刪除');

  const title = el('h2', {}, item.name);
  title.title = item.name;

  return el('article', {
    class: `card status-${statusClass(status)} area-${AREA_CLASS[item.area] || 'chill'}`,
    role: 'listitem',
    'data-id': item.id,
  }, [
    thumb,
    el('div', { class: 'card-body' }, [
      el('div', { class: 'card-top' }, [
        title,
        el('span', { class: `badge badge-${statusClass(status)}` }, status),
      ]),
      el('p', { class: 'meta' }, `${item.area} · ${formatDate(item.expiry)} · ${countdownLabel(item, today)}`),
      el('p', { class: 'remind' }, item.expiry ? `到期前 ${normalizeLeadDays(item.leadDays)} 天提醒` : '尚未設定提醒'),
      el('div', { class: 'card-actions' }, [edit, remove]),
    ]),
  ]);
}

function renderCompactRow(item) {
  const status = itemStatus(item, todayISO());
  const open = el('button', {
    type: 'button',
    class: 'compact-open',
    'data-action': 'edit',
    'aria-label': `編輯${item.name}`,
  }, [
    el('span', { class: 'compact-name' }, item.name),
    el('span', { class: 'compact-area' }, item.area),
    el('span', { class: 'compact-date' }, formatDate(item.expiry)),
    status === '已過期' ? el('span', { class: 'compact-expired' }, '已過期') : null,
  ]);
  const remove = el('button', {
    type: 'button',
    class: 'compact-delete',
    'data-action': 'delete',
    'aria-label': `刪除${item.name}`,
  }, '刪除');
  return el('article', {
    class: `compact status-${statusClass(status)}`,
    role: 'listitem',
    'data-id': item.id,
  }, [open, remove]);
}

function renderControls() {
  if (ui.nameFilter.value !== state.query) ui.nameFilter.value = state.query;
  ui.nameFilterClear.hidden = state.query.trim() === '';
  ui.sort.value = state.sort;
  const compact = state.density === 'compact';
  ui.densityStandard.setAttribute('aria-pressed', compact ? 'false' : 'true');
  ui.densityCompact.setAttribute('aria-pressed', compact ? 'true' : 'false');
  ui.list.classList.toggle('list-compact', compact);
}

function applyVersion() {
  const label = `食材櫃 · ${APP_VERSION_LABEL}`;
  ui.versionBtn.textContent = label;
  ui.versionBtn.setAttribute('aria-label', `查看更新紀錄，目前版本 ${APP_VERSION_LABEL}`);
  ui.versionNote.textContent = `${label} · 資料只存在這台裝置`;
}

function renderChangelog() {
  ui.changelogCurrent.textContent = `目前版本 ${APP_VERSION_LABEL}`;
  ui.changelogList.replaceChildren(...CHANGELOG.map((entry) => {
    const current = entry.version === APP_VERSION;
    return el('article', { class: current ? 'release release-current' : 'release' }, [
      el('header', { class: 'release-head' }, [
        el('h3', {}, `v${entry.version}`),
        current ? el('span', { class: 'badge badge-ok' }, '目前版本') : null,
        el('time', { datetime: entry.date }, formatDate(entry.date)),
      ]),
      el('p', { class: 'release-summary' }, entry.summary),
      el('ul', {}, entry.changes.map((line) => el('li', {}, line))),
    ]);
  }));
}

function showEmpty(title, copy) {
  ui.empty.hidden = false;
  ui.emptyTitle.textContent = title;
  ui.emptyCopy.textContent = copy;
}

function render() {
  const today = todayISO();
  const counts = summarize(state.items, today);
  ui.summary.textContent = state.error ? '無法讀取資料' : summaryText(counts);
  renderControls();
  ui.notifyBtn.classList.toggle('has-due', counts['即將到期'] + counts['已過期'] > 0);

  const visible = filterAndSort(state.items, {
    query: state.query,
    sort: state.sort,
    today,
  });

  ui.list.replaceChildren(...visible.map((item) => (
    state.density === 'compact' ? renderCompactRow(item) : renderCard(item, today)
  )));
  ui.list.hidden = visible.length === 0;

  if (!state.ready) {
    showEmpty('正在讀取', '正在打開這台裝置上的食材紀錄。');
    ui.noMatch.hidden = true;
  } else if (state.error) {
    showEmpty('讀不到資料', '請確認瀏覽器允許網站儲存資料，然後重新開啟食材櫃。');
    ui.noMatch.hidden = true;
  } else if (state.items.length === 0) {
    showEmpty('還沒有食材', '點右下角「新增」，把家裡的食材記下來。可以拍照，也可以用「拍照辨識」帶入名稱和期限。');
    ui.noMatch.hidden = true;
  } else if (visible.length === 0) {
    ui.empty.hidden = true;
    ui.noMatch.hidden = false;
    const query = state.query.trim();
    ui.noMatchCopy.textContent = query
      ? `沒有名稱包含「${query}」的食材。可以改搜尋字，或清除後看全部。`
      : '沒有符合的食材。';
  } else {
    ui.empty.hidden = true;
    ui.noMatch.hidden = true;
  }

  void updateAppBadge(counts['即將到期'] + counts['已過期']);
}

async function reload() {
  state.items = await loadAll();
  state.ready = true;
  state.error = '';
  syncUrls(state.items);
  render();
  await checkReminders(state.items, todayISO(), { icon: iconUrl });
}

function setView(view) {
  state.view = view;
  ui.pantry.hidden = view !== 'pantry';
  ui.recipes.hidden = view !== 'recipes';
  ui.changelog.hidden = view !== 'changelog';
  ui.addBtn.hidden = view !== 'pantry';
  if (view === 'pantry') ui.tabPantry.setAttribute('aria-current', 'page');
  else ui.tabPantry.removeAttribute('aria-current');
  if (view === 'recipes') ui.tabRecipes.setAttribute('aria-current', 'page');
  else ui.tabRecipes.removeAttribute('aria-current');
  window.scrollTo(0, 0);
}

function openChangelog() {
  if (state.view !== 'changelog') viewBeforeChangelog = state.view;
  if (ui.moreDialog.open) {
    ui.moreDialog.close();
    syncModal();
  }
  setView('changelog');
}

function updateLeadHint() {
  ui.leadHint.textContent = leadHint(ui.expiry.value, ui.lead.value, todayISO());
}

function applyExpiryDefault() {
  if (!ui.expiry.value) {
    updateLeadHint();
    return;
  }
  ui.lead.value = String(defaultLeadDays(daysUntilExpiry(ui.expiry.value, todayISO())));
  updateLeadHint();
}

function currentPhotoBlob() {
  if (!draft || draft.photoRemoved) return null;
  return draft.photoBlob || draft.existingBlob || null;
}

function showPreview() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = '';
  const blob = currentPhotoBlob();
  ui.clearPhoto.hidden = !blob;
  if (!blob) {
    ui.photoPreview.replaceChildren(el('p', { class: 'photo-empty' }, '尚未加入照片'));
    return;
  }
  previewUrl = URL.createObjectURL(blob);
  ui.photoPreview.replaceChildren(el('img', { src: previewUrl, alt: '食材照片預覽' }));
}

function openEditor(item) {
  draft = {
    id: item?.id || null,
    createdAt: item?.createdAt || null,
    photoId: item?.photoId || null,
    photoBlob: null,
    existingBlob: item?.photoBlob || null,
    photoRemoved: false,
  };
  ui.editorTitle.textContent = item ? '編輯食材' : '新增食材';
  ui.name.value = item?.name || '';
  ui.name.setCustomValidity('');
  ui.expiry.value = item?.expiry || '';
  ui.area.value = isValidArea(item?.area) ? item.area : '冷藏';
  ui.lead.value = String(item ? normalizeLeadDays(item.leadDays) : 1);
  ui.ocrStatus.textContent = '';
  ui.editorDelete.hidden = !item;
  updateLeadHint();
  showPreview();
  ui.editor.showModal();
  syncModal();
  const active = document.activeElement;
  if (active instanceof HTMLElement && ui.editor.contains(active) && active !== ui.editor) {
    active.blur();
  }
  ui.editor.focus();
}

function closeEditor() {
  if (ui.editor.open) ui.editor.close();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = '';
  draft = null;
  ocrAfterPick = false;
  syncModal();
}

async function onPhotoFile(file) {
  const shouldOcr = ocrAfterPick;
  ocrAfterPick = false;
  if (!file) return;
  try {
    draft.photoBlob = await compressImage(file);
    draft.photoRemoved = false;
    showPreview();
    if (shouldOcr) await runOcr();
  } catch (error) {
    console.error(error);
    toast('無法讀取這張照片，請改用 JPG 或再拍一次。');
  }
}

async function runOcr() {
  const blob = currentPhotoBlob();
  if (!blob) {
    ocrAfterPick = true;
    ui.cameraInput.click();
    return;
  }
  ui.ocrBtn.disabled = true;
  ui.ocrBtn.setAttribute('aria-busy', 'true');
  ui.ocrStatus.textContent = '正在準備辨識（第一次會載入語料）…';
  try {
    const parsed = await recognizeLabel(blob, (message) => {
      if (message?.status === 'recognizing text') {
        ui.ocrStatus.textContent = `正在辨識標籤… ${Math.round((message.progress || 0) * 100)}%`;
      } else if (message?.status) {
        ui.ocrStatus.textContent = '正在準備辨識（第一次會載入語料）…';
      }
    });
    if (!parsed.name && !parsed.expiry) {
      ui.ocrStatus.textContent = '沒有辨識出名稱或期限。照片已保留，請手動輸入。';
      return;
    }
    if (parsed.name) ui.name.value = parsed.name;
    if (parsed.expiry) {
      ui.expiry.value = parsed.expiry;
      applyExpiryDefault();
    }
    ui.ocrStatus.textContent = '已帶入辨識結果，請再確認一次。';
  } catch (error) {
    console.error(error);
    ui.ocrStatus.textContent = describeOcrError(error);
  } finally {
    ui.ocrBtn.disabled = false;
    ui.ocrBtn.removeAttribute('aria-busy');
  }
}

async function saveEditor(event) {
  event.preventDefault();
  const name = ui.name.value.trim();
  if (!name) {
    ui.name.setCustomValidity('請輸入名稱');
    ui.name.reportValidity();
    return;
  }
  ui.name.setCustomValidity('');
  const expiry = ui.expiry.value || null;
  if (expiry && daysUntilExpiry(expiry, todayISO()) == null && expiry) {
    toast('到期日格式不正確。');
    return;
  }
  const now = Date.now();
  const record = {
    id: draft.id || crypto.randomUUID(),
    name,
    expiry,
    area: ui.area.value,
    leadDays: normalizeLeadDays(ui.lead.value),
    photoId: draft.photoRemoved ? null : draft.photoId,
    createdAt: draft.createdAt || now,
    updatedAt: now,
  };
  let photoArg;
  if (draft.photoBlob && !draft.photoRemoved) photoArg = draft.photoBlob;
  else if (draft.photoRemoved) photoArg = null;

  ui.saveBtn.disabled = true;
  try {
    await saveItem(record, photoArg);
    closeEditor();
    await reload();
    toast('已儲存');
  } catch (error) {
    console.error(error);
    toast(storageErrorMessage(error));
  } finally {
    ui.saveBtn.disabled = false;
  }
}

function ask(message, okLabel, title) {
  return new Promise((resolve) => {
    ui.confirmTitle.textContent = title || '請確認';
    ui.confirmText.textContent = message;
    ui.confirmOk.textContent = okLabel || '確定';
    ui.confirmOk.classList.toggle('danger', okLabel === '刪除');
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (ui.confirmDialog.open) ui.confirmDialog.close();
      syncModal();
      resolve(value);
    };
    ui.confirmOk.onclick = () => finish(true);
    ui.confirmCancel.onclick = () => finish(false);
    ui.confirmDialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(false);
    }, { once: true });
    ui.confirmDialog.showModal();
    syncModal();
    ui.confirmCancel.focus();
  });
}

async function removeItem(item) {
  const ok = await ask(`確定要刪除「${item.name}」嗎？刪除後無法復原。`, '刪除', '刪除食材');
  if (!ok) return;
  try {
    await deleteItem(item.id);
    await reload();
    toast('已刪除');
  } catch (error) {
    console.error(error);
    toast('無法刪除，請再試一次。');
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error('bad photo');
  return response.blob();
}

async function exportBackup() {
  try {
    const items = await loadAll();
    const payload = buildBackup(await Promise.all(items.map(async (item) => ({
      ...item,
      photo: item.photoBlob ? await blobToDataUrl(item.photoBlob) : null,
    }))));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: `pantry-backup-${todayISO()}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('已下載備份檔。');
  } catch (error) {
    console.error(error);
    toast('無法匯出備份。');
  }
}

async function importFile(file) {
  if (!file) return;
  if (file.size > 40 * 1024 * 1024) {
    toast('備份檔太大了。');
    return;
  }
  let parsed;
  try {
    parsed = parseBackup(await file.text());
  } catch (error) {
    toast(error.message || '無法讀取這個備份檔。');
    return;
  }
  if (ui.moreDialog.open) ui.moreDialog.close();
  const skipped = parsed.skipped ? `，略過 ${parsed.skipped} 項無效資料` : '';
  const ok = await ask(
    `匯入 ${parsed.items.length} 項食材${skipped}。相同項目會被覆蓋，其餘保留。`,
    '匯入',
    '匯入備份',
  );
  if (!ok) return;
  let saved = 0;
  try {
    for (const row of parsed.items) {
      const blob = row.photo ? await dataUrlToBlob(row.photo) : null;
      await saveItem({
        id: row.id || crypto.randomUUID(),
        name: row.name,
        expiry: row.expiry,
        area: row.area,
        leadDays: row.leadDays,
        photoId: null,
        createdAt: row.createdAt || Date.now(),
        updatedAt: Date.now(),
      }, blob);
      saved += 1;
    }
    await reload();
    toast(parsed.skipped ? `已匯入 ${saved} 項，略過 ${parsed.skipped} 項。` : `已匯入 ${saved} 項。`);
    return;
  } catch (error) {
    console.error(error);
    await reload();
    toast(saved ? `已匯入 ${saved} 項後中斷。${storageErrorMessage(error)}` : storageErrorMessage(error));
  }
}

function refreshNotifyCopy() {
  const support = notificationSupport();
  if (support === 'unsupported') {
    ui.notifyState.textContent = '這個瀏覽器沒有通知功能。清單上的狀態仍會顯示。';
    ui.enableNotify.textContent = '無法使用系統通知';
    ui.enableNotify.disabled = true;
    return;
  }
  ui.enableNotify.disabled = false;
  if (support === 'granted') {
    ui.notifyState.textContent = '提醒已開啟。之後打開食材櫃，會通知進入提醒範圍或已過期的食材。';
    ui.enableNotify.textContent = '提醒已開啟';
  } else if (support === 'denied') {
    ui.notifyState.textContent = '通知被封鎖了。可以到瀏覽器設定裡允許；清單上的狀態不受影響。';
    ui.enableNotify.textContent = '通知已被封鎖';
  } else {
    ui.notifyState.textContent = '尚未詢問權限。拒絕也沒關係，卡片上的「即將到期」和「已過期」一樣看得到。';
    ui.enableNotify.textContent = '開啟到期提醒';
  }
}

async function enableNotifications() {
  const support = notificationSupport();
  if (support === 'unsupported') {
    toast('此瀏覽器不支援通知，清單上的狀態仍會顯示。');
    return;
  }
  if (support === 'denied') {
    toast('通知被封鎖了。清單上的狀態仍會顯示。');
    return;
  }
  if (support === 'granted') {
    toast('提醒已開啟。打開食材櫃時會通知需要留意的食材。');
    await checkReminders(state.items, todayISO(), { icon: iconUrl });
    refreshNotifyCopy();
    return;
  }
  const result = await requestNotificationPermission();
  refreshNotifyCopy();
  if (result === 'granted') {
    toast('已開啟提醒。');
    await checkReminders(state.items, todayISO(), { icon: iconUrl });
  } else {
    toast('沒有通知權限。清單上的狀態標示仍會顯示。');
  }
}

function bind() {
  for (const option of SORTS) {
    ui.sort.append(el('option', { value: option.id }, option.label));
  }
  ui.sort.value = state.sort;
  for (const area of AREAS) ui.area.append(el('option', { value: area }, area));

  ui.nameFilter.addEventListener('input', () => {
    state.query = ui.nameFilter.value;
    render();
  });
  ui.nameFilter.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    ui.nameFilter.blur();
  });
  ui.nameFilterClear.addEventListener('click', () => {
    state.query = '';
    ui.nameFilter.value = '';
    render();
    ui.nameFilter.focus();
  });
  ui.sort.addEventListener('change', () => {
    state.sort = ui.sort.value;
    saveView();
    render();
  });
  const setDensity = (density) => {
    state.density = density;
    saveView();
    render();
  };
  ui.densityStandard.addEventListener('click', () => setDensity('standard'));
  ui.densityCompact.addEventListener('click', () => setDensity('compact'));

  ui.tabPantry.addEventListener('click', () => setView('pantry'));
  ui.tabRecipes.addEventListener('click', () => setView('recipes'));
  ui.versionBtn.addEventListener('click', openChangelog);
  ui.openChangelog.addEventListener('click', openChangelog);
  ui.changelogBack.addEventListener('click', () => setView(viewBeforeChangelog));
  ui.addBtn.addEventListener('click', () => openEditor(null));
  ui.editorClose.addEventListener('click', closeEditor);
  ui.editorCancel.addEventListener('click', closeEditor);
  ui.editorDelete.addEventListener('click', async () => {
    const item = state.items.find((row) => row.id === draft?.id);
    if (!item) return;
    const id = item.id;
    await removeItem(item);
    if (!state.items.some((row) => row.id === id)) closeEditor();
  });
  ui.editor.addEventListener('close', syncModal);
  ui.editorForm.addEventListener('submit', saveEditor);
  ui.expiry.addEventListener('change', applyExpiryDefault);
  ui.expiry.addEventListener('input', applyExpiryDefault);
  ui.lead.addEventListener('input', updateLeadHint);
  ui.name.addEventListener('input', () => ui.name.setCustomValidity(''));

  ui.cameraBtn.addEventListener('click', () => ui.cameraInput.click());
  ui.galleryBtn.addEventListener('click', () => {
    ocrAfterPick = false;
    ui.galleryInput.click();
  });
  ui.ocrBtn.addEventListener('click', () => {
    runOcr();
  });
  ui.clearPhoto.addEventListener('click', () => {
    draft.photoBlob = null;
    draft.photoRemoved = true;
    showPreview();
  });
  ui.cameraInput.addEventListener('change', () => {
    const file = ui.cameraInput.files?.[0];
    ui.cameraInput.value = '';
    onPhotoFile(file);
  });
  ui.galleryInput.addEventListener('change', () => {
    const file = ui.galleryInput.files?.[0];
    ui.galleryInput.value = '';
    onPhotoFile(file);
  });
  ui.cameraInput.addEventListener('cancel', () => {
    ocrAfterPick = false;
  });

  ui.list.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const id = button.closest('[data-id]')?.dataset.id;
    const item = state.items.find((row) => row.id === id);
    if (!item) return;
    if (button.dataset.action === 'edit') openEditor(item);
    if (button.dataset.action === 'delete') removeItem(item);
  });

  ui.notifyBtn.addEventListener('click', enableNotifications);
  ui.moreBtn.addEventListener('click', () => {
    refreshNotifyCopy();
    ui.moreDialog.showModal();
    syncModal();
  });
  ui.moreClose.addEventListener('click', () => {
    ui.moreDialog.close();
    syncModal();
  });
  ui.moreDialog.addEventListener('close', syncModal);
  ui.enableNotify.addEventListener('click', enableNotifications);
  ui.exportBtn.addEventListener('click', exportBackup);
  ui.importBtn.addEventListener('click', () => ui.importInput.click());
  ui.importInput.addEventListener('change', () => {
    const file = ui.importInput.files?.[0];
    ui.importInput.value = '';
    importFile(file);
  });
}

function cacheElements() {
  const ids = {
    summary: 'summary',
    notifyBtn: 'notify-btn',
    moreBtn: 'more-btn',
    tabPantry: 'tab-pantry',
    tabRecipes: 'tab-recipes',
    pantry: 'view-pantry',
    recipes: 'view-recipes',
    nameFilter: 'name-filter',
    nameFilterClear: 'name-filter-clear',
    sort: 'sort',
    densityStandard: 'density-standard',
    densityCompact: 'density-compact',
    list: 'list',
    empty: 'empty',
    emptyTitle: 'empty-title',
    emptyCopy: 'empty-copy',
    noMatch: 'no-match',
    noMatchCopy: 'no-match-copy',
    changelog: 'view-changelog',
    changelogBack: 'changelog-back',
    changelogCurrent: 'changelog-current',
    changelogList: 'changelog-list',
    versionBtn: 'version-btn',
    versionNote: 'version-note',
    openChangelog: 'open-changelog',
    addBtn: 'add-btn',
    editor: 'editor',
    editorForm: 'editor-form',
    editorTitle: 'editor-title',
    editorClose: 'editor-close',
    editorCancel: 'editor-cancel',
    editorDelete: 'editor-delete',
    saveBtn: 'editor-save',
    photoPreview: 'photo-preview',
    cameraBtn: 'camera-btn',
    galleryBtn: 'gallery-btn',
    ocrBtn: 'ocr-btn',
    clearPhoto: 'clear-photo-btn',
    ocrStatus: 'ocr-status',
    cameraInput: 'camera-input',
    galleryInput: 'gallery-input',
    name: 'name',
    expiry: 'expiry',
    area: 'area',
    lead: 'lead',
    leadHint: 'lead-hint',
    confirmDialog: 'confirm-dialog',
    confirmTitle: 'confirm-title',
    confirmText: 'confirm-text',
    confirmOk: 'confirm-ok',
    confirmCancel: 'confirm-cancel',
    moreDialog: 'more-dialog',
    moreClose: 'more-close',
    enableNotify: 'enable-notify',
    notifyState: 'notify-state',
    exportBtn: 'export-btn',
    importBtn: 'import-btn',
    importInput: 'import-input',
    toast: 'toast',
  };
  for (const [key, id] of Object.entries(ids)) ui[key] = document.getElementById(id);
}

export function startApp() {
  cacheElements();
  loadView();
  bind();
  applyVersion();
  renderChangelog();
  setView('pantry');
  render();
  reload().catch((error) => {
    console.error(error);
    state.ready = true;
    state.error = 'failed';
    render();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !state.ready) return;
    render();
    checkReminders(state.items, todayISO(), { icon: iconUrl }).catch(() => {});
  });
  setInterval(() => {
    if (!state.ready || document.visibilityState === 'hidden') return;
    checkReminders(state.items, todayISO(), { icon: iconUrl }).catch(() => {});
  }, 15 * 60 * 1000);
}
