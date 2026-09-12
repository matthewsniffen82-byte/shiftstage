// Includes the June and July 2026 security releases; stay on the reviewed LTS major.
export function assertSupportedNodeRuntime(version = process.versions.node) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match || match[0] !== version || Number(match[1]) !== 24 || Number(match[2]) < 18
      || (Number(match[2]) === 18 && Number(match[3]) < 1)) {
    throw new Error("Use Node.js 24.18.1 or newer within Node.js 24 LTS. The recommended local version is 24.21.0.");
  }
}
