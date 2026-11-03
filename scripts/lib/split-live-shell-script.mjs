import ts from "typescript";

// Explicit boundaries keep the classic shell's global bindings and synchronous
// handlers intact. These constructors are first called after loadHomeTvFeed.
export const LIVE_SHELL_FEATURE_FUNCTIONS = Object.freeze({
  tv: [
    "createHomeTvFeedCopy", "createHomeTvFeedVideo", "createHomeTvFeedActions",
    "createHomeTvFeedTools", "createHomeTvFeedDealButton",
    "createHomeTvFeedProgress", "renderHomeTvFeedSlide", "syncHomeTvFeedProgress",
    "toggleHomeTvFeedFullscreen", "homeTvFeedDealState", "shareHomeTvFeedVideo",
    "createHomeTvFeedSoundButton", "createHomeTvFeedFullscreenButton",
    "applaudHomeTvFeedVideo", "toggleHomeTvFeedPlayback", "showRelativeHomeTvFeedSlide",
    "createHomeTvFeedFullViewCloseButton", "showHomeTvFeedFeedback",
    "showHomeTvFeedPlaybackFeedback", "createHomeTvFeedMediaFallback",
    "homeTvFeedSchedule", "createHomeTvFeedActionButton", "createHomeTvFeedSlide",
  ],
});

// Async actions keep their Promise contract while their implementation loads.
// Startup, navigation and synchronous render helpers remain in the initial shell.
export const LIVE_SHELL_ASYNC_FEATURES = Object.freeze({
  editing: ["uploadApprovedDancerPhoto", "submitSetupPhotos", "saveApprovedDancerProfile",
    "handleDancerControlAction", "submitApprovedProfileVideo", "deleteApprovedDancerPhoto",
    "submitDancerProfileForReview", "cropSavedDancerMainPhoto", "readApprovedProfileVideoMetadata",
    "cropApprovedProfilePhoto", "submitApprovedProfileChangesForReview", "handleApprovedEditPopoverClick",
    "persistQueuedApprovedPhotoDeletionsBeforeUpload", "uploadSetupPhotoFile", "hydrateConfirmedApprovedDancerPhoto"],
  account: ["sendPasswordReset", "submitVenueSignup", "submitPublicContactForm", "verifyVenueAccessCode",
    "submitLoginRecoveryForm", "updateAccountPassword", "sendSupportMessage", "createDancerVenueVerification"],
  profile: ["openInternalProfileMessage", "openPublicProfileMessage", "saveProfileGoing", "saveProfileFollow",
    "saveProfileNotifications", "shareProfilePhoto", "shareProfileTvVideo"],
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
          const allowed = ts.isFunctionDeclaration(statement) && (
            node.text === "createHomeTvFeedSlide" && statement.name.text === "renderHomeTvFeed"
            || node.text === "renderHomeTvFeedSlide" && statement.name.text === "hydrateHomeTvFeedSlide"
          );
          if (!allowed) throw new Error(`Unloaded ${feature} function referenced outside its boundary: ${node.text}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(statement);
    }
    features[feature] = nodes.map(node => source.slice(node.pos, node.end)).join("\n");
    removed.push(...nodes);
  }
  const replacements = removed.map(node => ({ node, code: "" }));
  for (const [feature, names] of Object.entries(LIVE_SHELL_ASYNC_FEATURES)) {
    const nodes = names.map(name => {
      const node = functions.get(name);
      if (!node?.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)) {
        throw new Error(`Async shell boundary required: ${name}`);
      }
      return node;
    });
    features[feature] = nodes.map(node => source.slice(node.pos, node.end)).join("\n");
    for (const node of nodes) replacements.push({ node,
      code: `\nasync function ${node.name.text}(...args) { try { await loadLiveShellFeature("${feature}"); } catch (error) { showToast(error.message); throw error; } return ${node.name.text}.apply(this, args); }\n` });
  }
  let main = source;
  for (const { node, code } of replacements.sort((a, b) => b.node.pos - a.node.pos)) main = main.slice(0, node.pos) + code + main.slice(node.end);
  return { main, features };
}
