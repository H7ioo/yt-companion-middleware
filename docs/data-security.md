# Protecting the data directory

The data directory (`./data` in Docker, `%APPDATA%/YT Companion/data` on Windows) holds
`store.json` and `audit.log`. **`store.json` contains your YouTube refresh token in plaintext.**

This page is the threat model that goes with that, and what to do when it is wrong.

## The threat model, stated plainly

**Whoever can read the data volume, or a backup of it, owns the channel.** The refresh token in
`store.json` is a long-lived credential: it can be exchanged for access to your YouTube channel
from anywhere, by anyone holding it, without your password and without your second factor. It is
not password-protected and it is not encrypted.

That is a deliberate choice, not an oversight. Encrypting the file needs a key, and on a single
host the key has to come from somewhere:

- **A key file on the same disk** protects nothing — an attacker who can read `store.json` can read
  the key beside it.
- **A key from a secret manager** needs a secret manager this deployment does not have.
- **A key typed by a human at boot** breaks unattended recovery: the server would sit waiting for
  someone at a keyboard, and it will restart on show night.

So the file stays plaintext and is protected by the filesystem instead. Everything below is what
makes that defensible.

## What the server does on its own

Nothing to configure — the server enforces this at every boot, and repairs a directory left loose
by an older version:

| Path | Mode | Why |
| --- | --- | --- |
| the data directory | `0700` | Only the service user may enter it. Not `0600`: a directory needs its execute bit to be traversed at all, and `0600` would lock the server out of its own store. |
| `store.json` | `0600` | Only the service user may read it. |
| `audit.log` | `0600` | It names people and what they did. |

Credential values are also scrubbed out of the activity feed, the audit log, and any error message
that reaches a browser — so a screenshot or a pasted error cannot leak what the file protects.

**Run the server as its own user.** The modes above are only worth something if the account that
owns them is not shared. Do not run it as a login account you also use for anything else.

**Docker.** `docker-compose.yml` bind-mounts `./data` into the container, so the `0700` lands on the
host directory too — expect `./data` to stop being readable by your ordinary login user after the
first boot. That is the point. If you run the container as a user that does not own that directory,
the server logs a `could not set permissions` warning and starts anyway rather than refusing to
boot; the file is then only as protected as the mount you gave it, so fix the ownership.

## Backups and snapshots are secret too

A backup of the data volume is a copy of the refresh token. A VPS snapshot is a copy of the whole
disk, including it.

Wherever this deployment is backed up, the destination must be **either encrypted or excluded**:

- **Encrypted** — the backup tool encrypts client-side before upload (restic, borg, or the
  provider's own at-rest encryption *plus* an access-controlled bucket).
- **Excluded** — the data directory is left out of the backup set entirely. Reasonable here: the
  only thing that cannot be recreated is the presets, and the token can be re-minted by
  reconnecting in a couple of minutes.

Provider snapshots deserve the same decision. If the hosting account can restore a snapshot, then
whoever can sign into the hosting account can read the token — so that account needs the second
factor even if the server itself is locked down.

## If the host is compromised

Suspected compromise of the host means **assume the refresh token is gone**. Three steps, in this
order:

1. **Revoke the token at Google.** Sign in as the channel's account, open
   [myaccount.google.com/permissions](https://myaccount.google.com/permissions), find this app, and
   remove its access. This is the step that actually stops the attacker — it invalidates the token
   wherever it has been copied to. Do it first, before touching the server.
2. **Rotate the OAuth client secret.** Google Cloud Console → *APIs & Services* → *Credentials* →
   the OAuth client → add a new secret and delete the old one. Step 1 kills the token; this kills
   the client that could mint another.
3. **Reconnect.** With the host rebuilt or cleaned, connect the channel again from the dashboard's
   setup screen (or re-run `node packages/server/scripts/get-refresh-token.mjs` for a headless
   deployment) using the new secret.

Then check `audit.log` for what was done while the host was open — it records sign-ins, role
changes, device tokens and credential changes, and it is the only record that survives a restart.
