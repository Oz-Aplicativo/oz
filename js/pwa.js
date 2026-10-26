(function registerOzPwa() {
  const native = window.Capacitor?.isNativePlatform?.()
    || location.protocol === 'capacitor:'
    || location.protocol === 'ionic:';
  if (native) return;
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
})();
