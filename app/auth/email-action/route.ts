import { BROWSER_AUTH_SESSION_KEY } from "@/src/lib/dancr/browser-session";
import { createRootContentSecurityPolicy } from "@/src/lib/security/root-content-security-policy.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Email scanners and GET requests cannot verify or consume an action.
export function GET() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>Continue securely | MyDancr</title>
    <style>:root{color-scheme:dark}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;box-sizing:border-box;background:#090510;color:#f7f2ff;font-family:system-ui,sans-serif}main{width:min(100%,460px);padding:28px;box-sizing:border-box;border:1px solid #51445e;border-radius:24px;background:#100b19;text-align:center}p{line-height:1.6}button,a{font:700 16px system-ui;color:inherit}button{min-height:48px;padding:12px 24px;border:0;border-radius:14px;background:#6d28ff;cursor:pointer}button:disabled{opacity:.6}a{display:block;margin-top:20px}[hidden]{display:none!important}</style><link rel="stylesheet" href="/dancr-status-pages.v1.css?v=3"></head>
    <body class="dancr-status-page"><main class="dancr-status-card"><p>MyDancr</p><h1 id="heading">Continue securely</h1><p id="status" role="status">Continue to finish the action you requested. You can return to this email if something interrupts it.</p><button id="continue" type="button">Continue</button><a id="signIn" href="/?auth=login">Back to sign in</a><noscript>Enable JavaScript to continue.</noscript></main>
    <script>(function(){
      var key=${JSON.stringify(BROWSER_AUTH_SESSION_KEY)},link=new URLSearchParams(location.hash.slice(1)).get('link');
      history.replaceState(null,'','/auth/email-action');
      var button=document.getElementById('continue'),status=document.getElementById('status');
      button.addEventListener('click',async function(){
        if(button.disabled)return;
        button.disabled=true;status.textContent='Checking your secure link…';
        try{
          if(!link)throw new Error('Open the complete link from your email.');
          var previous=localStorage.getItem(key);
          var response=await fetch('/api/auth/email-action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({link:link}),cache:'no-store',signal:AbortSignal.timeout(25000)});
          var data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||'Unable to continue. Please try again.');
          if(data.pending){status.textContent='This inbox is confirmed. Open the confirmation link in your other inbox to finish changing your email.';button.hidden=true;return;}
          if(data.complete){document.getElementById('heading').textContent='Email changed';status.textContent=data.message;button.hidden=true;return;}
          if(localStorage.getItem(key)!==previous)throw new Error('Your sign-in changed in another window. Open the email link again to continue.');
          if(!data.session?.accessToken||!data.session?.refreshToken||!data.account?.id||data.account?.accountState!=='active')throw new Error('Your account could not be confirmed. Please try again.');
          if(typeof data.returnTo!=='string'||!data.returnTo.startsWith('/')||data.returnTo.startsWith('//')||data.returnTo.includes('\\\\'))throw new Error('Your destination could not be confirmed.');
          var saved=JSON.stringify({...data.session,account:data.account});localStorage.setItem(key,saved);
          if(localStorage.getItem(key)!==saved)throw new Error('Allow site storage in this browser, then try this email link again.');
          if(data.purpose==='confirmation'){
            var completed=await fetch('/api/auth/email-action',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+data.session.accessToken},body:JSON.stringify({link:link,action:'complete'}),cache:'no-store',signal:AbortSignal.timeout(25000)});
            if(!completed.ok)throw new Error('Your email is confirmed, but setup could not finish. Try again.');
          }
          if(localStorage.getItem(key)!==saved)throw new Error('Your sign-in changed. Sign in to continue.');
          location.replace(data.returnTo);
        }catch(error){status.textContent=error instanceof Error?error.message:'Unable to finish. Please try the same email link again.';button.textContent='Try again';}
        finally{button.disabled=false;}
      });
    })();</script></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store, max-age=0", "referrer-policy": "no-referrer",
    "content-security-policy": createRootContentSecurityPolicy(html), "x-content-type-options": "nosniff" } });
}
