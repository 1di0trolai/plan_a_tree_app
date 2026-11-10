/** Kiểm thử tùy chỉnh hồ sơ, trạng thái đồng ý nhạc/thông báo và chuẩn hóa thông tin tài khoản. */

import assert from "node:assert/strict";
import test from "node:test";

import { createInitialState } from "../src/data/seed";
import { normalizePersistedState } from "../src/store/normalizeState";
import {
  isGardenerOutfit,
  parseReminderTime,
  shouldPlayBackgroundMusic,
  validateAccountProfile,
} from "../src/utils/profilePreferences";

test("new profiles start with a leaf outfit and no unexpected music or reminder opt-in", () => {
  const state = createInitialState();
  assert.equal(state.profile.outfit, "leaf");
  assert.equal(state.settings.music, false);
  assert.equal(state.settings.musicConsent, false);
  assert.equal(state.settings.notifications, false);
  assert.equal(state.settings.notificationConsent, false);
  assert.equal(state.settings.musicUri, null);
});

test("legacy inert enabled toggles migrate to off without resetting the user account", () => {
  const state = createInitialState();
  const raw = structuredClone(state) as unknown as Record<
    string,
    Record<string, unknown>
  >;
  raw.profile.name = "Vườn của Thái";
  delete raw.profile.outfit;
  delete raw.profile.username;
  delete raw.profile.email;
  delete raw.profile.phone;
  raw.settings.music = true;
  raw.settings.notifications = true;
  delete raw.settings.musicConsent;
  delete raw.settings.notificationConsent;
  const migrated = normalizePersistedState(raw);
  assert.equal(migrated.profile.name, "Vườn của Thái");
  assert.equal(migrated.profile.outfit, "leaf");
  assert.equal(migrated.settings.music, false);
  assert.equal(migrated.settings.notifications, false);
});

test("explicit consent and local profile preferences survive normalization", () => {
  const state = createInitialState();
  state.profile = {
    ...state.profile,
    email: "thai@example.test",
    phone: "+84912345678",
    outfit: "rain",
  };
  state.settings = {
    ...state.settings,
    music: true,
    musicConsent: true,
    notifications: true,
    notificationConsent: true,
    musicUri: "file:///private/pat-music/123-abc.mp3",
    musicName: "Garden.mp3",
    reminderTime: "17:45",
  };
  const normalized = normalizePersistedState(state);
  assert.deepEqual(normalized.profile, state.profile);
  assert.deepEqual(normalized.settings, state.settings);
});

test("outfit and clock values are constrained; corrupt values get safe defaults", () => {
  for (const outfit of ["leaf", "sun", "rain"])
    assert.equal(isGardenerOutfit(outfit), true);
  for (const outfit of ["default", "", null, 1, {}])
    assert.equal(isGardenerOutfit(outfit), false);
  for (const time of ["00:00", "08:00", "23:59"])
    assert.notEqual(parseReminderTime(time), null);
  for (const time of ["8:00", "24:00", "12:60", "NaN", "-1:05", "10:15:30"])
    assert.equal(parseReminderTime(time), null);
  const state = createInitialState();
  const normalized = normalizePersistedState({
    ...state,
    profile: { ...state.profile, outfit: "other" },
    settings: { ...state.settings, reminderTime: "99:99" },
  });
  assert.equal(normalized.profile.outfit, "leaf");
  assert.equal(normalized.settings.reminderTime, "08:00");
});

test("one account name trims safely and optional phone stays separate from login credentials", () => {
  const result = validateAccountProfile({
    name: "  Thái  ",
    phone: " +84 912-345-678 ",
  });
  assert.deepEqual(result, {
    ok: true,
    value: {
      name: "Thái",
      phone: "+84912345678",
    },
  });
  assert.equal(
    validateAccountProfile({ name: "Thái", phone: "" })
      .ok,
    true,
  );
});

test("invalid account metadata fails before a store update and never accepts a password field", () => {
  const input = { name: "Thái", phone: "" };
  for (const changed of [
    { name: "A" },
    { name: "a".repeat(41) },
    { phone: "hello" },
    { phone: "12" },
  ])
    assert.equal(validateAccountProfile({ ...input, ...changed }).ok, false);
  const result = validateAccountProfile({
    ...input,
    password: "not-persisted",
  } as typeof input);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal("password" in result.value, false);
});

test("legacy names merge without losing the chosen display name and never retain a second handle", () => {
  const state = createInitialState();
  const normalized = normalizePersistedState({ ...state, profile: { ...state.profile, name: "Thái", username: "thai_garden" } });
  assert.equal(normalized.profile.name, "Thái");
  assert.equal("username" in normalized.profile, false);
  const fallback = normalizePersistedState({ ...state, profile: { ...state.profile, name: "  ", username: "thai_garden" } });
  assert.equal(fallback.profile.name, "thai_garden");
});

test("bundled music requires active session and opt-in; camera and background pause without requiring a chosen URI", () => {
  const settings = {
    ...createInitialState().settings,
    music: true,
    musicConsent: true,
    musicUri: "file:///track.mp3",
  };
  assert.equal(
    shouldPlayBackgroundMusic(settings, true, true, "/profile"),
    true,
  );
  assert.equal(
    shouldPlayBackgroundMusic(settings, true, true, "/camera"),
    false,
  );
  assert.equal(
    shouldPlayBackgroundMusic(settings, true, true, "/(tabs)/camera"),
    false,
  );
  assert.equal(
    shouldPlayBackgroundMusic(settings, false, true, "/profile"),
    false,
  );
  assert.equal(
    shouldPlayBackgroundMusic(settings, true, false, "/profile"),
    false,
  );
  assert.equal(
    shouldPlayBackgroundMusic(
      { ...settings, musicConsent: false },
      true,
      true,
      "/profile",
    ),
    false,
  );
  assert.equal(
    shouldPlayBackgroundMusic(
      { ...settings, music: false },
      true,
      true,
      "/profile",
    ),
    false,
  );
  const noChosenFile = { ...settings, musicUri: null };
  assert.equal(
    shouldPlayBackgroundMusic(noChosenFile, true, true, "/profile"),
    true,
  );
});
