import fs from "node:fs/promises";

/**
 * Permissions for the data directory and the files in it (issue 067, PRD-15 §Further Notes).
 *
 * The YouTube refresh token is stored in plaintext — a decision taken in issue 042, because a
 * boot-supplied key on a single VPS lives on the same disk as the file it protects, and a key from
 * outside the host either needs a secret manager this deployment does not have or a human typing
 * at every restart, which breaks unattended recovery on show night. That decision is only
 * defensible if the file is actually treated as secret material, which is what these modes are.
 *
 * The directory is `0700`, not `0600`: a directory needs its execute bit to be traversed at all,
 * so `0600` on the directory would lock the server out of its own store.
 */
export const SECRET_DIR_MODE = 0o700;
export const SECRET_FILE_MODE = 0o600;

/** Windows has no POSIX mode bits; `chmod` there only toggles the read-only flag. */
const POSIX = process.platform !== "win32";

/**
 * Forces `target` to `mode`, tolerating a path that is not there.
 *
 * Create-time modes cannot do this job alone: `mkdir` ignores its mode for a directory that
 * already exists and `writeFile` ignores its mode for a file that already exists, so every
 * deployment made before this change would keep the `0755`/`0644` it was created with and never be
 * told. A missing path is not an error here — a store that has not been seeded yet gets its mode
 * from the create-time constants a moment later.
 */
export async function tighten(target: string, mode: number): Promise<void> {
  if (!POSIX) return;
  try {
    await fs.chmod(target, mode);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    // A path this process cannot chmod — a bind mount owned by another uid, a read-only mount
    // (EROFS), a filesystem with no mode bits to set (ENOTSUP on some network and container
    // mounts). Worth shouting about, because the file is then as open as whoever mounted it left
    // it. Never worth refusing to boot over: a server that will not start on show night is the
    // more expensive failure, and the operator can still fix the mount. No code is rethrown for
    // the same reason — this runs inside JsonStore.init, so a rethrow *is* a failed boot.
    console.warn(
      `[storage] could not set permissions on ${target} (${code ?? "unknown error"}). It may be ` +
        `readable by other users — see docs/data-security.md. Check the ownership of the data ` +
        `directory.`,
    );
  }
}

/**
 * Writes a file that is secret material, at {@link SECRET_FILE_MODE}, whether or not it existed.
 *
 * `writeFile`'s own `mode` applies only when it creates the file, so an existing path — a `.tmp`
 * left behind by a crash, a file from a version that predates issue 067 — keeps whatever mode it
 * had. Both of this repo's atomic writers rename their temp file *over* the real one, which makes
 * the temp file's mode the real file's mode, so getting this wrong re-opens the store without
 * anything looking broken.
 */
export async function writeSecretFile(target: string, data: string): Promise<void> {
  await fs.writeFile(target, data, { encoding: "utf8", mode: SECRET_FILE_MODE });
  await tighten(target, SECRET_FILE_MODE);
}
