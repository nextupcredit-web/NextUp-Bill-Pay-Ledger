/* ============================================================
   NextUp — PWA install banner
   Device-aware: captures beforeinstallprompt on Android/Chrome/
   desktop Chromium browsers for a real one-tap install button;
   shows manual "Add to Home Screen" instructions on iOS Safari,
   which never fires beforeinstallprompt. No-ops if already
   running standalone (installed) or recently dismissed.
   ============================================================ */
(function () {
  const DISMISS_KEY = 'nextup_pwa_install_dismissed_at';
  const DISMISS_DAYS = 14;
  let deferredPrompt = null;
  let shown = false;

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  }
  function isDismissedRecently() {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    return (Date.now() - Number(raw)) / 86400000 < DISMISS_DAYS;
  }
  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }
  function dismiss(bar) {
    bar.classList.remove('show');
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setTimeout(() => bar.remove(), 300);
  }

  function buildBanner(html, onInstall) {
    if (shown || isStandalone() || isDismissedRecently()) return;
    shown = true;
    const bar = document.createElement('div');
    bar.className = 'pwa-install-banner';
    bar.innerHTML = `
      <div class="pwa-install-inner">
        <span class="pwa-install-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2.5"/><path d="M11 18h2"/></svg>
        </span>
        <div class="pwa-install-text">${html}</div>
        <div class="pwa-install-actions">
          ${onInstall ? '<button type="button" class="btn btn-primary btn-sm" id="pwaInstallBtn">Install</button>' : ''}
          <button type="button" class="pwa-install-dismiss" id="pwaInstallDismiss" aria-label="Dismiss">&times;</button>
        </div>
      </div>`;
    document.body.appendChild(bar);
    requestAnimationFrame(() => bar.classList.add('show'));
    document.getElementById('pwaInstallDismiss').addEventListener('click', () => dismiss(bar));
    if (onInstall) {
      document.getElementById('pwaInstallBtn').addEventListener('click', async () => {
        await onInstall();
        dismiss(bar);
      });
    }
  }

  function init() {
    if (isStandalone() || isDismissedRecently()) return;

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      buildBanner('Install NextUp for one-tap access from your home screen or desktop.', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
      });
    });

    window.addEventListener('appinstalled', () => {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    });

    if (isIOS()) {
      // beforeinstallprompt never fires on iOS Safari — offer manual steps instead.
      setTimeout(() => {
        buildBanner('Install NextUp: tap <strong>Share</strong> then <strong>“Add to Home Screen.”</strong>', null);
      }, 1800);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
