import { BROWSER_AUTH_SESSION_KEY } from "@/src/lib/dancr/browser-session";
import { notificationDestinationRole } from "@/src/lib/dancr/notification-email-path";
import { createRootContentSecurityPolicy } from "@/src/lib/security/root-content-security-policy.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET does not exchange or consume a link. No analytics or third-party scripts
// run on this page, and the private fragment is removed before the POST.
export function GET(request: Request) {
  const url = new URL(request.url);
  const notification = url.pathname === "/auth/notification";
  const to = url.searchParams.get("to");
  const role = notification ? notificationDestinationRole(to) : "venue";
  if (!role) return new Response("Invalid email destination.",{status:400,headers:{"cache-control":"no-store"}});
  const kind = url.searchParams.get("review");
  const review = kind === "dancer" || kind === "media";
  const destination = notification ? to! : kind === "media" ? "/dashboard/venue#venue-media-reviews" : review ? "/dashboard/venue/approvals" : "/dashboard/venue";
  const landingPath = notification ? "/auth/notification?to="+encodeURIComponent(destination) : "/auth/venue-approval" + (review ? "?review=" + kind : "");
  const heading = notification ? "Opening your notification" : "Opening your Club dashboard";
  const html = `<!doctype html><html lang="en"><head>
    <link rel="stylesheet" href="/dancr-typography.v1.css">
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark"><meta name="referrer" content="no-referrer">
    <title>${heading} | MyDancr</title>
    <style>
      :root{color-scheme:only dark;background:#090510}*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:#090510;color:#f7f2ff;font-family:system-ui,sans-serif}main{width:min(100%,460px);padding:32px 24px;border:1px solid #51445e;border-radius:24px;background:#100b19;display:grid;gap:20px;text-align:center}h1,p{margin:0}p{line-height:1.6}a{color:#f7f2ff}button,#continue{min-height:48px;border:1px solid #6d28ff;border-radius:14px;background:#6d28ff;color:#fff;font:700 16px system-ui;padding:12px 20px;cursor:pointer}#continue{text-decoration:none}button:focus-visible,a:focus-visible{outline:3px solid #b89cff;outline-offset:4px}[hidden]{display:none!important}
    </style><link rel="stylesheet" href="/dancr-status-pages.v1.css?v=3"></head>
    <body class="dancr-status-page"><main class="dancr-status-card"><p class="eyebrow">MyDancr</p><h1 id="heading">${heading}</h1><p id="status" role="status">Securely signing you in…</p><a id="continue" href="${destination}" hidden>Continue</a><button id="retry" type="button" hidden>Try again</button><a href="${review || notification ? destination : "/?venueAccess=1&amp;venueMode=login"}">Sign in with email and password</a><noscript>Enable JavaScript to open your private link.</noscript></main>
    <script>(function(){
      var key=${JSON.stringify(BROWSER_AUTH_SESSION_KEY)},review=${review},destination=${JSON.stringify(destination)},notification=${notification},role=${JSON.stringify(role)};
      var link=new URLSearchParams(window.location.hash.slice(1)).get('link');
      if(review){
        try{link=link||window.sessionStorage.getItem('mydancr:pending-review-login');window.sessionStorage.removeItem('mydancr:pending-review-login');}catch{}
      }
      window.history.replaceState(null,'',${JSON.stringify(landingPath)});
      var status=document.getElementById('status'),retry=document.getElementById('retry'),continueLink=document.getElementById('continue'),busy=false;
      async function openLink(){
        if(busy)return;
        busy=true;retry.hidden=true;continueLink.hidden=true;
        status.textContent='Securely signing you in…';
        try{
          if(!link&&notification){window.location.replace(destination);return;}
          if(!link)throw new Error('Open the Club dashboard link in your approval email.');
          var previous=window.localStorage.getItem(key);
          var headers={'content-type':'application/json'},attempt;
          if(notification||review){
            attempt=window.sessionStorage.getItem('mydancr:email-open-attempt');
            if(!attempt){attempt=crypto.randomUUID();window.sessionStorage.setItem('mydancr:email-open-attempt',attempt);}
          }
          if((notification||review)&&previous){
            try{var current=JSON.parse(previous);if(current?.accessToken)headers.authorization='Bearer '+current.accessToken;}catch{}
          }
          var response=await fetch(notification?'/api/auth/notification-login':'/api/venue/approval-login',{method:'POST',headers:headers,body:JSON.stringify(notification?{link:link,to:destination,attempt:attempt}:{link:link,review:${JSON.stringify(kind)},attempt:attempt}),cache:'no-store',signal:AbortSignal.timeout(25000)});
          var data=await response.json();
          if(review&&!notification&&response.status===403&&!previous){window.location.replace(destination);return;}
          if(!response.ok||!data.ok)throw new Error(data.error||'Unable to sign in. Please try this email link again.');
          if(window.localStorage.getItem(key)!==previous)throw new Error('Your sign-in changed in another window. Open the email link again to continue.');
          if(data.completionId){
            var accountId=data.recipientId||(data.alreadySignedIn?current?.account?.id:data.account?.id);
            var arrival=destination==='/dashboard/venue/approvals'?'/dashboard/venue#venue-dancer-approvals':destination;
            window.sessionStorage.setItem('mydancr:email-arrival',JSON.stringify({id:data.completionId,accountId:accountId,to:arrival}));
          }
          if((notification||review)&&data.signInRequired){window.location.replace(destination);return;}
          if((review||notification)&&headers.authorization&&data.alreadySignedIn){window.location.replace(destination);return;}
          if(!data.session?.accessToken||!data.session?.refreshToken||!data.account?.id||data.account?.role!==role||data.account?.accountState!=='active')throw new Error('Unable to confirm your account. Please try again.');
          var saved=JSON.stringify({...data.session,account:data.account});
          window.localStorage.setItem(key,saved);
          if(window.localStorage.getItem(key)!==saved)throw new Error('Unable to save your sign-in in this browser. Allow site storage and try again.');
          status.textContent='Signed in. Opening your dashboard…';
          continueLink.hidden=false;
          continueLink.onclick=function(event){event.preventDefault();if(window.localStorage.getItem(key)===saved)window.location.replace(destination);else{continueLink.hidden=true;retry.hidden=false;status.textContent='Your sign-in changed. Try again to continue.';}};
          window.location.replace(destination);
        }catch(error){status.textContent=error instanceof Error?error.message:'Unable to open your dashboard. Please try the email link again.';retry.hidden=!link;}
        finally{busy=false;}
      }
      retry.addEventListener('click',openLink);
      if((review||notification)&&document.visibilityState==='hidden'){
        document.addEventListener('visibilitychange',function visible(){if(document.visibilityState==='visible'){document.removeEventListener('visibilitychange',visible);void openLink();}});
      }else{void openLink();}
    })();</script></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store, max-age=0", "referrer-policy": "no-referrer",
    "content-security-policy": createRootContentSecurityPolicy(html), "x-content-type-options": "nosniff" } });
}
