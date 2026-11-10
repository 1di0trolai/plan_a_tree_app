/** Kiểm tra cấu hình bản dựng cá nhân và trình mô phỏng, đồng thời giữ thông tin máy chủ và ký ứng dụng ngoài mã nguồn. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const configuration = JSON.parse(
  readFileSync(new URL("../eas.json", import.meta.url), "utf8"),
);
const personal = configuration.build.personal;

test("iOS simulator inherits preview environment and runtime from personal", () => {
  assert.equal(configuration.build["ios-simulator"].extends, "personal");
  assert.equal(configuration.build["ios-simulator"].ios.simulator, true);
  assert.equal(configuration.build["ios-simulator"].environment, undefined);
});

test("personal build produces a signed standalone APK rather than a development client", () => {
  assert.equal(personal.distribution, "internal");
  assert.equal(personal.environment, "preview");
  assert.equal(personal.developmentClient, false);
  assert.equal(personal.android.buildType, "apk");
  assert.notEqual(personal.withoutCredentials, true);
  assert.notEqual(personal.android.withoutCredentials, true);
  assert.equal(personal.android.gradleCommand, undefined);
});

test("personal build uses the supported Node branch without overriding Expo native SDK defaults", () => {
  const [major, minor] = personal.node.split(".").map(Number);
  assert.equal(major, 24);
  assert.ok(minor >= 3);
  assert.equal(configuration.cli.appVersionSource, "local");
  assert.deepEqual(Object.keys(personal.android), ["buildType"]);
});

test("build profile leaves API values, Expo ownership and signing credentials outside source control", () => {
  assert.equal(personal.env, undefined);
  assert.equal(personal.android.env, undefined);
  assert.equal(personal.credentialsSource, undefined);
  assert.equal(configuration.submit, undefined);
  const serialized = JSON.stringify(configuration);
  assert.doesNotMatch(serialized, /https?:\/\/|EXPO_PUBLIC_|GEMINI_API_KEY|SMTP_PASS|projectId|owner|keystore|credentials\.json/i);
});
