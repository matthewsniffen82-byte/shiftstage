import { BROWSER_AUTH_SESSION_KEY } from "@/src/lib/dancr/browser-session";
import { createRootContentSecurityPolicy } from "@/src/lib/security/root-content-security-policy.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Email scanners and GET requests cannot verify or consume an action.
export function GET(request: Request) {
  // This hint selects fixed display copy only. The signed link and stored action
  // still determine what happens after Continue; older links need no new hint.
  const purpose = new URL(request.url).searchParams.get("purpose");
  const [heading, message] = purpose === "confirmation"
    ? ["Confirm your email", "Continue to confirm your email and finish setting up your account."]
    : purpose === "recovery"
      ? ["Reset your password", "Continue to choose a new password for your account."]
      : purpose === "email_change"
        ? ["Confirm email change", "Continue to confirm this email address for your account."]
        : ["Continue", "Continue to complete the action from your email."];
  const html = `<!doctype html><html lang="en"><head>
    <link rel="stylesheet" href="/dancr-typography.v1.css"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>${heading} | MyDancr</title>
    <style>:root{color-scheme:dark}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;box-sizing:border-box;background:#090510;color:#f7f2ff;font-family:system-ui,sans-serif}main{width:min(100%,460px);padding:28px;box-sizing:border-box;border:1px solid #51445e;border-radius:24px;background:#100b19;text-align:center}p{line-height:1.6}button,a{font:700 16px system-ui;color:inherit}button{min-height:48px;padding:12px 24px;border:0;border-radius:14px;background:#6d28ff;cursor:pointer}button:disabled{opacity:.6}a{display:block;margin-top:20px}[hidden]{display:none!important}</style><link rel="stylesheet" href="/dancr-status-pages.v1.css?v=3"></head>
    <body class="dancr-status-page dancr-confirmation-page"><main class="dancr-status-card"><p class="eyebrow">MyDancr</p><h1 id="heading">${heading}</h1><p id="status" role="status">${message}</p><button id="continue" type="button">Continue</button><a id="signIn" href="/?auth=login" hidden>Back to sign in</a><noscript>Enable JavaScript to continue.</noscript></main>
    <script>(function(){
      var key=${JSON.stringify(BROWSER_AUTH_SESSION_KEY)},link=new URLSearchParams(location.hash.slice(1)).get('link');
      history.replaceState(null,'','/auth/email-action');
      var button=document.getElementById('continue'),status=document.getElementById('status'),signIn=document.getElementById('signIn');
      button.addEventListener('click',async function(){
        if(button.disabled)return;
        button.disabled=true;signIn.hidden=true;status.hidden=false;status.textContent='Checking your link…';
        try{
          if(!link)throw new Error('Open the complete link from your email.');
          var previous=localStorage.getItem(key);
          var response=await fetch('/api/auth/email-action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({link:link}),cache:'no-store',signal:AbortSignal.timeout(25000)});
          var data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||'Unable to continue. Please try again.');
          if(data.pending){status.textContent='This inbox is confirmed. Open the confirmation link in your other inbox to finish changing your email.';button.hidden=true;return;}
          if(data.complete){document.getElementById('heading').textContent='Email changed';status.textContent=data.message;button.hidden=true;signIn.href=data.returnTo==='/admin'?'/admin':'/?auth=login';signIn.hidden=false;return;}
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
        }catch(error){status.textContent=error instanceof Error?error.message:'Unable to finish. Please try the same email link again.';button.textContent='Try again';signIn.hidden=false;}
        finally{button.disabled=false;}
      });
    })();</script></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store, max-age=0", "referrer-policy": "no-referrer",
    "content-security-policy": createRootContentSecurityPolicy(html), "x-content-type-options": "nosniff" } });
}
