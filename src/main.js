import './styles.css';
import { startApp } from './app.js';
import { registerSW } from 'virtual:pwa-register';

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    const banner = document.getElementById('update-banner');
    banner.hidden = false;
    document.getElementById('reload-btn').addEventListener('click', () => {
      updateSW(true);
    }, { once: true });
  },
  onOfflineReady() {},
});

startApp();
