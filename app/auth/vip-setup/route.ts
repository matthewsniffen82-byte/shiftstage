import { BROWSER_AUTH_SESSION_KEY } from "@/src/lib/dancr/browser-session";
import { createRootContentSecurityPolicy } from "@/src/lib/security/root-content-security-policy.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Standalone page: no analytics, app scripts or third-party requests can read the
// emailed bearer link. The fragment is removed before its same-origin exchange.
export function GET() {
  const html = `<!doctype html><html lang="en"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="referrer" content="no-referrer"><title>VIP setup | MyDancr</title>
    <style>
      :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:#090510;color:#f7f2ff;font-family:system-ui,sans-serif}
      main{width:min(100%,460px);padding:32px 24px;border:1px solid #51445e;border-radius:24px;background:#100b19;display:grid;gap:20px;text-align:center}h1,p{margin:0}p{line-height:1.6}a{color:#e8d6b3}button{min-height:48px;border:1px solid #643ac2;border-radius:14px;background:#29009b;color:#fff;-webkit-text-fill-color:#fff;appearance:none;-webkit-appearance:none;font:700 16px system-ui;padding:12px 20px;cursor:pointer}button:focus-visible,a:focus-visible{outline:3px solid #e8d6b3;outline-offset:4px}[hidden]{display:none!important}
    </style></head><body><main><h1>Opening your VIP setup</h1><p id="status" role="status">Checking your private link…</p><button id="retry" type="button" hidden>Try again</button><a href="/vip">Go to VIP sign in</a><noscript>Enable JavaScript to open your private link.</noscript></main>
    <script>(function(){
      var key=${JSON.stringify(BROWSER_AUTH_SESSION_KEY)};
      var link=new URLSearchParams(window.location.hash.slice(1)).get('link');
      window.history.replaceState(null,'','/auth/vip-setup');
      var status=document.getElementById('status'), retry=document.getElementById('retry'), busy=false;
      async function openLink(){
        if(busy)return;
        busy=true;retry.hidden=true;status.textContent='Checking your private link…';
        try{
          if(!link)throw new Error('Open the private setup link from your email.');
          var previous=window.localStorage.getItem(key);
          var response=await fetch('/api/vip/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({link:link}),cache:'no-store',signal:AbortSignal.timeout(25000)});
          var data=await response.json();
          if(!response.ok||!data.ok)throw new Error(data.error||'We couldn’t open this link. Please try again.');
          if(!/^\\/vip\\/invite\\/vip_[A-Za-z0-9_-]{48}$/.test(data.returnTo||''))throw new Error('Unable to confirm your VIP destination.');
          if(window.localStorage.getItem(key)!==previous)throw new Error('Your sign-in changed in another window. Open the email link again to continue.');
          if(data.complete===true){window.location.replace(data.returnTo);return;}
          if(!data.session?.accessToken||!data.session?.refreshToken||data.account?.role!=='customer'||data.account?.accountState!=='active')throw new Error('Unable to confirm your guest account. Please try again.');
          var saved=JSON.stringify({...data.session,account:data.account});
          window.localStorage.setItem(key,saved);
          if(window.localStorage.getItem(key)!==saved)throw new Error('Unable to save your sign-in in this browser.');
          window.location.replace('/account/reset-password?setup=1&return_to='+encodeURIComponent(data.returnTo));
        }catch(error){status.textContent=error instanceof Error?error.message:'Unable to open this link. Please try again.';retry.hidden=!link;}
        finally{busy=false;}
      }
      retry.addEventListener('click',openLink);void openLink();
    })();</script></body></html>`;
  return new Response(html, { headers: {
    "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store, max-age=0", "referrer-policy": "no-referrer",
    "content-security-policy": createRootContentSecurityPolicy(html), "x-content-type-options": "nosniff",
  } });
}
