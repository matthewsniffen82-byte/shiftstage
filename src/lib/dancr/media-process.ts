import { spawn } from "node:child_process";
import { assertServerJobActive, serverJobSignal } from "../server-job.ts";

type MediaProcessOptions = {
  timeoutMs: number;
  timeoutMessage: string;
  failureMessage: string;
  captureStdout?: boolean;
  allowNoOutput?: boolean;
  stderrMaxChars?: number;
};

/** Kill on cancellation and await close before a caller removes its workspace. */
export function runMediaProcess(executable: string, args: string[], options: MediaProcessOptions) {
  assertServerJobActive();
  const signal = serverJobSignal();
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ["ignore", options.captureStdout ? "pipe" : "ignore", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let failure: Error | undefined;
    let finished = false;
    const cancel = () => {
      failure ||= signal?.reason instanceof Error ? signal.reason : new Error(options.timeoutMessage);
      child.kill("SIGKILL");
    };
    const finish = (code: number | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      if (failure) reject(failure);
      else if (code === 0 || options.allowNoOutput) resolve({ stdout, stderr });
      else reject(new Error(`${options.failureMessage}: ${stderr.slice(-600) || `exit ${code}`}`));
    };
    const timer = setTimeout(() => {
      failure ||= new Error(options.timeoutMessage);
      child.kill("SIGKILL");
    }, options.timeoutMs);
    child.stderr?.on("data", chunk => { stderr = `${stderr}${String(chunk)}`.slice(-(options.stderrMaxChars ?? 4_000)); });
    child.stdout?.on("data", chunk => { stdout = `${stdout}${String(chunk)}`.slice(-8_000); });
    child.once("error", error => {
      failure ||= error;
      if (!child.pid) finish(null);
    });
    child.once("close", finish);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
  });
}
