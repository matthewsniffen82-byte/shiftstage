import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const htmlPath = path.join(process.cwd(), "outputs", "index.html");
  const html = await readFile(htmlPath, "utf8");
  const dancerDashboardRoutingBridge = [
    "<script>",
    "(() => {",
    "  const openDancerAccount = (mode) => window.location.assign(\"/account?role=dancer&mode=\" + mode);",
    "  document.addEventListener(\"click\", (event) => {",
    "    const target = event.target && event.target.closest ? event.target.closest(\"#loginDancerOption, #dancerLoginBtn, #openDancerSignup, #dancerJoinNowBtn, #accountBtn\") : null;",
    "    if (!target) return;",
    "    let destination = \"\";",
    "    if (target.id === \"accountBtn\") {",
    "      try {",
    "        const session = JSON.parse(window.localStorage.getItem(\"dancrAuthSessionV1\") || \"null\");",
    "        if (session?.accessToken && (session?.account?.role || session?.role) === \"dancer\") destination = \"/dashboard/dancer\";",
    "      } catch (error) {}",
    "      if (!destination) return;",
    "    } else {",
    "      destination = target.id === \"dancerLoginBtn\" || target.id === \"loginDancerOption\" ? \"/account?role=dancer&mode=login\" : \"/account?role=dancer&mode=signup\";",
    "    }",
    "    event.preventDefault();",
    "    event.stopImmediatePropagation();",
    "    window.location.assign(destination);",
    "  }, true);",
    "  document.addEventListener(\"submit\", (event) => {",
    "    const form = event.target;",
    "    if (!form || (form.id !== \"dancerLoginForm\" && form.id !== \"dancerSignupForm\")) return;",
    "    event.preventDefault();",
    "    event.stopImmediatePropagation();",
    "    openDancerAccount(form.id === \"dancerSignupForm\" ? \"signup\" : \"login\");",
    "  }, true);",
    "})();",
    "</script>",
  ].join("");
  const withBase = html.replace("<head>", '<head><base href="/outputs/">' + dancerDashboardRoutingBridge);

  return new Response(withBase, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
