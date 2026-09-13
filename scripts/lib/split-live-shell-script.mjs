import ts from "typescript";

// Explicit boundaries keep the classic shell's global bindings and synchronous
// handlers intact. These constructors are first called after loadHomeTvFeed.
export const LIVE_SHELL_FEATURE_FUNCTIONS = Object.freeze({
  tv: [
    "createHomeTvFeedCopy", "createHomeTvFeedVideo", "createHomeTvFeedActions",
    "createHomeTvFeedProgress", "renderHomeTvFeedSlide", "syncHomeTvFeedProgress",
    "toggleHomeTvFeedFullscreen", "homeTvFeedDealState", "shareHomeTvFeedVideo",
    "createHomeTvFeedSoundButton", "createHomeTvFeedFullscreenButton",
    "applaudHomeTvFeedVideo", "toggleHomeTvFeedPlayback", "showRelativeHomeTvFeedSlide",
    "createHomeTvFeedFullViewCloseButton", "showHomeTvFeedFeedback",
    "showHomeTvFeedPlaybackFeedback", "createHomeTvFeedMediaFallback",
    "homeTvFeedSchedule", "createHomeTvFeedActionButton", "createHomeTvFeedSlide",
  ],
});

export function splitLiveShellScript(source) {
  const file = ts.createSourceFile("shell.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const functions = new Map(file.statements.filter(ts.isFunctionDeclaration).map(node => [node.name.text, node]));
  const removed = [];
  const features = {};
  for (const [feature, names] of Object.entries(LIVE_SHELL_FEATURE_FUNCTIONS)) {
    const nodes = names.map(name => {
      const node = functions.get(name);
      if (!node) throw new Error(`Missing ${feature} shell function: ${name}`);
      return node;
    }).sort((a, b) => a.pos - b.pos);
    // Fail the build if a new caller crosses the reviewed loading boundary.
    const selected = new Set(nodes);
    for (const statement of file.statements) {
      if (selected.has(statement)) continue;
      const visit = node => {
        if (ts.isIdentifier(node) && names.includes(node.text)) {
          const allowed = node.text === "createHomeTvFeedSlide"
            && ts.isFunctionDeclaration(statement) && statement.name.text === "renderHomeTvFeed";
          if (!allowed) throw new Error(`Unloaded ${feature} function referenced outside its boundary: ${node.text}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(statement);
    }
    features[feature] = nodes.map(node => source.slice(node.pos, node.end)).join("\n");
    removed.push(...nodes);
  }
  let main = source;
  for (const node of removed.sort((a, b) => b.pos - a.pos)) main = main.slice(0, node.pos) + main.slice(node.end);
  return { main, features };
}
