/** Kiểm thử đăng nhập Google/Facebook gốc, chọn lại tài khoản và bằng chứng xác thực đúng theo nền tảng. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

type Module = typeof import("../src/services/socialLogin");
class AuthError extends Error { constructor(public code: string, message: string) { super(message); } }
const compiled = ts.transpileModule(readFileSync(new URL("../src/services/socialLogin.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup(platform = "android") {
  const api = {} as Module;
  const calls: { method: string; args: unknown[] }[] = [];
  let googleResult: unknown = { type: "success", data: { idToken: "google-signed-proof" } };
  let facebookResult = { isCancelled: false };
  let facebookAccessProof = "access-proof";
  let googleLoads = 0;
  let facebookLoads = 0;
  let signOutGate: Promise<void> = Promise.resolve();
  const google = {
    GoogleSignin: {
      configure: (...args: unknown[]) => { calls.push({ method: "configure", args }); },
      hasPlayServices: async (...args: unknown[]) => { calls.push({ method: "playServices", args }); },
      signOut: async () => { calls.push({ method: "googleLogout", args: [] }); await signOutGate; return null; },
      signIn: async () => { calls.push({ method: "google", args: [] }); return googleResult; },
    },
    isErrorWithCode: (error: unknown) => typeof error === "object" && error !== null && "code" in error,
    statusCodes: { SIGN_IN_CANCELLED: "cancelled", IN_PROGRESS: "in-progress", PLAY_SERVICES_NOT_AVAILABLE: "play-services" },
  };
  const facebook = {
    Settings: { initializeSDK() { calls.push({ method: "initialize", args: [] }); } },
    LoginManager: {
      logOut() { calls.push({ method: "logout", args: [] }); },
      setLoginBehavior(...args: unknown[]) { calls.push({ method: "behavior", args }); },
      async logInWithPermissions(...args: unknown[]) { calls.push({ method: "facebook", args }); return facebookResult; },
    },
    AuthenticationToken: { async getAuthenticationTokenIOS() { return { authenticationToken: "limited-proof" }; } },
    AccessToken: { async getCurrentAccessToken() { return { accessToken: facebookAccessProof }; } },
  };
  runInNewContext(compiled, {
    exports: api, process: { env: {} },
    require: (id: string) => {
      if (id === "react-native") return { Platform: { OS: platform } };
      if (id === "./accountAuth") return { AccountAuthError: AuthError };
      throw new Error(`Native SDK loaded before a tap: ${id}`);
    },
  });
  const dependencies = {
    platform, webClientId: "web.apps.googleusercontent.com", iosClientId: "ios.apps.googleusercontent.com",
    loadGoogle: async () => { googleLoads++; return google as unknown as Awaited<ReturnType<Parameters<Module["createSocialLogin"]>[0]["loadGoogle"]>>; },
    loadFacebook: async () => { facebookLoads++; return facebook as unknown as Awaited<ReturnType<Parameters<Module["createSocialLogin"]>[0]["loadFacebook"]>>; },
  };
  return { api, calls, dependencies,
    get loads() { return { google: googleLoads, facebook: facebookLoads }; },
    googleResult(value: unknown) { googleResult = value; },
    googleSignOutGate(value: Promise<void>) { signOutGate = value; },
    cancelFacebook() { facebookResult = { isCancelled: true }; },
    facebookProof(value: string) { facebookResult = { isCancelled: false }; facebookAccessProof = value; },
  };
}
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const challenge = { challengeId: "c".repeat(43), nonce: "n".repeat(43), expiresAt: "2099-01-01T00:00:00Z" };

test("native SDKs are lazy and Google returns ID proof without client profile claims", async () => {
  const env = setup();
  assert.deepEqual(env.loads, { google: 0, facebook: 0 });
  const login = env.api.createSocialLogin(env.dependencies);
  assert.deepEqual(plain(await login("google")), { provider: "google", tokenType: "id_token", token: "google-signed-proof" });
  assert.deepEqual(env.loads, { google: 1, facebook: 0 });
  assert.equal(env.calls.find(call => call.method === "configure")?.args[0] !== undefined, true);
  assert.equal(env.calls.some(call => call.method === "playServices"), true);
  env.googleResult({ type: "cancelled" });
  assert.equal(await login("google"), null);
});

test("each Google retry waits for app-local sign-out before opening the account chooser", async () => {
  const env = setup();
  const login = env.api.createSocialLogin(env.dependencies);
  let releaseSignOut!: () => void;
  env.googleSignOutGate(new Promise<void>(resolve => { releaseSignOut = resolve; }));
  const firstAttempt = login("google");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.calls.filter(call => call.method === "googleLogout").length, 1);
  assert.equal(env.calls.filter(call => call.method === "google").length, 0);
  releaseSignOut();
  await firstAttempt;
  // The server rejected the first proof; cancellation and a later retry must
  // still invoke the chooser rather than returning the first identity again.
  await env.api.createSocialSessionReset(env.dependencies)("google");
  env.googleResult({ type: "cancelled" });
  assert.equal(await login("google"), null);
  env.googleResult({ type: "success", data: { idToken: "another-account-proof" } });
  assert.equal((await login("google"))?.token, "another-account-proof");
  assert.deepEqual(env.calls.filter(call => ["googleLogout", "google"].includes(call.method)).map(call => call.method),
    ["googleLogout", "google", "googleLogout", "googleLogout", "google", "googleLogout", "google"]);
});

test("Facebook retries discard only the app session and Android uses an interactive web dialog", async () => {
  const env = setup();
  const login = env.api.createSocialLogin(env.dependencies);
  await login("facebook");
  await env.api.createSocialSessionReset(env.dependencies)("facebook");
  env.cancelFacebook();
  assert.equal(await login("facebook"), null);
  env.facebookProof("another-facebook-proof");
  assert.equal((await login("facebook"))?.token, "another-facebook-proof");
  assert.deepEqual(env.calls.map(call => call.method),
    ["initialize", "logout", "behavior", "facebook", "logout", "initialize", "logout", "behavior", "facebook", "initialize", "logout", "behavior", "facebook"]);
  assert.deepEqual(plain(env.calls.filter(call => call.method === "behavior").map(call => call.args)), [["web_only"], ["web_only"], ["web_only"]]);
});

test("native session cleanup is lazy and cannot mask the original server rejection", async () => {
  const env = setup();
  const reset = env.api.createSocialSessionReset({ ...env.dependencies,
    loadGoogle: async () => { throw new Error("Missing native module"); },
    loadFacebook: async () => { throw new Error("Missing native module"); },
  });
  await reset("google");
  await reset("facebook");
  assert.deepEqual(env.loads, { google: 0, facebook: 0 });
});

test("iOS Facebook uses fresh limited authentication proof with server nonce, never Graph access proof", async () => {
  const env = setup("ios");
  const login = env.api.createSocialLogin(env.dependencies);
  assert.deepEqual(plain(await login("facebook", challenge)), {
    provider: "facebook", tokenType: "authentication_token", token: "limited-proof", challengeId: challenge.challengeId,
  });
  assert.deepEqual(plain(env.calls.find(call => call.method === "facebook")?.args), [["public_profile", "email"], "limited", challenge.nonce]);
  assert.equal(env.calls.some(call => call.method === "behavior"), false);
  await assert.rejects(login("facebook"), { code: "SOCIAL_CHALLENGE_INVALID" });
  env.cancelFacebook();
  assert.equal(await login("facebook", challenge), null);
});

test("Android Facebook uses access proof and a missing native SDK fails safely", async () => {
  const env = setup();
  assert.deepEqual(plain(await env.api.createSocialLogin(env.dependencies)("facebook")), {
    provider: "facebook", tokenType: "access_token", token: "access-proof",
  });
  await assert.rejects(env.api.createSocialLogin({ ...env.dependencies, loadGoogle: async () => { throw new Error("Native module absent"); } })("google"), { code: "NATIVE_REQUIRED" });
  await assert.rejects(env.api.createSocialLogin({ ...env.dependencies, webClientId: "" })("google"), { code: "SOCIAL_NOT_CONFIGURED" });
});
