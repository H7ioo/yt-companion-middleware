import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { nanoid } from "nanoid";
import type { JsonStore } from "../storage/jsonStore.js";
import type { Account, Invite } from "../storage/schema.js";
import { MIN_PASSWORD_LENGTH } from "./accounts.js";
import { hashPassword } from "./passwords.js";
import { AppError } from "../core/errors.js";

/**
 * Invites: how the other two people get in (PRD-15 §2, issue 046).
 *
 * **No email infrastructure, deliberately.** The deployment has no mail server and should not
 * grow one, so nothing here sends anything. An admin creates an invite, copies the link, and
 * hands it over on whatever channel they already use to talk to that person. Password reset is
 * the same act — a fresh invite — rather than a recovery flow with no delivery path.
 *
 * Two properties do the security work, and both are enforced in the store's serialized update
 * rather than in a check beside it:
 *
 * - **Single use.** Redemption stamps `redeemedAt`, and a stamped invite is refused. Checking
 *   outside the update would let two redemptions of one link both see it open and both create an
 *   account — which is exactly the "nobody shares a login" property the invite exists to give.
 * - **Expiring.** A day is plenty for "here is your link, set a password". A link that stays
 *   good forever is a password that was pasted into a chat log.
 *
 * The token is 32 random bytes and only its SHA-256 hash is stored, for the same reason as a
 * session token: `store.json` should hand an attacker nothing usable.
 */

/** How long a new invite stays good. A day is plenty for "here is your link, set a password". */
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/** Constant-time comparison, so invite lookup does not leak a token by timing. */
function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Why an invite cannot be used, phrased for the person holding the link. */
function refusal(reason: "unknown" | "expired" | "redeemed"): AppError {
  const message =
    reason === "expired"
      ? "This invite has expired. Ask an admin for a new link."
      : reason === "redeemed"
        ? "This invite has already been used. Ask an admin for a new link."
        : "This invite link is not valid. Ask an admin for a new one.";
  return new AppError("INVITE_INVALID", message);
}

/** Whether an invite is still usable at a given moment. */
export function inviteState(invite: Invite, at: number): "open" | "expired" | "redeemed" {
  if (invite.redeemedAt) return "redeemed";
  if (at >= Date.parse(invite.expiresAt)) return "expired";
  return "open";
}

export class Invites {
  private readonly store: JsonStore;
  private readonly now: () => number;

  constructor(store: JsonStore, now: () => number = Date.now) {
    this.store = store;
    this.now = now;
  }

  /**
   * Creates an invite for a role. The returned token is the only time the plaintext exists — it
   * goes into the link the admin copies and is never recoverable afterwards, so losing it means
   * making another invite rather than looking the old one up.
   */
  async create(options: { role: Account["role"]; createdBy: string; ttlMs?: number }): Promise<{
    token: string;
    invite: Invite;
  }> {
    const token = randomBytes(32).toString("base64url");
    const at = this.now();
    const invite: Invite = {
      id: nanoid(),
      tokenHash: hashToken(token),
      role: options.role,
      createdBy: options.createdBy,
      createdAt: new Date(at).toISOString(),
      expiresAt: new Date(at + (options.ttlMs ?? INVITE_TTL_MS)).toISOString(),
      redeemedAt: null,
      redeemedBy: null,
    };
    await this.store.update((s) => {
      // Sweep on the way past, so the list an admin reads is the one that still matters: an
      // invite that expired unredeemed is noise nothing will ever clean up otherwise. Redeemed
      // ones stay — they are the record of who let whom in until issue 050's audit log lands.
      s.invites = [...s.invites.filter((i) => this.worthKeeping(i, at)), invite];
    });
    return { token, invite };
  }

  /** Every invite this deployment has a record of, newest last. */
  list(): Invite[] {
    return this.store.get().invites;
  }

  /**
   * Looks an invite up by its token without spending it, so the redemption page can say "this
   * link has expired" on arrival rather than after someone has typed a password twice. Throws the
   * same refusal the redeem call would.
   */
  inspect(token: string | undefined): Invite {
    const invite = token
      ? this.store.get().invites.find((i) => hashesMatch(i.tokenHash, hashToken(token)))
      : undefined;
    if (!invite) throw refusal("unknown");
    const state = inviteState(invite, this.now());
    if (state !== "open") throw refusal(state);
    return invite;
  }

  /** Withdraws an unredeemed invite — the link stops working from the next request. */
  async cancel(inviteId: string): Promise<void> {
    await this.store.update((s) => {
      const invite = s.invites.find((i) => i.id === inviteId);
      if (!invite) throw new AppError("INVALID_REQUEST", "No such invite.");
      if (invite.redeemedAt) {
        throw new AppError(
          "INVALID_REQUEST",
          "That invite has already been used — remove the account instead.",
        );
      }
      s.invites = s.invites.filter((i) => i.id !== inviteId);
    });
  }

  /**
   * Spends an invite and creates the account it was for. The invitee picks their own name and
   * password; the **role comes from the invite**, never from the request — otherwise the link an
   * admin sent to a camera operator would be a way to ask for admin.
   *
   * The invite check, the duplicate-name check, the stamp and the account all land in one
   * serialized update. Split across two, a link opened twice at once redeems twice, and the
   * password is hashed before the update for the same reason {@link createAccount} does it that
   * way: scrypt takes ~100ms, and holding the store's write lock for it would serialize the
   * whole server behind one person choosing a password.
   */
  async redeem(
    token: string | undefined,
    person: { name: string; password: string },
  ): Promise<Account> {
    // Validated before hashing, so an already-spent link is refused in microseconds rather than
    // after a scrypt run — and so the caller's own mistakes come back in the order they made them.
    this.inspect(token);
    const name = person.name.trim();
    if (!name) throw new AppError("INVALID_REQUEST", "Choose a username.");
    if (person.password.length < MIN_PASSWORD_LENGTH) {
      throw new AppError(
        "INVALID_REQUEST",
        `A password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      );
    }
    if (this.store.get().accounts.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
      throw new AppError("INVALID_REQUEST", `Someone here is already called "${name}".`);
    }

    const passwordHash = await hashPassword(person.password);
    const at = this.now();
    const wanted = hashToken(token!);
    let account!: Account;
    await this.store.update((s) => {
      // Re-read and re-check inside the update: everything above raced with whatever else was in
      // flight, and only this block sees the store nothing can change underneath it.
      const invite = s.invites.find((i) => hashesMatch(i.tokenHash, wanted));
      if (!invite) throw refusal("unknown");
      const state = inviteState(invite, at);
      if (state !== "open") throw refusal(state);
      if (s.accounts.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
        throw new AppError("INVALID_REQUEST", `Someone here is already called "${name}".`);
      }
      account = {
        id: nanoid(),
        name,
        passwordHash,
        role: invite.role,
        createdAt: new Date(at).toISOString(),
        seeded: false,
      };
      invite.redeemedAt = new Date(at).toISOString();
      invite.redeemedBy = account.id;
      s.accounts = [...s.accounts, account];
    });
    return account;
  }

  /** Expired-and-unredeemed invites are swept; open and redeemed ones are kept. */
  private worthKeeping(invite: Invite, at: number): boolean {
    return inviteState(invite, at) !== "expired";
  }
}
