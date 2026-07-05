/**
 * One-off helper to obtain a YouTube OAuth refresh token.
 *
 * Prereqs (Google Cloud Console):
 *   1. OAuth client (Web application) with this Authorized redirect URI:
 *        http://localhost:53682/oauth2callback
 *   2. "YouTube Data API v3" enabled.
 *
 * Run:  node scripts/get-refresh-token.mjs
 * Reads YT_CLIENT_ID / YT_CLIENT_SECRET from .env, opens the consent URL, catches
 * the redirect on localhost, and prints YT_REFRESH_TOKEN for your .env.
 */
import http from "node:http";
import { google } from "googleapis";
import { config as loadEnv } from "dotenv";

loadEnv();

const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;
const SCOPES = ["https://www.googleapis.com/auth/youtube"];

const clientId = process.env.YT_CLIENT_ID;
const clientSecret = process.env.YT_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Missing YT_CLIENT_ID / YT_CLIENT_SECRET in .env");
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT);

const authUrl = oauth2.generateAuthUrl({
  access_type: "offline", // ask for a refresh token
  prompt: "consent", // force it even if previously granted
  scope: SCOPES,
});

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith("/oauth2callback")) {
    res.writeHead(404).end();
    return;
  }
  const code = new URL(req.url, REDIRECT).searchParams.get("code");
  if (!code) {
    res.writeHead(400).end("No code in callback.");
    return;
  }
  try {
    const { tokens } = await oauth2.getToken(code);
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Done. You can close this tab and return to the terminal.");
    console.log("\n=== Add this to your .env ===");
    console.log(`YT_REFRESH_TOKEN=${tokens.refresh_token ?? "(none returned — see note)"}`);
    if (!tokens.refresh_token) {
      console.log(
        "\nNo refresh_token returned. Revoke the app's access at " +
          "https://myaccount.google.com/permissions and run this again.",
      );
    }
  } catch (err) {
    res.writeHead(500).end("Token exchange failed. Check the terminal.");
    console.error(err);
  } finally {
    server.close();
  }
});

server.listen(PORT, () => {
  console.log("Open this URL in your browser (must be the channel's Google account):\n");
  console.log(authUrl + "\n");
});
