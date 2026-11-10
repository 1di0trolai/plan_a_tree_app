/** Kiểm thử công tắc nhạc, thông báo và các thao tác hồ sơ, gồm quyền thiết bị và lỗi lưu. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

import { createGardenFixture } from "./fixtures/gardenFixture";
import { validateAccountProfile, type AccountProfileInput } from "../src/utils/profilePreferences";
import * as passwordPolicy from "../src/utils/passwordPolicy";
import { socialButtonComponent } from "./fixtures/socialButtonComponent";
import { i18nFixture } from "./fixtures/i18nFixture";

const compile = (path: string) => ts.transpileModule(
  readFileSync(resolve(__dirname, path), "utf8"),
  { compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  } },
).outputText;
const compiled = compile("../src/app/(tabs)/profile.tsx");
type Node = { type: unknown; props: Record<string, unknown> };

// Exercise the actual route's switch callbacks without a native runtime.
function profileFlow(options: { denied?: boolean; failWrite?: boolean; waitPermission?: Promise<boolean>; passwordResult?: Promise<{ ok: boolean; message: string }>; providers?: ("google" | "facebook")[] } = {}) {
  const state = createGardenFixture();
  state.settings.notifications = false;
  state.settings.notificationConsent = false;
  const hooks: { value: unknown }[] = [];
  let cursor = 0;
  let permissionRequests = 0;
  let writes = 0;
  const accountUpdates: AccountProfileInput[] = [];
  const passwordUpdates: string[][] = [];
  const useState = <T>(initial: T) => {
    const index = cursor++;
    hooks[index] ??= { value: initial };
    return [hooks[index].value, (value: T | ((previous: T) => T)) => {
      hooks[index].value = typeof value === "function"
        ? (value as (previous: T) => T)(hooks[index].value as T) : value;
    }];
  };
  const useRef = <T>(initial: T) => {
    const index = cursor++;
    hooks[index] ??= { value: { current: initial } };
    return hooks[index].value;
  };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const native = {
    ActivityIndicator: "Spinner", Alert: { alert() {} }, Image: "Image",
    KeyboardAvoidingView: "KeyboardAvoidingView", Modal: "Modal", Platform: { OS: "ios", select: (values: { ios: unknown }) => values.ios },
    Pressable: "Pressable", ScrollView: "ScrollView", Switch: "Switch", Text: "Text", TextInput: "TextInput", View: "View",
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 0.5, absoluteFill: {} },
  };
  const theme = {};
  runInNewContext(compile("../src/theme.ts"), { exports: theme, require: () => native });
  const socialComponent = socialButtonComponent(native, theme, jsx);
  const passwordRulesComponent = {};
  runInNewContext(compile("../src/components/PasswordRules.tsx"), {
    exports: passwordRulesComponent,
    require: (id: string) => {
      if (id === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (id === "react-native") return native;
      if (id === "@expo/vector-icons/Ionicons") return { __esModule: true, default: "Icon" };
      if (id === "@/theme") return theme;
      if (id === "@/i18n") return i18nFixture;
      if (id === "@/utils/passwordPolicy") return passwordPolicy;
      throw new Error(`Unexpected password rule dependency: ${id}`);
    },
  });
  const exports = {} as { default: () => Node };
  runInNewContext(compiled, {
    exports,
    Error,
    __DEV__: true,
    require: (id: string) => {
      switch (id) {
        case "react": return { useState, useRef, useEffect: () => {} };
        case "react/jsx-runtime": return { jsx, jsxs: jsx };
        case "react-native": return native;
        case "@expo/vector-icons/Ionicons": return { __esModule: true, default: "Icon" };
        case "expo-router": return { router: {} };
        case "expo-router/react-navigation": return { useIsFocused: () => true };
        case "react-native-safe-area-context": return { SafeAreaView: "SafeAreaView" };
        case "@/components/journeyUI": return { JourneyButton: "JourneyButton" };
        case "@/components/LanguageSelector": return { LanguageSelector: "LanguageSelector" };
        case "@/i18n": return i18nFixture;
        case "@/components/PasswordRules": return passwordRulesComponent;
        case "@/components/SocialProviderButton": return socialComponent;
        case "@/components/UnreadDot": return { UnreadDot: "UnreadDot" };
        case "@/hooks/useControlFocus": return { useControlFocus: () => ({ props: () => ({}), style: () => undefined }) };
        case "@/hooks/usePreferenceStatus": return { usePreferenceStatus: () => ({}) };
        case "@/screens/profile/GardenerAvatar": return { GardenerAvatar: "GardenerAvatar", OUTFITS: [{ id: "leaf", name: "Lá non" }] };
        case "@/services/preferences": return { requestReminderPermission: async () => {
          permissionRequests++;
          return options.waitPermission ?? !options.denied;
        } };
        case "@/store/AppStore": return { useApp: () => ({ state,
          account: { hasPassword: true, providers: options.providers ?? [] },
          changePassword: async (current: string, next: string) => {
            passwordUpdates.push([current, next]);
            return options.passwordResult ?? { ok: true, message: "Đã đổi mật khẩu." };
          },
          updateAccountProfile: async (input: AccountProfileInput) => {
            accountUpdates.push(input);
            state.profile = { ...state.profile, ...input };
            writes++;
            return { ok: true };
          },
          updateSetting: (key: keyof typeof state.settings, value: never) => { state.settings[key] = value; },
          persistNow: async () => { writes++; if (options.failWrite) throw new Error("Không thể lưu trên thiết bị."); },
        }) };
        case "@/theme": return theme;
        case "@/utils/checkInPhotos": return {};
        case "@/utils/profilePreferences": return { validateAccountProfile };
        case "@/utils/passwordPolicy": return passwordPolicy;
        default: throw new Error(`Unexpected dependency: ${id}`);
      }
    },
  });
  const nodes = (value: unknown): Node[] => {
    if (Array.isArray(value)) return value.flatMap(nodes);
    if (!value || typeof value !== "object" || !("type" in value)) return [];
    const node = value as Node;
    if (typeof node.type === "function") return nodes(node.type(node.props));
    // Closed sheets should not create phantom controls in the native tree.
    if (node.type === "Modal" && !node.props.visible) return [node];
    return [node, ...nodes(node.props.children)];
  };
  const render = () => { cursor = 0; return nodes(exports.default()); };
  const toggle = () => render().find(node => node.type === "Switch" && node.props.accessibilityLabel === "Thông báo")!;
  const content = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(content).join("");
    return value && typeof value === "object" && "props" in value
      ? content((value as Node).props.children) : "";
  };
  const openAccount = () => {
    const row = render().find(node => node.type === "Pressable" && content(node).includes("Hồ sơ tài khoản"))!;
    (row.props.onPress as () => void)();
    return render();
  };
  const openPassword = () => {
    const row = openAccount().find(node => node.type === "Pressable" && content(node) === "Đổi mật khẩu")!;
    (row.props.onPress as () => void)();
    return render();
  };
  const field = (label: string, value: string) => {
    const input = render().find(node => node.type === "TextInput" && node.props.accessibilityLabel === label)!;
    assert.ok(input, label);
    (input.props.onChangeText as (next: string) => void)(value);
  };
  return { state, render, toggle, openAccount, openPassword, field, content, accountUpdates, passwordUpdates, writes: () => writes, permissionRequests: () => permissionRequests };
}
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };

test("notifications and music are native switches on the profile, with no notification sheet", () => {
  const app = profileFlow();
  const controls = app.render().filter(node => node.type === "Switch");
  assert.deepEqual(controls.map(node => node.props.accessibilityLabel), ["Âm thanh nền", "Thông báo"]);
  assert.equal(app.render().some(node => node.type === "Modal" && node.props.visible), false);
  assert.equal(app.permissionRequests(), 0);
});

test("profile does not expose resource injection or data-reset controls, including development builds", () => {
  const app = profileFlow();
  const nodes = app.render();
  const visible = nodes.map(app.content).join("\n");
  assert.equal(nodes.some(node => node.type === "DevTestResources"), false);
  assert.doesNotMatch(visible, /Nạp tài nguyên|Xóa dữ liệu|Xoá dữ liệu|bắt đầu lại/);
  assert.ok(nodes.some(node => node.type === "Pressable" && app.content(node) === "Đăng xuất"));
});

test("profile keeps automatic sync out of settings while retaining language and account save controls", () => {
  const app = profileFlow();
  const nodes = app.render();
  assert.doesNotMatch(nodes.map(app.content).join("\n"), /Đồng bộ dữ liệu|Đã lưu trên máy chủ|Chạm để kiểm tra bản lưu/);
  assert.equal(nodes.some(node => node.props.name === "cloud-done-outline"), false);
  assert.ok(nodes.some(node => node.type === "LanguageSelector"));
  assert.ok(app.openAccount().some(node => node.type === "JourneyButton" && node.props.title === "Lưu hồ sơ"));
});

test("notification switch requests permission only when enabling and persists both directions", async () => {
  const app = profileFlow();
  (app.toggle().props.onValueChange as (value: boolean) => void)(true);
  await flush();
  assert.equal(app.state.settings.notifications, true);
  assert.equal(app.state.settings.notificationConsent, true);
  assert.equal(app.permissionRequests(), 1);
  assert.equal(app.toggle().props.value, true);
  (app.toggle().props.onValueChange as (value: boolean) => void)(false);
  await flush();
  assert.equal(app.state.settings.notifications, false);
  assert.equal(app.permissionRequests(), 1);
  assert.equal(app.writes(), 2);
});

test("denied permission keeps the switch off and shows an inline recovery message", async () => {
  const app = profileFlow({ denied: true });
  (app.toggle().props.onValueChange as (value: boolean) => void)(true);
  await flush();
  assert.equal(app.toggle().props.value, false);
  assert.equal(app.writes(), 1);
  const errors = app.render().filter(node => node.props.accessibilityRole === "alert");
  assert.equal(errors.length, 1);
  assert.match(String(errors[0].props.children), /Cài đặt hệ thống/);
});

test("notification save failures stay visible outside any sheet", async () => {
  const app = profileFlow({ failWrite: true });
  (app.toggle().props.onValueChange as (value: boolean) => void)(true);
  await flush();
  const error = app.render().find(node => node.props.accessibilityRole === "alert");
  assert.match(String(error?.props.children), /Không thể lưu trên thiết bị/);
});

test("a rapid second tap cannot start a second permission/save operation", async () => {
  let resolvePermission!: (allowed: boolean) => void;
  const permission = new Promise<boolean>(resolve => { resolvePermission = resolve; });
  const app = profileFlow({ waitPermission: permission });
  const onChange = app.toggle().props.onValueChange as (value: boolean) => void;
  onChange(true);
  onChange(true);
  assert.equal(app.permissionRequests(), 1);
  assert.equal(app.toggle().props.disabled, true);
  resolvePermission(true);
  await flush();
  assert.equal(app.writes(), 1);
  assert.equal(app.toggle().props.disabled, false);
});

test("account has no avatar controls or image preview, even for a legacy saved avatar", () => {
  const app = profileFlow();
  app.state.profile.avatarImageUri = "file:///documents/legacy-avatar.jpg";
  const nodes = app.openAccount();
  assert.equal(nodes.some(node => node.type === "Image" && node.props.source !== "official-google-logo"), false);
  const labels = nodes.filter(node => node.type === "JourneyButton").map(node => node.props.title);
  assert.equal(labels.includes("Chọn ảnh đại diện"), false);
  assert.equal(labels.includes("Bỏ ảnh"), false);
  assert.ok(labels.includes("Lưu hồ sơ"));
  assert.equal(nodes.filter(node => node.type === "TextInput").length, 2);
  assert.ok(nodes.some(node => node.type === "Text" && node.props.accessibilityLabel === `Email đăng nhập: ${app.state.auth.identity}`));
});

test("account provider links and password are grouped above save, with a clear linked state", () => {
  const app = profileFlow({ providers: ["google"] });
  const nodes = app.openAccount();
  const save = nodes.findIndex(node => node.type === "JourneyButton" && node.props.title === "Lưu hồ sơ");
  const connections = nodes.findIndex(node => node.props.testID === "account-connections");
  const security = nodes.findIndex(node => node.props.testID === "account-security");
  assert.ok(connections >= 0 && connections < save);
  assert.ok(security > connections && security < save);
  const google = nodes.find(node => node.type === "Pressable" && node.props.accessibilityLabel === "Google, đã liên kết")!;
  const facebook = nodes.find(node => node.type === "Pressable" && node.props.accessibilityLabel === "Liên kết Facebook")!;
  assert.ok(google && facebook);
  assert.equal(google.props.disabled, true);
  assert.equal(facebook.props.disabled, false);
  assert.ok(nodes.some(node => node.props.children === "Đã liên kết"));
  assert.ok(nodes.some(node => node.type === "Image" && node.props.source === "official-google-logo"));
  assert.ok(nodes.some(node => node.type === "Svg"));
});

test("saving account edits only metadata and preserves legacy photos and gardener outfit", async () => {
  const app = profileFlow();
  app.state.profile.avatarImageUri = "file:///documents/legacy-avatar.jpg";
  const outfit = app.state.profile.outfit;
  const nodes = app.openAccount();
  const name = nodes.find(node => node.type === "TextInput" && node.props.accessibilityLabel === "Tên người dùng")!;
  (name.props.onChangeText as (value: string) => void)("Người chăm vườn");
  const save = app.render().find(node => node.type === "JourneyButton" && node.props.title === "Lưu hồ sơ")!;
  (save.props.onPress as () => void)();
  await flush();
  assert.equal(app.writes(), 1);
  assert.equal(app.state.profile.name, "Người chăm vườn");
  assert.equal(app.state.profile.avatarImageUri, "file:///documents/legacy-avatar.jpg");
  assert.equal(app.state.profile.outfit, outfit);
  assert.deepEqual(Object.keys(app.accountUpdates[0]).sort(), ["name", "phone"]);
});

test("change password validates fields, preserves the current password exactly, and clears secrets only on server success", async () => {
  const app = profileFlow();
  app.openPassword();
  const submit = () => (app.render().find(node => node.type === "JourneyButton" && node.props.title === "Đổi mật khẩu")!.props.onPress as () => void)();
  app.field("Mật khẩu hiện tại", " current password ");
  app.field("Mật khẩu mới", "short");
  app.field("Nhập lại mật khẩu mới", "short");
  submit();
  assert.equal(app.passwordUpdates.length, 0);
  assert.ok(app.render().some(node => node.props.children === passwordPolicy.PASSWORD_REQUIREMENTS));
  app.field("Mật khẩu mới", "MemorablePassword1");
  app.field("Nhập lại mật khẩu mới", "not the same password");
  submit();
  assert.equal(app.passwordUpdates.length, 0);
  app.field("Nhập lại mật khẩu mới", "MemorablePassword1");
  submit();
  await flush();
  assert.deepEqual(app.passwordUpdates, [[" current password ", "MemorablePassword1"]]);
  assert.ok(app.render().filter(node => node.type === "TextInput").every(node => node.props.value === ""));
  assert.ok(app.render().some(node => node.props.children === "Đã đổi mật khẩu."));
  assert.equal(app.writes(), 0, "passwords must not use profile/local-state writes");
});

test("pending password change prevents duplicate submits and shows real failures without clearing fields", async () => {
  let finish!: (result: { ok: boolean; message: string }) => void;
  const app = profileFlow({ passwordResult: new Promise(resolve => { finish = resolve; }) });
  app.openPassword();
  app.field("Mật khẩu hiện tại", "wrong password");
  app.field("Mật khẩu mới", "MemorablePassword1");
  app.field("Nhập lại mật khẩu mới", "MemorablePassword1");
  const submit = app.render().find(node => node.type === "JourneyButton" && node.props.title === "Đổi mật khẩu")!.props.onPress as () => void;
  submit();
  submit();
  assert.equal(app.passwordUpdates.length, 1);
  assert.ok(app.render().filter(node => node.type === "TextInput").every(node => node.props.editable === false));
  finish({ ok: false, message: "Mật khẩu hiện tại chưa đúng." });
  await flush();
  assert.ok(app.render().some(node => node.props.accessibilityRole === "alert" && node.props.children === "Mật khẩu hiện tại chưa đúng."));
  assert.equal(app.render().find(node => node.type === "TextInput" && node.props.accessibilityLabel === "Mật khẩu mới")!.props.value, "MemorablePassword1");
});

test("password change applies the two ASCII rules live only to the new password", async () => {
  const app = profileFlow();
  app.openPassword();
  const rule = (label: string) => app.render().find(node => String(node.props.accessibilityLabel).endsWith(`: ${label}`))!;
  assert.equal(rule("8 ký tự trở lên").props.accessibilityLabel, "Chưa đạt: 8 ký tự trở lên");
  assert.equal(rule("Chỉ gồm A–Z, a–z, 0–9").props.accessibilityLabel, "Chưa đạt: Chỉ gồm A–Z, a–z, 0–9");
  const submit = () => (app.render().find(node => node.type === "JourneyButton" && node.props.title === "Đổi mật khẩu")!.props.onPress as () => void)();
  app.field("Mật khẩu hiện tại", "x");
  app.field("Mật khẩu mới", "1234567");
  assert.equal(rule("8 ký tự trở lên").props.accessibilityLabel, "Chưa đạt: 8 ký tự trở lên");
  assert.equal(rule("Chỉ gồm A–Z, a–z, 0–9").props.accessibilityLabel, "Đạt: Chỉ gồm A–Z, a–z, 0–9");
  for (const invalid of ["abcdefg", "abcdefgh ", "Ábcdefg1", "Abcd!123"]) {
    app.field("Mật khẩu mới", invalid);
    app.field("Nhập lại mật khẩu mới", invalid);
    submit();
    assert.equal(app.passwordUpdates.length, 0);
  }
  app.field("Mật khẩu mới", "12345678");
  assert.equal(rule("8 ký tự trở lên").props.accessibilityLabel, "Đạt: 8 ký tự trở lên");
  assert.equal(rule("Chỉ gồm A–Z, a–z, 0–9").props.accessibilityLabel, "Đạt: Chỉ gồm A–Z, a–z, 0–9");
  assert.equal(app.render().some(node => node.props.accessibilityRole === "alert"), false, "editing clears stale validation errors");
  assert.equal(app.passwordUpdates.length, 0, "typing never sends a request");
  app.field("Nhập lại mật khẩu mới", "12345678");
  submit();
  await flush();
  assert.deepEqual(app.passwordUpdates, [["x", "12345678"]]);
});
