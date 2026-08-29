# PRD-17 — Android app

Source: the grilling session of 2026-08-29. A short note, not a full PRD: this is a client for what
[PRD-15](prd-15-hosted-auth-and-accounts.md) establishes, and it should not start until that is real.

## Problem Statement

Reaching the dashboard on a phone is annoying enough that people avoid it mid-show: find a browser,
find the tab, type an address, work around browser chrome. The tap-to-fill notification makes it
worse rather than better — tapping opens **a new browser tab every time**, so the phone accumulates
a pile of them.

The obvious cheap answer — make the dashboard installable to the home screen — was considered and
rejected by the operator on experience: on several of the phones in use, installing a web page to
the home screen either is not offered or does not work properly, and web notifications still land
in a new tab. So the cheap path does not actually solve the stated problem.

## Solution

A small Android app that wraps the same API the web dashboard uses.

- **Sign in once.** The app holds a long-lived token in the OS secure store and sends it as a
  header — the same credential model as PRD-15 §2, issued by the app, not by Cloudflare. This is a
  large part of why authentication has to live in the app rather than at the edge.
- **Push notifications replace the current ntfy path**, and the deep link stops needing to carry any
  proof of its own: the notification says "open preset X", and the app authenticates normally
  because it is already signed in. The short-lived signed link considered during planning is
  therefore **not needed** once this ships.
- **Distribution is direct.** Android needs no store — build the file and install it. Over-the-air
  updates mean most later changes reach the phone without a reinstall, which preserves the
  "just push and it's there" property that motivated hosting in the first place.

## Constraints and non-goals

- **One user, for now.** Of four devices, exactly one is an app user; the rest are browsers
  (Android browser, iPhone browser, laptop browser). Scope the effort accordingly — this is a
  convenience client, not a second product, and every feature it gains must already exist in the API.
- **No iOS.** The single iPhone user stays on the browser. iOS would mean a paid developer account
  and either store review or reinstalling the app every 90 days, for one person who has said the
  browser is fine.
- **The iPhone user therefore gets no push notifications**, and possibly none at all. So: **no step
  in the show may depend on a notification arriving.** The dashboard popup remains the path that
  always works, for everyone.
- **Do not retire the existing notification path on day one.** Push delivery fails quietly — stale
  tokens, offline phones, service hiccups. Run app push alongside the current path for several real
  shows before removing anything. Losing the fill flow mid-show is exactly the failure this is
  meant to prevent.

## Dependencies

- **PRD-15 must ship first.** Without app-issued tokens there is nothing for the app to sign in
  with, and building against a Cloudflare-only gate would mean rebuilding the login later.
- The API must be stable enough to have a second client. See PRD-15 §Further Notes on keeping older
  clients working once the server updates on every push.

## Out of Scope

- iOS.
- Any feature that does not already exist in the web dashboard.
- Replacing the dashboard popup as the reliable fill path.
