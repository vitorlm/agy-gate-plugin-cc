import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Bundled Seatbelt profile path (macOS). Resolved relative to this module. */
export const PROFILE_PATH = fileURLToPath(new URL("../../sandbox/readonly.sb", import.meta.url));

/**
 * Whether an executable named `bin` is on PATH. Injectable for tests.
 * @param {string} bin
 * @param {Record<string, string|undefined>} env
 * @returns {boolean}
 */
function onPath(bin, env) {
  const dirs = (env.PATH ?? "").split(delimiter);
  return dirs.some((d) => d && existsSync(join(d, bin)));
}

/**
 * @typedef {{ ok: true, command: string, args: string[] }
 *   | { ok: false, error: { code: "SANDBOX_UNAVAILABLE", message: string, remediation: string } }} WrapResult
 */

/** @param {string} message */
function unavailable(message) {
  return {
    ok: /** @type {const} */ (false),
    error: {
      code: /** @type {const} */ ("SANDBOX_UNAVAILABLE"),
      message,
      remediation:
        "Install the platform read-only sandbox (macOS ships sandbox-exec; on Linux install bubblewrap/bwrap). agy-gate refuses to run agy unsandboxed (§10).",
    },
  };
}

/**
 * Build the OS read-only sandbox wrapper around an `agy` argv (§5.6/§10). The
 * subprocess gets read-only access to the whole filesystem EXCEPT it may still
 * write its own state (`~/.gemini`) and use the network — only the project dir is
 * write-denied. Returns SANDBOX_UNAVAILABLE (never an unsandboxed command) when the
 * platform binary is missing or the platform is unsupported.
 *
 * @param {string[]} argv  e.g. ["agy", "--print", prompt, "--model", model]
 * @param {{
 *   projectDir: string,
 *   platform?: NodeJS.Platform,
 *   home?: string,
 *   env?: Record<string, string|undefined>,
 *   realpath?: (p: string) => string,
 *   binExists?: (bin: string) => boolean,
 *   profilePath?: string,
 * }} opts
 * @returns {WrapResult}
 */
export function wrap(argv, opts) {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const home = opts.home ?? homedir();
  const realpath = opts.realpath ?? ((p) => realpathSync(p));
  const binExists = opts.binExists ?? ((bin) => onPath(bin, env));
  const profilePath = opts.profilePath ?? PROFILE_PATH;

  // Seatbelt matches RESOLVED paths (/tmp → /private/tmp); resolve defensively.
  let realDir;
  try {
    realDir = realpath(opts.projectDir);
  } catch {
    realDir = opts.projectDir;
  }

  if (platform === "darwin") {
    if (!binExists("sandbox-exec")) return unavailable("sandbox-exec not found on PATH (macOS).");
    return {
      ok: true,
      command: "sandbox-exec",
      args: ["-D", `PROJECT_DIR=${realDir}`, "-f", profilePath, ...argv],
    };
  }

  if (platform === "linux") {
    if (!binExists("bwrap")) return unavailable("bwrap (bubblewrap) not found on PATH (Linux).");
    const geminiDir = join(home, ".gemini");
    return {
      ok: true,
      command: "bwrap",
      args: [
        "--ro-bind",
        "/",
        "/",
        "--dev",
        "/dev",
        "--proc",
        "/proc",
        "--tmpfs",
        "/tmp",
        "--bind",
        geminiDir,
        geminiDir,
        "--ro-bind",
        "/etc/resolv.conf",
        "/etc/resolv.conf",
        "--share-net",
        "--die-with-parent",
        "--new-session",
        "--chdir",
        realDir,
        "--",
        ...argv,
      ],
    };
  }

  return unavailable(`Unsupported platform for the read-only sandbox: ${platform}.`);
}
