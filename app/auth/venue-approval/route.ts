import { BROWSER_AUTH_SESSION_KEY } from "@/src/lib/dancr/browser-session";
import { createRootContentSecurityPolicy } from "@/src/lib/security/root-content-security-policy.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET does not exchange or consume a link. No analytics or third-party scripts
// run on this page, and the private fragment is removed before the POST.
export function GET() {
  const html = `<!doctype html><html lang="en"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark"><meta name="referrer" content="no-referrer">
    <title>Opening your Club dashboard | MyDancr</title>
    <style>
      :root{color-scheme:only dark;background:#090510}*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:#090510;color:#f7f2ff;font-family:system-ui,sans-serif}main{width:min(100%,460px);padding:32px 24px;border:1px solid #51445e;border-radius:24px;background:#100b19;display:grid;gap:20px;text-align:center}h1,p{margin:0}p{line-height:1.6}a{color:#f7f2ff}button,#continue{min-height:48px;border:1px solid #6d28ff;border-radius:14px;background:#6d28ff;color:#fff;font:700 16px system-ui;padding:12px 20px;cursor:pointer}#continue{text-decoration:none}button:focus-visible,a:focus-visible{outline:3px solid #b89cff;outline-offset:4px}[hidden]{display:none!important}
    </style><link rel="stylesheet" href="/dancr-status-pages.v1.css?v=3"></head>
    <body class="dancr-status-page"><main class="dancr-status-card"><p class="eyebrow">MyDancr</p><h1 id="heading">Opening your Club dashboard</h1><p id="status" role="status">Securely signing you in…</p><a id="continue" href="/dashboard/venue" hidden>Open Club dashboard</a><button id="retry" type="button" hidden>Try again</button><a href="/?venueAccess=1&amp;venueMode=login">Sign in with email and password</a><noscript>Enable JavaScript to open your private link.</noscript></main>
    <script>(function(){
      var key=${JSON.stringify(BROWSER_AUTH_SESSION_KEY)};
      var link=new URLSearchParams(window.location.hash.slice(1)).get('link');
      window.history.replaceState(null,'','/auth/venue-approval');
      var status=document.getElementById('status'),retry=document.getElementById('retry'),continueLink=document.getElementById('continue'),busy=false;
      async function openLink(){
        if(busy)return;
        busy=true;retry.hidden=true;continueLink.hidden=true;
        status.textContent='Securely signing you in…';
        try{
          if(!link)throw new Error('Open the Club dashboard link in your approval email.');
          var previous=window.localStorage.getItem(key);
          var response=await fetch('/api/venue/approval-login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({link:link}),cache:'no-store',signal:AbortSignal.timeout(25000)});
          var data=await response.json();
          if(!response.ok||!data.ok)throw new Error(data.error||'Unable to sign in. Please try this email link again.');
          if(window.localStorage.getItem(key)!==previous)throw new Error('Your sign-in changed in another window. Open the email link again to continue.');
          if(!data.session?.accessToken||!data.session?.refreshToken||!data.account?.id||data.account?.role!=='venue'||data.account?.accountState!=='active')throw new Error('Unable to confirm your club account. Please try again.');
          var saved=JSON.stringify({...data.session,account:data.account});
          window.localStorage.setItem(key,saved);
          if(window.localStorage.getItem(key)!==saved)throw new Error('Unable to save your sign-in in this browser. Allow site storage and try again.');
          status.textContent='Signed in. Opening your Club dashboard…';
          continueLink.hidden=false;
          continueLink.onclick=function(event){event.preventDefault();if(window.localStorage.getItem(key)===saved)window.location.replace('/dashboard/venue');else{continueLink.hidden=true;retry.hidden=false;status.textContent='Your sign-in changed. Try again to continue.';}};
          window.location.replace('/dashboard/venue');
        }catch(error){status.textContent=error instanceof Error?error.message:'Unable to open your dashboard. Please try the email link again.';retry.hidden=!link;}
        finally{busy=false;}
      }
      retry.addEventListener('click',openLink);void openLink();
    })();</script></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store, max-age=0", "referrer-policy": "no-referrer",
    "content-security-policy": createRootContentSecurityPolicy(html), "x-content-type-options": "nosniff" } });
}
