function recoverLiveShell() {
  if (window.__dancrShellReloading) return;
  const target = new URL(window.location.href);
  const editing = window.__dancrShellFormEdited
    || document.activeElement?.matches?.('input, textarea, select, [contenteditable="true"]');
  if (!editing && navigator.onLine !== false && !target.searchParams.has('_dancr_reload')) {
    target.searchParams.set('_dancr_reload', '1');
    window.__dancrShellReloading = true;
    window.location.replace(target.href);
    return;
  }
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', recoverLiveShell, { once: true });
    return;
  }
  if (document.getElementById('dancrShellRecovery')) return;
  const notice = document.createElement('aside');
  notice.id = 'dancrShellRecovery';
  notice.setAttribute('role', 'alert');
  notice.style.cssText = 'position:fixed;inset:auto 12px 12px;z-index:2147483647;padding:16px;background:#17131f;color:#fff;border:1px solid #9982b5;border-radius:8px;font:14px/1.5 system-ui';
  const message = document.createElement('span');
  message.textContent = 'The page needs a refresh. Reload when you are ready. ';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Reload site';
  button.style.cssText = 'min-height:44px;padding:8px 16px;background:#6427db;color:#fff;border:1px solid #c4b5fd;border-radius:8px;font:inherit';
  button.addEventListener('click', () => window.location.reload());
  notice.append(message, button);
  document.body.append(notice);
}

function installLiveShellRecovery(version, recover) {
  let checking = false;
  let lastCheck = -Infinity;
  const markEdited = event => {
    if (event.target?.closest?.('form')) window.__dancrShellFormEdited = true;
  };
  document.addEventListener('input', markEdited, true);
  document.addEventListener('change', markEdited, true);

  window.addEventListener('error', event => {
    const element = event.target;
    const reference = element?.tagName === 'SCRIPT' ? element.src
      : element?.tagName === 'LINK' && element.rel === 'stylesheet' ? element.href : '';
    if (!reference) return;
    const asset = new URL(reference, window.location.href);
    if (asset.origin !== window.location.origin) return;
    if (element.tagName === 'SCRIPT' && ![
      '/live-shell.js', '/mydancr-api-transport.js', '/dancer-content-visibility.js',
      '/profile-photo-crop.js', '/profile-video-crop.js',
    ].includes(asset.pathname)) return;
    window.__dancrShellAssetFailed = true;
    recover();
  }, true);

  async function checkVersion() {
    if (checking || document.visibilityState === 'hidden' || navigator.onLine === false
      || Date.now() - lastCheck < 30000) return;
    checking = true;
    lastCheck = Date.now();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch('/', {
        method: 'HEAD', cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
      });
      const current = response.headers.get('x-dancr-shell-release');
      if (response.ok && current && current !== version) recover();
    } catch {
      // A temporary network failure must not discard an otherwise usable page.
    } finally {
      window.clearTimeout(timeout);
      checking = false;
    }
  }
  window.addEventListener('pageshow', event => { if (event.persisted) void checkVersion(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkVersion();
  });
  window.addEventListener('online', () => {
    if (window.__dancrShellAssetFailed) recover();
    else void checkVersion();
  });
  window.addEventListener('load', () => {
    if (window.__dancrShellAssetFailed || window.__dancrShellReloading) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('_dancr_reload')) return;
    url.searchParams.delete('_dancr_reload');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, { once: true });
}

export function createLiveShellRecoveryScript(version) {
  return `(${installLiveShellRecovery.toString()})(${JSON.stringify(version)},${recoverLiveShell.toString()});`;
}

export function createLiveShellVersionMismatchScript() {
  return `window.__dancrShellAssetFailed=true;(${recoverLiveShell.toString()})();`;
}
