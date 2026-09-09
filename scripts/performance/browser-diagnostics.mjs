// The desktop WebKit runner can report canceled old-document fetches as page errors.
// Accept only observed TV endpoints with a matching canceled request and phase.
export function isWebkitNavigationCancellation(error, failedRequests, engine) {
  if (engine !== "webkit" || !error.stack?.includes("web-inspector://bootstrap.js") || !error.lastCompletedPhase) return false;
  const path = error.message?.match(/(\/api\/public\/tv(?:\/count)?)\?[^\s]* due to access control checks\.$/)?.[1];
  return Boolean(path && failedRequests.some(request => request.path === path
    && request.failure === "Load request cancelled"
    && request.lastCompletedPhase === error.lastCompletedPhase));
}
