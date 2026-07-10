/**
 * The persisted-store schemas now live in `@app/shared` — the single API contract shared with
 * the web app (PRD-04 §2). This module re-exports them so the ~14 server import sites keep
 * working unchanged and the server validates against the exact schemas the UI's types derive
 * from. Add or change a schema in `@app/shared/src/schema.ts`, never here.
 */
export * from "@app/shared";
