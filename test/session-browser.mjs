import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A local identity service simulates token expiry/revocation; AutoShort's real auth handlers set cookies.
const sessions = new Map();
let serial = 0,
  refreshCount = 0;
function issue(session) {
  const id = ++serial;
  session.access = `device${id}.access.signature`;
  session.refresh = `fixture-refresh-${id}`;
  session.expired = false;
  sessions.set(session.access, session);
  return {
    user: { id: "shared-user", email: "same@example.test" },
    access_token: session.access,
    refresh_token: session.refresh,
    expires_in: 3600,
  };
}
const identity = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let body = "";
  for await (const part of req) body += part;
  const input = body ? JSON.parse(body) : {};
  const token = req.headers.authorization?.replace("Bearer ", "");
  const session = sessions.get(token);
  const send = (code, data) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };
  if (
    url.pathname === "/auth/v1/token" &&
    url.searchParams.get("grant_type") === "password"
  )
    return send(200, issue({ active: true }));
  if (
    url.pathname === "/auth/v1/token" &&
    url.searchParams.get("grant_type") === "refresh_token"
  ) {
    const current = [...sessions.values()].find(
      (s) => s.refresh === input.refresh_token && s.active,
    );
    if (!current) return send(400, { error_code: "refresh_token_not_found" });
    refreshCount++;
    return send(200, issue(current));
  }
  if (url.pathname === "/auth/v1/user")
    return session?.active && !session.expired
      ? send(200, { id: "shared-user", email: "same@example.test" })
      : send(401, { error_code: "bad_jwt" });
  if (url.pathname === "/auth/v1/logout") {
    if (url.searchParams.get("scope") !== "local")
      return send(400, { error_code: "wrong_logout_scope" });
    if (session) session.active = false;
    return send(200, {});
  }
  if (url.pathname.startsWith("/rest/v1/")) return send(200, []);
  return send(404, {});
});
await new Promise((resolve) => identity.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:3201";
const server = spawn(process.execPath, ["server.js"], {
  env: {
    ...process.env,
    PORT: "3201",
    NODE_ENV: "test",
    VERCEL: "",
    SUPABASE_URL: `http://127.0.0.1:${identity.address().port}`,
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
    SUPABASE_ANON_KEY: "fixture-anon-key",
    AUTH_SITE_URL: base,
    ADMIN_TOKEN: "",
    OWNER_USER_ID: "",
    VERCEL_DOMAINS_TOKEN: "",
    RESEND_API_KEY: "",
  },
  stdio: "pipe",
});
const profiles = await mkdtemp(join(tmpdir(), "autoshort-device-sessions-"));
const contexts = new Set();
const open = async (name) => {
  const context = await chromium.launchPersistentContext(join(profiles, name), {
    executablePath:
      process.env.CHROMIUM_PATH ||
      (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    headless: true,
    args: ["--no-sandbox"],
  });
  contexts.add(context);
  return context;
};
try {
  await new Promise((resolve, reject) => {
    server.stdout.once("data", resolve);
    server.once("error", reject);
    server.once("exit", (code) => reject(new Error("App exited: " + code)));
  });
  const login = async (context) => {
    const page = await context.newPage();
    await page.goto(base + "/#login");
    await page.waitForFunction(
      () => !document.getElementById("btnAuthSubmit").disabled,
    );
    await page.fill("#authEmailInput", "same@example.test");
    await page.fill("#authPasswordInput", "fixture-password");
    await page.click("#btnAuthSubmit");
    await page.locator("#viewHome").waitFor({ state: "visible" });
    return page;
  };
  let deviceA = await open("device-a");
  let pageA = await login(deviceA);
  const firstCookie = (await deviceA.cookies(base)).find(
    (c) => c.name === "as_refresh",
  );
  assert.ok(firstCookie.httpOnly);
  assert.ok(firstCookie.expires > Date.now() / 1000 + 399 * 86400);
  const deviceB = await open("device-b");
  const pageB = await login(deviceB);
  assert.notEqual(
    firstCookie.value,
    (await deviceB.cookies(base)).find((c) => c.name === "as_refresh").value,
  );
  await deviceA.close();
  contexts.delete(deviceA);
  deviceA = await open("device-a");
  pageA = await deviceA.newPage();
  await pageA.goto(base + "/#home");
  await pageA
    .locator("#cloudStatusText")
    .filter({ hasText: "Cloud Terhubung" })
    .waitFor();
  assert.equal(await pageA.locator("#viewHome").isVisible(), true);
  const access = (await deviceA.cookies(base)).find(
    (c) => c.name === "as_access",
  ).value;
  sessions.get(access).expired = true;
  await pageA.reload();
  await pageA
    .locator("#cloudStatusText")
    .filter({ hasText: "Cloud Terhubung" })
    .waitFor();
  assert.ok(refreshCount > 0);
  assert.notEqual(
    firstCookie.value,
    (await deviceA.cookies(base)).find((c) => c.name === "as_refresh").value,
  );
  await pageA.goto(base + "/#settings");
  await pageA.click("#btnLogoutAdmin");
  await pageA.locator("#viewAuth").waitFor({ state: "visible" });
  assert.equal(
    (await deviceA.cookies(base)).some((c) => c.name === "as_refresh"),
    false,
  );
  await pageB.reload();
  await pageB
    .locator("#cloudStatusText")
    .filter({ hasText: "Cloud Terhubung" })
    .waitFor();
  assert.equal(await pageB.locator("#viewHome").isVisible(), true);
  console.log(
    "PASS: real browser restart retains login, expired access refreshes automatically, and logout affects only one device. Identity responses are local test fixtures.",
  );
} finally {
  for (const context of contexts) await context.close();
  server.kill();
  await new Promise((resolve) => identity.close(resolve));
  await rm(profiles, { recursive: true, force: true });
}
