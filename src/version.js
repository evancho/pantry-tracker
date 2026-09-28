import { formatVersionLabel } from '../scripts/version-label.mjs';

export const APP_SLUG = 'pantry-tracker';

// Injected by Vite from package.json and the Asia/Taipei build date.
export const APP_VERSION = __APP_VERSION__;
export const APP_DATECODE = __APP_DATECODE__;
export const APP_VERSION_LABEL = formatVersionLabel(APP_VERSION, APP_DATECODE);
