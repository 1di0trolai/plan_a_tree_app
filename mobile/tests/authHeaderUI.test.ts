/** Kiểm thử logo và biểu mẫu xác thực, nút mạng xã hội cùng các trạng thái ghi nhớ tài khoản. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as passwordPolicy from "../src/utils/passwordPolicy";
import { socialButtonComponent } from "./fixtures/socialButtonComponent";
import { i18nFixture } from "./fixtures/i18nFixture";


type Node = { type: unknown; props: Record<string, unknown> };
type Style = Record<string, unknown>;

function compile(path: string) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
}

const native = {
  Platform: { OS: "ios", Version: 26 },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 0.5 },
  ActivityIndicator: "ActivityIndicator",
  Image: "Image",
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
};
const theme: Record<string, unknown> = {};
runInNewContext(compile("../src/theme.ts"), {
  exports: theme,
  require: () => native,
});

type RecoveryResult = { ok: boolean; message: string };
type RecoveryOverrides = Partial<Record<"requestPasswordReset" | "resetPassword" | "loginSocial", (...args: unknown[]) => (RecoveryResult & { cancelled?: boolean }) | Promise<RecoveryResult & { cancelled?: boolean }>>>;

function auth(overrides: RecoveryOverrides = {}, rememberOptions: {
  email?: string; enabled?: boolean;
  save?: (enabled: boolean) => Promise<{ ok: boolean; message?: string }>;
} = {}) {
  const hooks: unknown[] = [];
  let cursor = 0;
  let tree: unknown;
  const routes: string[] = [];
  const calls: { action: string; args: unknown[] }[] = [];
  const preferenceCalls: boolean[] = [];
  const cleanups: (() => void)[] = [];
  const pendingEffects: (() => void)[] = [];
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
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
  runInNewContext(compile("../src/app/index.tsx"), {
    exports,
    require: (id: string) => {
      switch (id) {
        case "react": return {
          useRef: <T>(initial: T) => {
            const index = cursor++;
            if (!(index in hooks)) hooks[index] = { current: initial };
            return hooks[index];
          },
          useState: <T>(initial: T) => {
            const index = cursor++;
            if (!(index in hooks)) hooks[index] = initial;
            return [hooks[index], (value: T | ((previous: T) => T)) => {
              hooks[index] = typeof value === "function"
                ? (value as (previous: T) => T)(hooks[index] as T)
                : value;
            }];
          },
          useEffect: (effect: () => (() => void) | void, dependencies: unknown[]) => {
            const index = cursor++;
            const previous = hooks[index] as unknown[] | undefined;
            if (previous && previous.length === dependencies.length && dependencies.every((value, i) => Object.is(value, previous[i]))) return;
            hooks[index] = dependencies;
            pendingEffects.push(() => {
              const cleanup = effect();
              if (cleanup) cleanups.push(cleanup);
            });
          },
        };
        case "react/jsx-runtime": return { jsx, jsxs: jsx };
        case "react-native": return native;
        case "expo-router": return { router: { replace: (route: string) => routes.push(route) } };
        case "@expo/vector-icons/Ionicons": return { __esModule: true, default: "Icon" };
        case "@/components/BrandArtwork": return { BrandArtwork: "BrandArtwork" };
        case "@/components/LanguageSelector": return { LanguageSelector: "LanguageSelector" };
        case "@/i18n": return i18nFixture;
        case "@/components/PasswordRules": return passwordRulesComponent;
        case "@/components/SocialProviderButton": return socialComponent;
        case "react-native-safe-area-context": return { SafeAreaView: "SafeAreaView" };
        case "@/theme": return theme;
        case "@/utils/passwordPolicy": return passwordPolicy;
        case "@/hooks/useControlFocus": return { useControlFocus: () => ({ props: () => ({}), style: () => ({}) }) };
        case "@/store/AppStore": return { useApp: () => ({
          ready: true,
          rememberedEmail: rememberOptions.email ?? "",
          rememberLogin: rememberOptions.enabled ?? false,
          updateRememberLogin: async (enabled: boolean) => {
            preferenceCalls.push(enabled);
            return rememberOptions.save?.(enabled) ?? { ok: true };
          },
          state: { auth: { loggedIn: false } },
          login: (...args: unknown[]) => { calls.push({ action: "login", args }); return { ok: true }; },
          register: (...args: unknown[]) => { calls.push({ action: "register", args }); return { ok: true }; },
          loginSocial: (...args: unknown[]) => {
            calls.push({ action: "loginSocial", args });
            return overrides.loginSocial?.(...args) ?? { ok: true };
          },
          requestPasswordReset: (...args: unknown[]) => {
            calls.push({ action: "requestPasswordReset", args });
            return overrides.requestPasswordReset?.(...args) ?? { ok: true, message: "Nếu email đã đăng ký, hãy kiểm tra thư để lấy mã khôi phục." };
          },
          resetPassword: (...args: unknown[]) => {
            calls.push({ action: "resetPassword", args });
            return overrides.resetPassword?.(...args) ?? { ok: true, message: "Đã đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới." };
          },
        }) };
        default: throw new Error(`Unexpected dependency: ${id}`);
      }
    },
  });
  const render = () => {
    for (let pass = 0; pass < 10; pass++) {
      cursor = 0;
      const route = exports.default();
      tree = (route.type as () => Node)();
      if (!pendingEffects.length) return;
      pendingEffects.splice(0).forEach(effect => effect());
    }
    throw new Error("Auth effects did not settle");
  };
  const nodes = (value: unknown = tree): Node[] => {
    if (Array.isArray(value)) return value.flatMap((child) => nodes(child));
    if (!value || typeof value !== "object" || !("props" in value)) return [];
    const node = value as Node;
    if (typeof node.type === "function") return nodes(node.type(node.props));
    return [node, ...(node.props.children === undefined ? [] : nodes(node.props.children))];
  };
  const button = (label: string) => {
    const found = nodes().find((node) => node.type === "Pressable" && node.props.accessibilityLabel === label);
    assert.ok(found, `Missing button: ${label}`);
    return found;
  };
  const field = (label: string, value: string) => {
    const found = nodes().find((node) => node.type === "TextInput" && node.props.accessibilityLabel === label);
    assert.ok(found, `Missing field: ${label}`);
    (found.props.onChangeText as (next: string) => void)(value);
    render();
  };
  render();
  return { render, nodes, button, field, routes, calls, preferenceCalls, unmount: () => cleanups.forEach(cleanup => cleanup()) };
}

test("auth header centers the large complete PAT logo without a duplicate external wordmark", () => {
  const screen = auth();
  const brand = screen.nodes().find((node) => node.props.testID === "auth-brand")!;
  assert.ok(brand);
  assert.equal((brand.props.style as Style).justifyContent, "center");
  assert.equal(brand.props.accessible, true);
  assert.equal(brand.props.accessibilityLabel, "PAT");
  assert.equal(brand.props.accessibilityRole, "header");
  const contents = screen.nodes(brand);
  assert.equal(contents.filter((node) => node.type === "BrandArtwork").length, 1);
  assert.equal(contents.find((node) => node.type === "BrandArtwork")!.props.size, 176);
  assert.equal(contents.find((node) => node.type === "BrandArtwork")!.props.variant, "logo");
  assert.equal(contents.filter((node) => node.type === "Icon").length, 0);
  assert.equal(contents.filter((node) => node.type === "Text").length, 0);
  assert.equal(screen.nodes().some((node) => String(node.props.children).includes("Một chút chăm sóc")), false);
  assert.equal(screen.nodes().some((node) => node.props.children === "NHẬT KÝ CHĂM CÂY"), false);
  assert.equal(screen.nodes().some((node) => node.props.children === "Giữ lại từng ngày lớn lên của cây."), false);
});

test("social buttons provide named accessible actions and cancellation stays on login", async () => {
  const screen = auth({ loginSocial: () => ({ ok: false, cancelled: true, message: "" }) });
  assert.equal(screen.button("Tiếp tục với Google").props.accessibilityRole, "button");
  assert.equal(screen.button("Tiếp tục với Facebook").props.accessibilityRole, "button");
  await (screen.button("Tiếp tục với Google").props.onPress as () => Promise<void>)();
  screen.render();
  assert.deepEqual(screen.calls.at(-1), { action: "loginSocial", args: ["google", false] });
  assert.equal(screen.routes.length, 0);
  assert.equal(screen.nodes().some(node => node.props.children === "Chưa thể đăng nhập. Hãy thử lại."), false);
});

test("login and registration share full-width branded buttons with decorative official logos", () => {
  const screen = auth();
  for (const mode of ["login", "register"]) {
    assert.equal(screen.nodes().some(node => node.type === "LanguageSelector"), false, `${mode} keeps language settings in Profile`);
    for (const provider of ["Google", "Facebook"]) {
      const button = screen.button(`Tiếp tục với ${provider}`);
      const styles = (button.props.style as (state: { pressed: boolean }) => Style[])({ pressed: false });
      assert.equal(styles[0].width, "100%");
      assert.ok(Number(styles[0].minHeight) >= 48);
      assert.equal(styles[0].height, undefined, "button can grow with text scaling");
      const descendants = screen.nodes(button);
      assert.ok(descendants.some(node => node.type === (provider === "Google" ? "Image" : "Svg")));
      assert.ok(descendants.some(node => node.props.importantForAccessibility === "no-hide-descendants"));
      assert.equal(descendants.some(node => node.props.allowFontScaling === false || node.props.numberOfLines === 1), false);
      assert.equal((button.props.accessibilityState as { disabled: boolean }).disabled, false);
    }
    if (mode === "login") {
      (screen.button("Tạo tài khoản").props.onPress as () => void)();
      screen.render();
    }
  }
});

test("remembered email and opt-in prefill once, never replace edits or populate a password", () => {
  const preference = { email: "gardener@example.com", enabled: true };
  const screen = auth({}, preference);
  const value = (label: string) => screen.nodes().find(node => node.type === "TextInput" && node.props.accessibilityLabel === label)!.props.value;
  assert.equal(value("Email đăng nhập"), "gardener@example.com");
  assert.equal(value("Mật khẩu"), "");
  assert.equal((screen.button("Ghi nhớ đăng nhập").props.accessibilityState as { checked: boolean }).checked, true);
  screen.field("Email đăng nhập", "another@example.com");
  preference.email = "late@example.com";
  screen.render();
  assert.equal(value("Email đăng nhập"), "another@example.com");
});

test("remember persistence failure is visible and keeps the last saved checkbox state", async () => {
  const screen = auth({}, { email: "gardener@example.com", enabled: true,
    save: async () => ({ ok: false, message: "Không lưu được trên thiết bị." }) });
  (screen.button("Ghi nhớ đăng nhập").props.onPress as () => void)();
  await flush();
  screen.render();
  assert.equal((screen.button("Ghi nhớ đăng nhập").props.accessibilityState as { checked: boolean }).checked, true);
  assert.ok(screen.nodes().some(node => node.props.children === "Không lưu được trên thiết bị."));
  assert.deepEqual(screen.preferenceCalls, [false]);
});

test("pending remember saves block duplicate toggles, social sign-in and form mode changes", async () => {
  let resolve!: (result: { ok: boolean }) => void;
  const screen = auth({}, { save: () => new Promise(done => { resolve = done; }) });
  screen.field("Email đăng nhập", "gardener@example.com");
  screen.field("Mật khẩu", "abcdefgh");
  const toggle = screen.button("Ghi nhớ đăng nhập").props.onPress as () => void;
  toggle(); toggle();
  (screen.button("Tiếp tục với Google").props.onPress as () => void)();
  (screen.button("Vào khu vườn").props.onPress as () => void)();
  (screen.button("Tạo tài khoản").props.onPress as () => void)();
  screen.render();
  assert.deepEqual(screen.preferenceCalls, [true]);
  assert.equal(screen.calls.length, 0);
  assert.ok(screen.button("Vào khu vườn"));
  assert.equal(screen.button("Tiếp tục với Facebook").props.disabled, true);
  resolve({ ok: true });
  await flush();
  screen.render();
  assert.equal(screen.button("Tiếp tục với Facebook").props.disabled, false);
  assert.equal((screen.button("Ghi nhớ đăng nhập").props.accessibilityState as { checked: boolean }).checked, true);
});

test("compact auth keeps keyboard-safe scrolling, scalable text and 48dp controls", () => {
  const screen = auth();
  assert.equal(screen.nodes().find((node) => node.type === "KeyboardAvoidingView")!.props.behavior, "padding");
  const scroll = screen.nodes().find((node) => node.type === "ScrollView")!;
  assert.equal(scroll.props.keyboardShouldPersistTaps, "handled");
  const content = scroll.props.contentContainerStyle as Style;
  assert.equal(content.width, "100%");
  assert.equal(content.maxWidth, 480);
  const artwork = screen.nodes().find((node) => node.type === "BrandArtwork")!;
  // The full mark fits the 320dp small-phone content width without shrinking.
  assert.ok(Number(artwork.props.size) <= 320 - Number(content.paddingHorizontal) * 2);
  assert.equal(screen.nodes().some((node) => node.props.allowFontScaling === false), false);
  const submit = screen.button("Vào khu vườn");
  const submitStyle = (submit.props.style as (state: { pressed: boolean }) => Style[])({ pressed: false })[0];
  assert.ok(Number(submitStyle.minHeight) >= 48);
  const eyeStyle = (screen.button("Hiện mật khẩu").props.style as (state: { pressed: boolean }) => Style[])({ pressed: false })[0];
  assert.ok(Number(eyeStyle.width) >= 48 && Number(eyeStyle.minHeight) >= 48);
});

test("login submits email and unchanged password to the server, preserving remember behavior", async () => {
  const screen = auth();
  screen.field("Email đăng nhập", "  gardener@example.com  ");
  screen.field("Mật khẩu", "abc123");
  const remember = screen.nodes().find((node) => node.props.accessibilityRole === "checkbox")!;
  (remember.props.onPress as () => void)();
  await flush();
  screen.render();
  await (screen.button("Vào khu vườn").props.onPress as () => Promise<void>)();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(screen.calls, [{ action: "login", args: ["gardener@example.com", "abc123", true] }]);
  assert.deepEqual(screen.routes, ["/garden"]);
  assert.deepEqual(screen.preferenceCalls, [true]);
});

test("registration keeps the minimal brand and login exposes email recovery", async () => {
  const screen = auth();
  const switchMode = () => screen.nodes().find((node) => node.type === "Pressable" && screen.nodes(node).some((child) => child.props.children === "Tạo tài khoản"))!;
  (switchMode().props.onPress as () => void)();
  screen.render();
  screen.field("Tên người dùng", "Người làm vườn");
  screen.field("Email đăng nhập", "new@example.com");
  screen.field("Mật khẩu", "MemorablePassword1");
  screen.field("Nhập lại mật khẩu", "MemorablePassword1");
  await (screen.button("Tạo tài khoản").props.onPress as () => Promise<void>)();
  await new Promise((resolve) => setImmediate(resolve));
  screen.render();
  assert.deepEqual(screen.calls[0], { action: "register", args: ["Người làm vườn", "new@example.com", "MemorablePassword1"] });
  assert.deepEqual(screen.routes, ["/garden"]);
  const backToLogin = screen.nodes().find((node) => node.type === "Pressable" && screen.nodes(node).some((child) => child.props.children === "Quay lại đăng nhập"))!;
  (backToLogin.props.onPress as () => void)();
  screen.render();
  assert.ok(screen.nodes().find((node) => node.props.testID === "auth-brand"));
  assert.ok(screen.button("Quên mật khẩu?"));
  assert.equal(screen.calls.length, 1);
});

test("account screens use concise app copy without trial notices or simulated recovery success", () => {
  const paths = ["../src/app/index.tsx", "../src/app/(tabs)/profile.tsx"];
  for (const path of paths) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /bản thử nghiệm|Mật khẩu thử nghiệm|phiên thử nghiệm|bản phát triển|bản mẫu|mô phỏng/i, path);
  }
  const authSource = readFileSync(new URL("../src/app/index.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(authSource, /Hồ sơ được lưu trên thiết bị/);
  assert.match(authSource, /requestPasswordReset/);
  assert.match(authSource, /resetPassword/);
});

test("email-only registration rejects short passwords without sending a request", async () => {
  const screen = auth();
  screen.field("Email đăng nhập", "0912345678");
  screen.field("Mật khẩu", "valid password here");
  (screen.button("Vào khu vườn").props.onPress as () => void)();
  screen.render();
  assert.equal(screen.calls.length, 0);
  assert.ok(screen.nodes().some(node => node.props.children === "Nhập email hợp lệ."));
  const create = screen.nodes().find(node => node.type === "Pressable" && screen.nodes(node).some(child => child.props.children === "Tạo tài khoản"))!;
  (create.props.onPress as () => void)();
  screen.render();
  screen.field("Tên người dùng", "Người chăm cây");
  screen.field("Email đăng nhập", "test@example.com");
  screen.field("Mật khẩu", "short12");
  screen.field("Nhập lại mật khẩu", "short12");
  (screen.button("Tạo tài khoản").props.onPress as () => void)();
  screen.render();
  assert.equal(screen.calls.length, 0);
  assert.ok(screen.nodes().some(node => node.props.children === passwordPolicy.PASSWORD_REQUIREMENTS));
});

test("new-password forms show two live rules and accept eight ASCII letters without required character classes", async () => {
  const screen = auth();
  const rule = (label: string) => screen.nodes().find(node => String(node.props.accessibilityLabel).endsWith(`: ${label}`))!;
  assert.equal(screen.nodes().some(node => node.props.children === "8 ký tự trở lên"), false);
  (screen.button("Tạo tài khoản").props.onPress as () => void)();
  screen.render();
  assert.equal(rule("8 ký tự trở lên").props.accessibilityLabel, "Chưa đạt: 8 ký tự trở lên");
  assert.equal(rule("Chỉ gồm A–Z, a–z, 0–9").props.accessibilityLabel, "Chưa đạt: Chỉ gồm A–Z, a–z, 0–9");
  screen.field("Mật khẩu", "abcdefg");
  assert.equal(rule("8 ký tự trở lên").props.accessibilityLabel, "Chưa đạt: 8 ký tự trở lên");
  assert.equal(rule("Chỉ gồm A–Z, a–z, 0–9").props.accessibilityLabel, "Đạt: Chỉ gồm A–Z, a–z, 0–9");
  assert.equal(screen.nodes(rule("Chỉ gồm A–Z, a–z, 0–9")).find(node => node.type === "Icon")!.props.name, "checkmark");
  screen.field("Mật khẩu", "abcdefgh");
  assert.equal(rule("8 ký tự trở lên").props.accessibilityLabel, "Đạt: 8 ký tự trở lên");
  assert.equal(screen.calls.length, 0, "typing must not send any request");
  screen.field("Tên người dùng", "Người chăm cây");
  screen.field("Email đăng nhập", "gardener@example.com");
  for (const invalid of ["abcdefg", "abcdefgh ", "Ábcdefg1", "Abcd!123"]) {
    screen.field("Mật khẩu", invalid);
    screen.field("Nhập lại mật khẩu", invalid);
    (screen.button("Tạo tài khoản").props.onPress as () => void)();
    screen.render();
    assert.equal(screen.calls.length, 0);
  }
  screen.field("Mật khẩu", "abcdefgh");
  assert.equal(screen.nodes().some(node => node.props.children === passwordPolicy.PASSWORD_REQUIREMENTS), false, "editing clears stale password errors");
  screen.field("Nhập lại mật khẩu", "abcdefgh");
  (screen.button("Tạo tài khoản").props.onPress as () => void)();
  await flush();
  assert.deepEqual(screen.calls[0], { action: "register", args: ["Người chăm cây", "gardener@example.com", "abcdefgh"] });
});

const recoveryToken = "a".repeat(43);
const recoveredPassword = "12345678";
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

async function requestRecovery(screen: ReturnType<typeof auth>) {
  (screen.button("Quên mật khẩu?").props.onPress as () => void)();
  screen.render();
  screen.field("Email đăng nhập", "  gardener@example.com  ");
  (screen.button("Gửi mã khôi phục").props.onPress as () => void)();
  await flush();
  screen.render();
}

test("email recovery verifies the mailed token and returns to login without authenticating", async () => {
  const screen = auth();
  screen.field("Mật khẩu", "old secret");
  await requestRecovery(screen);
  assert.deepEqual(screen.calls, [{ action: "requestPasswordReset", args: ["gardener@example.com"] }]);
  assert.equal(screen.nodes().some(node => node.props.accessibilityLabel === "Email đăng nhập"), false);
  assert.equal(screen.nodes().find(node => node.props.accessibilityLabel === "Mật khẩu mới")!.props.value, "");
  assert.deepEqual(screen.routes, []);
  screen.field("Mã khôi phục", `  ${recoveryToken}  `);
  screen.field("Mật khẩu mới", recoveredPassword);
  screen.field("Nhập lại mật khẩu", recoveredPassword);
  (screen.button("Đặt mật khẩu mới").props.onPress as () => void)();
  await flush();
  screen.render();
  assert.deepEqual(screen.calls[1], { action: "resetPassword", args: [recoveryToken, recoveredPassword] });
  assert.deepEqual(screen.routes, []);
  assert.ok(screen.button("Vào khu vườn"));
  assert.equal(screen.nodes().find(node => node.props.accessibilityLabel === "Mật khẩu")!.props.value, "");
  assert.equal(screen.nodes().some(node => node.props.accessibilityLabel === "Mã khôi phục"), false);
  assert.ok(screen.nodes().some(node => node.props.children === "Đã đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới."));
});

test("recovery request errors stay on the email step and can be retried", async () => {
  let configured = false;
  const error = "Chưa cấu hình gửi email khôi phục. Vui lòng thử lại sau.";
  const screen = auth({ requestPasswordReset: () => configured
    ? { ok: true, message: "Nếu email đã đăng ký, hãy kiểm tra thư để lấy mã khôi phục." }
    : { ok: false, message: error } });
  (screen.button("Quên mật khẩu?").props.onPress as () => void)();
  screen.render();
  screen.field("Email đăng nhập", "not an email");
  (screen.button("Gửi mã khôi phục").props.onPress as () => void)();
  screen.render();
  assert.equal(screen.calls.length, 0);
  await requestRecoveryFromEmail();
  assert.ok(screen.nodes().some(node => node.props.children === error));
  assert.ok(screen.button("Gửi mã khôi phục"));
  assert.equal(screen.nodes().some(node => node.props.accessibilityLabel === "Mã khôi phục"), false);
  configured = true;
  await requestRecoveryFromEmail();
  assert.ok(screen.button("Đặt mật khẩu mới"));
  assert.deepEqual(screen.routes, []);

  async function requestRecoveryFromEmail() {
    screen.field("Email đăng nhập", "gardener@example.com");
    (screen.button("Gửi mã khôi phục").props.onPress as () => void)();
    await flush();
    screen.render();
  }
});

test("reset validates code and confirmation, retains failed input, and clears secrets when requesting a new code", async () => {
  const error = "Mã khôi phục không hợp lệ hoặc đã hết hạn. Hãy yêu cầu mã mới.";
  const screen = auth({ resetPassword: () => ({ ok: false, message: error }) });
  await requestRecovery(screen);
  screen.field("Mã khôi phục", "123456");
  screen.field("Mật khẩu mới", recoveredPassword);
  screen.field("Nhập lại mật khẩu", recoveredPassword);
  (screen.button("Đặt mật khẩu mới").props.onPress as () => void)();
  screen.render();
  assert.equal(screen.calls.length, 1);
  assert.ok(screen.nodes().some(node => node.props.children === "Dán đầy đủ mã khôi phục trong email."));
  screen.field("Mã khôi phục", recoveryToken);
  screen.field("Nhập lại mật khẩu", "another password");
  (screen.button("Đặt mật khẩu mới").props.onPress as () => void)();
  screen.render();
  assert.equal(screen.calls.length, 1);
  assert.ok(screen.nodes().some(node => node.props.children === "Mật khẩu nhập lại chưa khớp."));
  screen.field("Nhập lại mật khẩu", recoveredPassword);
  (screen.button("Đặt mật khẩu mới").props.onPress as () => void)();
  await flush();
  screen.render();
  assert.ok(screen.nodes().some(node => node.props.children === error));
  assert.equal(screen.nodes().find(node => node.props.accessibilityLabel === "Mã khôi phục")!.props.value, recoveryToken);
  (screen.button("Gửi lại mã").props.onPress as () => void)();
  screen.render();
  const emailValue = screen.nodes().find(node => node.props.accessibilityLabel === "Email đăng nhập")!.props.value;
  assert.ok(typeof emailValue === "string");
  assert.equal(emailValue.trim(), "gardener@example.com");
  (screen.button("Gửi mã khôi phục").props.onPress as () => void)();
  await flush();
  screen.render();
  for (const label of ["Mã khôi phục", "Mật khẩu mới", "Nhập lại mật khẩu"]) {
    assert.equal(screen.nodes().find(node => node.props.accessibilityLabel === label)!.props.value, "");
  }
});

test("recovery pending guards duplicate requests and ignores a response after leaving the screen", async () => {
  let resolve!: (result: RecoveryResult) => void;
  const pending = new Promise<RecoveryResult>(complete => { resolve = complete; });
  const screen = auth({ requestPasswordReset: () => pending });
  (screen.button("Quên mật khẩu?").props.onPress as () => void)();
  screen.render();
  screen.field("Email đăng nhập", "gardener@example.com");
  const submit = screen.button("Gửi mã khôi phục").props.onPress as () => void;
  submit();
  submit();
  screen.render();
  assert.equal(screen.calls.length, 1);
  assert.equal(screen.button("Gửi mã khôi phục").props.disabled, true);
  assert.equal(screen.button("Quay lại đăng nhập").props.disabled, true);
  assert.equal(screen.nodes().find(node => node.props.accessibilityLabel === "Email đăng nhập")!.props.editable, false);
  screen.unmount();
  resolve({ ok: true, message: "Nếu email đã đăng ký, hãy kiểm tra thư để lấy mã khôi phục." });
  await flush();
  screen.render();
  assert.equal(screen.nodes().some(node => node.props.accessibilityLabel === "Mã khôi phục"), false);
  assert.deepEqual(screen.routes, []);
});
