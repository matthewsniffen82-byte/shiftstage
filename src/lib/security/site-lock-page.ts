function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export function siteLockPage(returnTo: string, nonce: string, error: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="dark"><meta name="theme-color" content="#0b0b0b"><meta name="robots" content="noindex,nofollow"><title>MyDancr — Coming soon</title><style nonce="${escapeHtml(nonce)}">
*{box-sizing:border-box}
html{color-scheme:only dark;background:#0b0b0b}
body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:#0b0b0b;color:#f5f3f7;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{width:100%;max-width:440px;padding:40px 28px 24px;background:#141319;border:1px solid #2d2936;border-radius:20px;text-align:center}
.brand{margin:0 0 40px;font-size:34px;font-weight:800;letter-spacing:-1.8px}
.brand span{color:#b69aef}
h1{margin:0 0 16px;font-size:clamp(32px,8vw,44px);line-height:1.1;letter-spacing:-1.2px}
.intro{max-width:310px;margin:0 auto;color:#b4afbe;font-size:15px;line-height:1.65}
.access{margin-top:36px}
.access summary{display:flex;align-items:center;justify-content:center;gap:7px;width:fit-content;max-width:100%;min-height:44px;margin:0 auto;padding:10px 12px;border-radius:8px;color:#aaa4b4;font-size:12px;cursor:pointer;list-style:none}
.access summary::-webkit-details-marker{display:none}
.access summary:hover{color:#f5f3f7}
.lock{flex:none;width:15px;height:15px}
form{margin-top:12px;padding-top:20px;border-top:1px solid #2d2936;text-align:left}
label{display:block;margin-bottom:8px;font-size:13px;font-weight:600}
input,button{width:100%;min-width:0;min-height:48px;border-radius:10px;font:inherit}
input{padding:12px 14px;color:#fff;background:#191820;border:1px solid #35313f}
input:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid #b69aef;outline-offset:3px}
button{margin-top:16px;padding:12px 16px;border:1px solid #6d28ff;background:#6d28ff;color:#fff;font-weight:700;cursor:pointer}
button:hover{background:#792fff}
.error{margin:12px 0 0;font-size:13px;line-height:1.5;color:#fb7185}
@media(max-width:360px){body{padding:16px}main{padding:32px 20px 20px}}
</style></head><body><main>
<p class="brand">mydanc<span>r</span></p>
<h1>Coming soon</h1>
<p class="intro">Your next night out starts here.<br>We’re getting MyDancr ready for you.<br>Check back soon.</p>
<details class="access"${error ? " open" : ""}>
<summary><svg class="lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></svg><span>Private access</span></summary>
<form action="/site-unlock" method="post">
<input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}">
<label for="site-password">Site password</label>
<input id="site-password" name="password" type="password" autocomplete="current-password" maxlength="128" required${error ? ' aria-invalid="true" aria-describedby="password-error"' : ""}>
${error ? `<p class="error" id="password-error" role="alert">${escapeHtml(error)}</p>` : ""}
<button type="submit">Enter site</button>
</form></details>
</main></body></html>`;
}
