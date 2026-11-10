/** Kiểm thử giao tiếp xác thực tài khoản, phiên đăng nhập, quy tắc mật khẩu và dữ liệu Google/Facebook đã được máy chủ xác minh. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import * as passwordPolicy from "../src/utils/passwordPolicy";
import { viI18n } from "./fixtures/i18nFixture";

type AuthModule = typeof import("../src/services/accountAuth");
const compiled = ts.transpileModule(
  readFileSync(resolve(__dirname, "../src/services/accountAuth.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
const now = Date.parse("2026-11-04T12:00:00.000Z");
const token = "a".repeat(43);
const password = "MyLongPassword1";
const user = { id: "30b1a942-14d6-42cd-9ce6-b7ce2e258fcb", email: "thai@example.com", username: "Thái Nguyên" };
const envelope = { user, session: { token, expiresAt: "2026-12-04T12:00:00.000Z" } };
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function setup(options: { development?: boolean; timeout?: boolean } = {}) {
  const api = {} as AuthModule;
  const stored = new Map<string, string>();
  const storageCalls: { action: string; key: string; options: unknown }[] = [];
  const storage = {
    async getItemAsync(key: string, storeOptions?: unknown) {
      storageCalls.push({ action: "read", key, options: storeOptions });
      return stored.get(key) ?? null;
    },
    async setItemAsync(key: string, value: string, storeOptions?: unknown) {
      storageCalls.push({ action: "save", key, options: storeOptions });
      stored.set(key, value);
    },
    async deleteItemAsync(key: string, storeOptions?: unknown) {
      storageCalls.push({ action: "delete", key, options: storeOptions });
      stored.delete(key);
    },
  };
  runInNewContext(compiled, {
    exports: api, __DEV__: options.development ?? true,
    process: { env: {} }, URL, AbortController, TextDecoder, fetch,
    setTimeout: options.timeout ? (run: () => void) => setTimeout(run, 1) : setTimeout,
    clearTimeout,
    require: (name: string) => {
      if (name === "expo-secure-store") return { ...storage, WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6 };
      if (name === "../utils/passwordPolicy") return passwordPolicy;
      if (name === "../i18n/core") return viI18n;
      throw new Error(`Unexpected import: ${name}`);
    },
  }, { filename: "accountAuth.native-mock.js" });
  const calls: { url: string; init: RequestInit }[] = [];
  let response: () => Promise<Response> = async () => json(envelope);
  const client = api.createAccountAuth({
    baseUrl: "http://192.168.1.2:3001/",
    secureStore: storage,
    now: () => now,
    fetch: async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return response();
    },
  });
  return {
    api, client, calls, storage, storageCalls,
    get saved() { return stored.get("pat.account.session.v1") ?? null; },
    set saved(value: string | null) {
      if (value === null) stored.delete("pat.account.session.v1");
      else stored.set("pat.account.session.v1", value);
    },
    get remembered() { return stored.get("pat.account.remembered-login.v1") ?? null; },
    set remembered(value: string | null) {
      if (value === null) stored.delete("pat.account.remembered-login.v1");
      else stored.set("pat.account.remembered-login.v1", value);
    },
    get rememberedPassword() { return stored.get("pat.account.remembered-password.v1") ?? null; },
    set rememberedPassword(value: string | null) {
      if (value === null) stored.delete("pat.account.remembered-password.v1");
      else stored.set("pat.account.remembered-password.v1", value);
    },
    respond(body: unknown, status = 200) { response = async () => json(body, status); },
    response(run: () => Promise<Response>) { response = run; },
  };
}

test("login uses its exact route, normalizes email, preserves password and never automatically saves", async () => {
  const auth = setup();
  const result = await auth.client.login(" THAI@example.com ", password, true);
  assert.deepEqual(plain(result), envelope);
  assert.equal(auth.calls[0].url, "http://192.168.1.2:3001/api/auth/login");
  assert.deepEqual(JSON.parse(auth.calls[0].init.body as string), { email: user.email, password, rememberMe: true });
  assert.equal(auth.calls[0].init.credentials, "omit");
  assert.equal(auth.calls[0].init.redirect, "error");
  assert.equal((auth.calls[0].init.headers as Record<string, string>).Authorization, undefined);
  assert.equal(auth.saved, null);
});

test("register validates and sends one human username and a nonremembered session", async () => {
  const auth = setup();
  await auth.client.register(" Thái Nguyên ", user.email, password);
  assert.equal(auth.calls[0].url.endsWith("/api/auth/register"), true);
  assert.deepEqual(JSON.parse(auth.calls[0].init.body as string), {
    username: user.username, email: user.email, password, rememberMe: false,
  });
  for (const run of [
    () => auth.client.register("a", user.email, password),
    () => auth.client.register(user.username, "not-an-email", password),
    () => auth.client.register(user.username, user.email, "short"),
    () => auth.client.login(user.email, "", false),
    () => auth.client.login(user.email, "a".repeat(129), false),
  ]) await assert.rejects(run(), { code: "INVALID_INPUT" });
  assert.equal(auth.calls.length, 1);
});

test("social routes send proof only and preserve server-verified account metadata", async () => {
  const auth = setup();
  auth.respond({ providers: { google: true, facebook: false } });
  assert.deepEqual(plain(await auth.client.socialProviders()), { google: true, facebook: false });
  const challenge = { challengeId: "c".repeat(43), nonce: "n".repeat(43), expiresAt: envelope.session.expiresAt };
  auth.respond(challenge);
  assert.deepEqual(plain(await auth.client.socialChallenge("link", token)), challenge);
  assert.equal((auth.calls[1].init.headers as Record<string, string>).Authorization, `Bearer ${token}`);
  const socialUser = { ...user, hasPassword: false, providers: ["google"] };
  auth.respond({ ...envelope, user: socialUser });
  assert.deepEqual(plain((await auth.client.socialLogin({ provider: "google", tokenType: "id_token", token: "signed-proof" }, true)).user), socialUser);
  assert.deepEqual(JSON.parse(auth.calls[2].init.body as string), { provider: "google", tokenType: "id_token", token: "signed-proof", rememberMe: true });
  assert.equal(auth.saved, null);
  auth.respond({ user: socialUser });
  assert.deepEqual(plain(await auth.client.linkSocial(token, { provider: "google", tokenType: "id_token", token: "signed-proof" })), socialUser);
  assert.equal(auth.calls[3].url.endsWith("/api/auth/social/link"), true);
});

test("social client rejects malformed metadata/challenges and does not leak provider errors", async () => {
  const auth = setup();
  auth.respond({ ...envelope, user: { ...user, providers: ["unknown"] } });
  await assert.rejects(auth.client.socialLogin({ provider: "google", tokenType: "id_token", token: "proof" }, false), { code: "INVALID_RESPONSE" });
  auth.respond({ challengeId: "bad", nonce: "bad", expiresAt: "2099-01-01" });
  await assert.rejects(auth.client.socialChallenge("login"), { code: "INVALID_RESPONSE" });
  auth.respond({ error: { code: "SOCIAL_LINK_REQUIRED", message: "secret external data" } }, 409);
  await assert.rejects(auth.client.socialLogin({ provider: "google", tokenType: "id_token", token: "proof" }, false), error => typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" && !error.message.includes("secret") && error.message.includes("liên kết"));
});

test("all new-password routes enforce the two ASCII rules and 7/8 boundary while legacy login stays valid", async () => {
  const auth = setup();
  for (const invalidPassword of ["abcdef1", "abcdefgh ", "Đatmk1234", "Abcdefg!", "Abcdefg1\n", "Abcdefg1\r\n", "x".repeat(129)]) {
    for (const attempt of [
      () => auth.client.register(user.username, user.email, invalidPassword),
      () => auth.client.changePassword(token, "old", invalidPassword),
      () => auth.client.resetPassword(token, invalidPassword),
    ]) await assert.rejects(attempt(), { code: "INVALID_INPUT", message: passwordPolicy.PASSWORD_REQUIREMENTS });
  }
  assert.equal(auth.calls.length, 0);
  await auth.client.register(user.username, user.email, "abcdefgh");
  await auth.client.changePassword(token, " old ", "ABCDEFGH");
  auth.respond({ ok: true });
  await auth.client.resetPassword(token, "12345678");
  auth.respond(envelope);
  await auth.client.login(user.email, " old ", false);
  assert.equal(auth.calls.length, 4);
});

test("authenticated methods use only selected endpoints and bearer tokens", async () => {
  const auth = setup();
  auth.respond({ user });
  assert.deepEqual(plain(await auth.client.me(token)), user);
  assert.deepEqual(plain(await auth.client.updateProfile(token, " Thái Nguyên ")), user);
  auth.respond(envelope);
  await auth.client.changePassword(token, " old password ", password);
  auth.respond({ ok: true });
  await auth.client.logout(token);
  assert.deepEqual(auth.calls.map((call) => [call.url.split("/").at(-1), call.init.method]), [
    ["me", "GET"], ["profile", "PATCH"], ["password", "POST"], ["logout", "POST"],
  ]);
  for (const call of auth.calls)
    assert.equal((call.init.headers as Record<string, string>).Authorization, `Bearer ${token}`);
  assert.equal(auth.calls[0].init.body, undefined);
  assert.deepEqual(JSON.parse(auth.calls[2].init.body as string), { currentPassword: " old password ", newPassword: password });
  await assert.rejects(auth.client.me("bad\r\nheader"), { code: "INVALID_SESSION" });
  assert.equal(auth.calls.length, 4);
});

test("password recovery uses public routes without a session or secure-storage writes", async () => {
  const auth = setup();
  auth.respond({ ok: true, message: "generic acknowledgement" });
  await auth.client.requestPasswordReset(" THAI@example.com ");
  await auth.client.resetPassword(` ${token}\n`, password);
  assert.deepEqual(auth.calls.map((call) => [call.url.split("/").at(-1), call.init.method]), [
    ["forgot-password", "POST"], ["reset-password", "POST"],
  ]);
  assert.deepEqual(JSON.parse(auth.calls[0].init.body as string), { email: user.email });
  assert.deepEqual(JSON.parse(auth.calls[1].init.body as string), { token, newPassword: password });
  for (const call of auth.calls)
    assert.equal((call.init.headers as Record<string, string>).Authorization, undefined);
  assert.deepEqual(auth.storageCalls, []);
  assert.equal(auth.saved, null);
});

test("password recovery validates email, strong token and password before making requests", async () => {
  const auth = setup();
  await assert.rejects(auth.client.requestPasswordReset("not-email"), { code: "INVALID_INPUT" });
  for (const invalidToken of ["123456", "a".repeat(42), `${token}/`, "a".repeat(44)])
    await assert.rejects(auth.client.resetPassword(invalidToken, password), { code: "RESET_TOKEN_INVALID" });
  for (const invalidPassword of ["short", "x".repeat(129)])
    await assert.rejects(auth.client.resetPassword(token, invalidPassword), { code: "INVALID_INPUT" });
  assert.equal(auth.calls.length, 0);
});

test("password recovery surfaces safe configuration, expiry and cooldown failures", async () => {
  const auth = setup();
  for (const [code, status] of [["RESET_NOT_CONFIGURED", 503], ["RESET_TOKEN_INVALID", 400], ["RESET_RATE_LIMITED", 429]] as const) {
    auth.respond({ error: { code, message: "private smtp credentials and reset code" } }, status);
    await assert.rejects(auth.client.resetPassword(token, password), (cause: unknown) => {
      const error = cause as InstanceType<AuthModule["AccountAuthError"]>;
      assert.equal(error.code, code);
      assert.equal(error.status, status);
      assert.equal(error.message.includes("private"), false);
      return true;
    });
  }
  auth.respond(envelope);
  await assert.rejects(auth.client.requestPasswordReset(user.email), { code: "INVALID_RESPONSE" });
  await assert.rejects(auth.client.resetPassword(token, password), { code: "INVALID_RESPONSE" });
  assert.deepEqual(auth.storageCalls, []);
});

test("malformed, expired or incomplete successes never become authenticated sessions", async () => {
  const auth = setup();
  for (const body of [
    {}, { user }, { ...envelope, session: { token, expiresAt: "2026-11-04T12:00:00Z" } },
    { ...envelope, session: { token: "fake", expiresAt: envelope.session.expiresAt } },
    { ...envelope, user: { ...user, id: "bad/user" } },
    { ...envelope, user: { ...user, email: "bad" } },
    { ...envelope, user: { ...user, username: "a" } },
  ]) {
    auth.respond(body);
    await assert.rejects(auth.client.login(user.email, password, false), { code: "INVALID_RESPONSE" });
  }
  assert.equal(auth.saved, null);
});

test("unknown response fields and secrets are discarded before secure persistence", async () => {
  const auth = setup();
  auth.respond({ ...envelope, password: "must-not-save", user: { ...user, passwordHash: "must-not-save" } });
  const signedIn = await auth.client.login(user.email, password, true);
  await auth.client.saveSession(signedIn);
  assert.deepEqual(JSON.parse(auth.saved!), envelope);
  assert.equal(auth.saved!.includes("must-not-save"), false);
  assert.equal(auth.storageCalls[0].key, "pat.account.session.v1");
  assert.deepEqual(plain(auth.storageCalls[0].options), { keychainAccessible: 6 });
  assert.deepEqual(plain(await auth.client.loadSession()), envelope);
  await auth.client.saveSession(null);
  assert.equal(auth.saved, null);
});

test("expired or corrupted secure sessions are cleared, never silently trusted", async () => {
  const auth = setup();
  for (const saved of ["not-json", "x".repeat(20_000), JSON.stringify({ ...envelope, session: { token, expiresAt: "2025-01-01" } })]) {
    auth.saved = saved;
    assert.equal(await auth.client.loadSession(), null);
    assert.equal(auth.saved, null);
  }
  assert.equal(auth.storageCalls.filter((call) => call.action === "delete").length, 3);
});

test("remembered login keeps opt-in email separate from its encrypted device-only password and session", async () => {
  const auth = setup();
  await auth.client.saveSession(envelope);
  await auth.client.saveRememberedLogin(" THAI@example.com ", password);
  assert.deepEqual(JSON.parse(auth.remembered!), { email: user.email });
  assert.deepEqual(JSON.parse(auth.rememberedPassword!), { email: user.email, password });
  assert.deepEqual(plain(await auth.client.loadRememberedLogin()), { email: user.email, password });
  assert.deepEqual(plain(auth.storageCalls.at(-1)?.options), { keychainAccessible: 6 });
  await auth.client.saveSession(null);
  assert.equal(auth.saved, null);
  assert.equal(JSON.parse(auth.remembered!).email, user.email, "logout retains the opted-in device login, not its session");
  assert.deepEqual(plain(await auth.client.loadRememberedLogin()), { email: user.email, password });
  assert.ok(auth.storageCalls.filter(call => call.action === "save").every(call =>
    JSON.stringify(call.options) === JSON.stringify({ keychainAccessible: 6 })));
  await auth.client.saveRememberedLogin(null);
  assert.equal(auth.remembered, null);
  assert.equal(auth.rememberedPassword, null);
  await auth.client.saveRememberedLogin("");
  assert.deepEqual(plain(await auth.client.loadRememberedLogin()), { email: "" }, "opt-in can precede the first successful login");
  await assert.rejects(auth.client.saveRememberedLogin("bad-email"), { code: "INVALID_INPUT" });
});

test("malformed remembered suggestions are cleared and extra fields never become login credentials", async () => {
  const auth = setup();
  for (const value of ["not-json", "x".repeat(1000), JSON.stringify({ email: "bad" }), JSON.stringify({ password: "never-use" })]) {
    auth.remembered = value;
    await assert.rejects(auth.client.loadRememberedLogin(), { code: "STORAGE" });
    assert.equal(auth.remembered, null);
  }
  auth.remembered = JSON.stringify({ email: user.email, password: "must-not-use", token });
  assert.deepEqual(plain(await auth.client.loadRememberedLogin()), { email: user.email });
  assert.equal(auth.saved, null);
});

test("legacy email-only records never invent a password; a matching credential is preserved only for the same email", async () => {
  const auth = setup();
  auth.remembered = JSON.stringify({ email: user.email });
  assert.deepEqual(plain(await auth.client.loadRememberedLogin()), { email: user.email });
  await auth.client.saveRememberedLogin(user.email, password);
  await auth.client.saveRememberedLogin(user.email);
  assert.deepEqual(plain(await auth.client.loadRememberedLogin()), { email: user.email, password });
  await auth.client.saveRememberedLogin("other@example.com");
  assert.deepEqual(plain(await auth.client.loadRememberedLogin()), { email: "other@example.com" });
  assert.equal(auth.rememberedPassword, null);
  await auth.client.saveRememberedLogin(user.email, password);
  await auth.client.saveRememberedLogin(user.email, null);
  assert.deepEqual(plain(await auth.client.loadRememberedLogin()), { email: user.email });
  assert.equal(auth.rememberedPassword, null, "social/reset can explicitly clear a local password");
});

test("malformed, orphaned or mismatched saved passwords fail closed with a visible sanitized error", async () => {
  const auth = setup();
  for (const credential of ["not-json", "x".repeat(2100), JSON.stringify({ email: "other@example.com", password }),
    JSON.stringify({ email: user.email, password: "" }), JSON.stringify({ email: user.email, password: 123 })]) {
    auth.remembered = JSON.stringify({ email: user.email });
    auth.rememberedPassword = credential;
    await assert.rejects(auth.client.loadRememberedLogin(), { code: "STORAGE" });
    assert.equal(auth.remembered, null);
    assert.equal(auth.rememberedPassword, null);
  }
  auth.rememberedPassword = JSON.stringify({ email: user.email, password });
  await assert.rejects(auth.client.loadRememberedLogin(), { code: "STORAGE" });
  assert.equal(auth.rememberedPassword, null);
});

test("a partial secure password write is cleaned up and never falls back to an old credential", async () => {
  const auth = setup();
  await auth.client.saveRememberedLogin(user.email, password);
  const client = auth.api.createAccountAuth({ baseUrl: "https://pat.example", now: () => now, secureStore: {
    ...auth.storage,
    async setItemAsync(key, value, options) {
      if (key === "pat.account.remembered-login.v1") throw new Error("private storage details");
      await auth.storage.setItemAsync(key, value, options);
    },
  } });
  await assert.rejects(client.saveRememberedLogin("other@example.com", "NewPassword2"), { code: "STORAGE" });
  assert.equal(auth.remembered, null);
  assert.equal(auth.rememberedPassword, null);
  assert.equal(await auth.client.loadRememberedLogin(), null);
});

test("secure storage failures remain visible and do not fall back to ordinary storage", async () => {
  const auth = setup();
  const fail = async () => { throw new Error("native secret details"); };
  const client = auth.api.createAccountAuth({ baseUrl: "https://pat.example", now: () => now,
    secureStore: { getItemAsync: fail, setItemAsync: fail, deleteItemAsync: fail } });
  await assert.rejects(client.loadSession(), { code: "STORAGE" });
  await assert.rejects(client.saveSession(envelope), { code: "STORAGE" });
  await assert.rejects(client.saveSession(null), { code: "STORAGE" });
  await assert.rejects(client.loadRememberedLogin(), { code: "STORAGE" });
  await assert.rejects(client.saveRememberedLogin(user.email), { code: "STORAGE" });
  await assert.rejects(client.saveRememberedLogin(null), { code: "STORAGE" });
});

test("release refuses HTTP even when an insecure-development override was supplied", async () => {
  const auth = setup({ development: false });
  const client = auth.api.createAccountAuth({ baseUrl: "http://192.168.1.2:3001", allowInsecureDevelopment: true });
  await assert.rejects(client.login(user.email, password, false), { code: "HTTPS_REQUIRED" });
});

test("base URLs reject embedded credentials, query, fragments, extra paths and non-LAN HTTP", async () => {
  const auth = setup();
  for (const baseUrl of [
    "https://user:password@pat.example", "https://pat.example?token=secret", "https://pat.example#secret",
    "https://pat.example/api/another-path", "file:///tmp/login", "http://public.example", "http://8.8.8.8",
  ]) {
    let calls = 0;
    const client = auth.api.createAccountAuth({ baseUrl, allowInsecureDevelopment: true,
      fetch: async () => { calls++; return json(envelope); } });
    await assert.rejects(client.login(user.email, password, false));
    assert.equal(calls, 0);
  }
  await assert.rejects(auth.api.accountAuth.login(user.email, password, false), { code: "NOT_CONFIGURED" });
});

test("known backend failures use safe messages instead of echoing backend text", async () => {
  const auth = setup();
  auth.respond({ error: { code: "CURRENT_PASSWORD_INCORRECT", message: "secret backend stack" } }, 400);
  await assert.rejects(auth.client.changePassword(token, password, "AnotherLongPassword1"),
    (error: unknown) => {
      const failure = error as InstanceType<AuthModule["AccountAuthError"]>;
      assert.equal(failure.code, "CURRENT_PASSWORD_INCORRECT");
      assert.equal(failure.status, 400);
      assert.equal(failure.message.includes("secret"), false);
      return true;
    });
  auth.respond({ error: { code: "SQL_PASSWORD_DETAILS", message: "database connection password" } }, 503);
  await assert.rejects(auth.client.login(user.email, password, false), { code: "AUTH_UNAVAILABLE", status: 503 });
});

test("broken and oversized server payloads fail safely", async () => {
  const auth = setup();
  for (const response of [
    () => Promise.resolve(new Response("not-json")),
    () => Promise.resolve(new Response("x".repeat(20_000))),
    () => Promise.resolve(new Response("{}", { headers: { "content-length": "999999" } })),
  ]) {
    auth.response(response);
    await assert.rejects(auth.client.login(user.email, password, false), { code: "INVALID_RESPONSE" });
  }
});

test("timeout aborts and settles even when fetch ignores cancellation", async () => {
  const auth = setup({ timeout: true });
  auth.response(() => new Promise<Response>(() => undefined));
  await assert.rejects(auth.client.login(user.email, password, false), { code: "TIMEOUT" });
  assert.equal(auth.calls[0].init.signal?.aborted, true);
});

test("network errors are sanitized and never converted to a demo session", async () => {
  const auth = setup();
  auth.response(async () => { throw new Error("url with private credentials"); });
  await assert.rejects(auth.client.login(user.email, password, false), { code: "NETWORK" });
  assert.equal(auth.saved, null);
});
