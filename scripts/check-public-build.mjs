import { verifyPublicBuild } from "./lib/public-build-security.mjs";

try {
  const result = await verifyPublicBuild({ root: process.cwd(), environment: process.env });
  console.log(`PUBLIC_BUILD_SECURITY_VERIFIED ${JSON.stringify(result)}`);
} catch {
  // File errors can contain paths or input. Keep the build log value-free.
  console.error("PUBLIC_BUILD_SECURITY_REJECTED: inspect public artifacts and build configuration locally.");
  process.exitCode = 1;
}
