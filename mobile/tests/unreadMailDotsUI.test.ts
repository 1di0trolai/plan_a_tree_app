/** Kiểm thử dấu chấm thư chưa đọc trên hồ sơ và hòm thư, không tự đánh dấu đã đọc khi chỉ mở trang. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

import { createInitialState } from "../src/data/seed";
import { readMail } from "../src/store/loginMailbox";
import { normalizePersistedState } from "../src/store/normalizeState";
import type { MailMessage } from "../src/types/app";
import * as passwordPolicy from "../src/utils/passwordPolicy";
import { socialButtonComponent } from "./fixtures/socialButtonComponent";
import { i18nFixture } from "./fixtures/i18nFixture";

type Node = { type: unknown; props: Record<string, unknown> };
const jsx = (type: unknown, props: Record<string, unknown>): Node => ({ type, props });
const compile = (path: string) => ts.transpileModule(
  readFileSync(new URL(path, import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } },
).outputText;
const sources = {
  theme: compile("../src/theme.ts"),
  dot: compile("../src/components/UnreadDot.tsx"),
  tabs: compile("../src/app/(tabs)/_layout.tsx"),
  profile: compile("../src/app/(tabs)/profile.tsx"),
  mailbox: compile("../src/app/mailbox.tsx"),
};
const mail = (id: string, props: Partial<MailMessage> = {}): MailMessage => ({
  id, source: "publisher", sourceRef: id, title: id, body: "Tin từ PAT",
  createdAt: "2026-11-01T00:00:00Z", readAt: null, claimedAt: null, attachments: [], ...props,
});
const nodes = (value: unknown): Node[] => {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node;
  if (typeof node.type === "function") return nodes(node.type(node.props));
  if (node.type === "Modal" && !node.props.visible) return [];
  return [node, ...nodes(node.props.children)];
};
const textContent = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textContent).join("");
  return value && typeof value === "object" && "props" in value ? textContent((value as Node).props.children) : "";
};
const dots = (tree: Node[]) => tree.filter((node) => node.props.importantForAccessibility === "no-hide-descendants");

function app(mailbox: MailMessage[]) {
  let state = createInitialState();
  state.auth.loggedIn = true;
  state.mailbox = mailbox;
  const navigation: string[] = [];
  let readCalls = 0;
  const native = {
    ActivityIndicator: "ActivityIndicator", Alert: { alert() {} }, Image: "Image", KeyboardAvoidingView: "KeyboardAvoidingView",
    Modal: "Modal", Platform: { OS: "ios", Version: 26, select: (values: { ios: unknown }) => values.ios },
    Pressable: "Pressable", ScrollView: "ScrollView", Switch: "Switch", Text: "Text", TextInput: "TextInput", View: "View",
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 0.5, absoluteFill: {} },
  };
  const theme = {};
  runInNewContext(sources.theme, { exports: theme, require: () => native });
  const socialComponent = socialButtonComponent(native, theme, jsx);
  const dot = {};
  const Tabs = Object.assign((props: Record<string, unknown>) => jsx("Tabs", props), { Screen: "TabScreen" });
  const requireModule = (id: string): unknown => {
    switch (id) {
      case "react": return {
        useRef: (value: unknown) => ({ current: value }),
        useState: (value: unknown) => [value, () => {}],
        useEffect: (effect: () => void) => effect(),
        useCallback: (callback: unknown) => callback,
      };
      case "react/jsx-runtime": return { jsx, jsxs: jsx };
      case "react-native": return native;
      case "@expo/vector-icons/Ionicons": return { __esModule: true, default: "Icon" };
      case "expo-router": return { Tabs, useFocusEffect: (callback: () => void) => callback(), router: { push: (path: string) => navigation.push(path) } };
      case "expo-router/react-navigation": return { PlatformPressable: "PlatformPressable", useIsFocused: () => true };
      case "react-native-safe-area-context": return { SafeAreaView: "SafeAreaView", useSafeAreaInsets: () => ({ top: 44, bottom: 34 }) };
      case "@/components/UnreadDot": return dot;
      case "@/components/journeyUI": return { JourneyButton: "JourneyButton", JourneyHeader: "JourneyHeader" };
      case "@/components/LanguageSelector": return { LanguageSelector: "LanguageSelector" };
      case "@/i18n": return i18nFixture;
      case "@/components/PasswordRules": return { PasswordRules: "PasswordRules" };
      case "@/components/SocialProviderButton": return socialComponent;
      case "@/hooks/useControlFocus": return { useControlFocus: () => ({ props: () => ({}), style: () => undefined }) };
      case "@/hooks/usePreferenceStatus": return { usePreferenceStatus: () => ({}) };
      case "@/screens/profile/GardenerAvatar": return { GardenerAvatar: "GardenerAvatar", OUTFITS: [{ id: "leaf", name: "Lá non" }] };
      case "@/screens/mailbox/MailboxContent": return { MailboxContent: "MailboxContent" };
      case "@/services/preferences": return {};
      case "@/store/AppStore": return { useApp: () => ({ state, pendingRewardAction: false,
        retrySync: async () => ({ ok: true, message: '' }),
        markMailRead: async (id: string) => {
          readCalls++;
          state = readMail(state, id, new Date("2026-11-04T03:00:00Z")).state;
          return { ok: true, message: "" };
        },
      }) };
      case "@/theme": return theme;
      case "@/utils/profilePreferences": return {};
      case "@/utils/passwordPolicy": return passwordPolicy;
      default: throw new Error(`Unexpected dependency: ${id}`);
    }
  };
  runInNewContext(sources.dot, { exports: dot, require: requireModule });
  const loadRoute = (source: string) => {
    const exports = {} as { default: () => Node };
    runInNewContext(source, { exports, require: requireModule });
    return exports.default;
  };
  const tabRoute = loadRoute(sources.tabs), profileRoute = loadRoute(sources.profile), mailboxRoute = loadRoute(sources.mailbox);
  const profile = () => nodes(profileRoute());
  const tabIcon = (name = "profile", focused = false) => {
    const tree = tabRoute();
    const options = (tree.props.screenOptions as (props: unknown) => { tabBarIcon: (props: unknown) => Node })({ route: { name, key: name } });
    return nodes(options.tabBarIcon({ color: "green", focused }));
  };
  const tabLabel = () => (nodes(tabRoute()).find((node) => node.props.name === "profile")!.props.options as { tabBarAccessibilityLabel: string }).tabBarAccessibilityLabel;
  return {
    profile, tabIcon, tabLabel, navigation, state: () => state, readCalls: () => readCalls,
    mailbox: () => nodes(mailboxRoute()).find((node) => node.type === "MailboxContent")!,
    hydrate: () => { state = normalizePersistedState(JSON.parse(JSON.stringify(state))); },
  };
}

test("both profile icons show one decorative dot only for unread mail, including plain notices", () => {
  for (const messages of [[], [mail("read-gift", { readAt: "2026-11-01T01:00:00Z", attachments: [{ kind: "gold", quantity: 10 }] })]]) {
    const ui = app(messages);
    assert.equal(dots(ui.profile()).length, 0);
    assert.equal(dots(ui.tabIcon()).length, 0);
    assert.equal(ui.tabLabel(), "Hồ sơ");
  }
  const ui = app([mail("notice"), mail("gift", { attachments: [{ kind: "gold", quantity: 10 }] })]);
  for (const tree of [ui.profile(), ui.tabIcon(), ui.tabIcon("profile", true)]) {
    const dot = dots(tree);
    assert.equal(dot.length, 1);
    assert.equal(dot[0].props.accessible, false);
    assert.equal(dot[0].props.accessibilityElementsHidden, true);
    assert.equal(dot[0].props.pointerEvents, "none");
    assert.equal(dot[0].props.children, undefined);
  }
  for (const name of ["garden", "inventory", "camera", "battle"]) assert.equal(dots(ui.tabIcon(name)).length, 0);
  assert.equal(ui.tabLabel(), "Hồ sơ, có thư chưa đọc");
  assert.ok(ui.profile().some((node) => node.props.accessibilityLabel === "Hòm thư, có thư chưa đọc"));
  assert.doesNotMatch(textContent(ui.profile()), /thư mới|quà chờ nhận|thư chưa đọc/);
});

test("visiting profile and mailbox preserves dots until each letter is actually read; read gifts stay unclaimed", async () => {
  const ui = app([mail("notice"), mail("gift", { attachments: [{ kind: "gold", quantity: 10 }] })]);
  const before = structuredClone(ui.state().mailbox);
  const row = ui.profile().find((node) => node.props.accessibilityLabel === "Hòm thư, có thư chưa đọc")!;
  (row.props.onPress as () => void)();
  const mailbox = ui.mailbox();
  assert.deepEqual(ui.navigation, ["/mailbox"]);
  assert.deepEqual(ui.state().mailbox, before);
  assert.equal(ui.readCalls(), 0);
  assert.equal(dots(ui.tabIcon()).length, 1);
  (mailbox.props.onOpen as (id: string) => void)("notice");
  await Promise.resolve();
  assert.equal(dots(ui.profile()).length, 1);
  assert.equal(dots(ui.tabIcon()).length, 1);
  (ui.mailbox().props.onOpen as (id: string) => void)("gift");
  await Promise.resolve();
  ui.hydrate();
  assert.equal(ui.readCalls(), 2);
  assert.equal(ui.state().mailbox[1].claimedAt, null);
  assert.equal(dots(ui.profile()).length, 0);
  assert.equal(dots(ui.tabIcon()).length, 0);
  assert.equal(ui.tabLabel(), "Hồ sơ");
  assert.ok(ui.profile().some((node) => node.props.accessibilityLabel === "Hòm thư"));
});
