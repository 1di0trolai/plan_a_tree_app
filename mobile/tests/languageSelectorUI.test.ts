/** Kiểm thử bộ chọn ngôn ngữ chỉ có trong hồ sơ, cập nhật bản dịch và phục hồi khi lưu thất bại. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

import { accountMessages } from "../src/i18n/account";

type Locale = "vi" | "en" | "ja";
type Node = { type: unknown; props: Record<string, unknown> };
const compile = (file: string) => ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

test("language selection is available only in Profile, not on sign-in or registration", () => {
  const authSource = readFileSync(new URL("../src/app/index.tsx", import.meta.url), "utf8");
  const profileSource = readFileSync(new URL("../src/app/(tabs)/profile.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(authSource, /LanguageSelector/);
  assert.match(profileSource, /import \{ LanguageSelector \} from "@\/components\/LanguageSelector"/);
  assert.match(profileSource, /<LanguageSelector disabled=\{busy\} \/>/);
});

function selector({ fail = false, initial = "vi" as Locale } = {}) {
  let locale = initial, cursor = 0;
  const hooks: unknown[] = [], saves: Locale[] = [];
  const native = { Platform: { OS: "android", Version: 28 }, ActivityIndicator: "Spinner", Pressable: "Pressable",
    Text: "Text", View: "View", StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 } };
  const theme = {};
  runInNewContext(compile("../src/theme.ts"), { exports: theme, require: () => native });
  const jsx = (type: unknown, props: Record<string, unknown>): Node => ({ type, props });
  const exports = {} as { LanguageSelector: (props: { disabled?: boolean }) => Node };
  runInNewContext(compile("../src/components/LanguageSelector.tsx"), { exports, require: (id: string) => {
    if (id === "react") return {
      useRef: (initial: unknown) => { const index = cursor++; hooks[index] ??= { current: initial }; return hooks[index]; },
      useState: (initial: unknown) => { const index = cursor++; if (!(index in hooks)) hooks[index] = initial;
        return [hooks[index], (value: unknown) => { hooks[index] = value; }]; },
    };
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (id === "react-native") return native;
    if (id === "@expo/vector-icons/Ionicons") return { __esModule: true, default: "Icon" };
    if (id === "@/theme") return theme;
    if (id === "@/hooks/useControlFocus") return { useControlFocus: () => ({ props: () => ({}), style: () => undefined }) };
    if (id === "@/i18n") return { LANGUAGES: [{ code: "vi", name: "Tiếng Việt" }, { code: "en", name: "English" }, { code: "ja", name: "日本語" }],
      useI18n: () => ({ locale, t: (source: string) => locale === "vi" ? source : accountMessages[source]?.[locale === "en" ? 0 : 1] ?? source,
        setLocale: async (next: Locale) => { saves.push(next); if (fail) throw new Error("storage failed"); locale = next; } }),
    };
    throw new Error(`Unexpected dependency: ${id}`);
  } });
  const nodes = (value: unknown): Node[] => Array.isArray(value) ? value.flatMap(nodes)
    : value && typeof value === "object" && "props" in value ? [value as Node, ...nodes((value as Node).props.children)] : [];
  const render = (disabled = false) => { cursor = 0; return nodes(exports.LanguageSelector({ disabled })); };
  const choose = async (name: string) => { const node = render().find(item => item.props.accessibilityLabel === name)!;
    (node.props.onPress as () => void)(); await Promise.resolve(); await Promise.resolve(); };
  return { render, choose, saves };
}

test("language selector uses self-names, selected semantics and updates labels without changing user input", async () => {
  const ui = selector();
  const choices = () => ui.render().filter(node => node.props.accessibilityRole === "radio");
  assert.deepEqual(choices().map(node => node.props.accessibilityLabel), ["Tiếng Việt", "English", "日本語"]);
  assert.deepEqual(choices().map(node => (node.props.accessibilityState as { checked: boolean }).checked), [true, false, false]);
  await ui.choose("日本語");
  assert.deepEqual(ui.saves, ["ja"]);
  assert.ok(ui.render().some(node => node.props.children === "言語"));
  assert.deepEqual(choices().map(node => (node.props.accessibilityState as { checked: boolean }).checked), [false, false, true]);
  await ui.choose("English");
  assert.ok(ui.render().some(node => node.props.children === "Language"));
});

test("language save failure is visible and keeps the previous selected language", async () => {
  const ui = selector({ fail: true, initial: "en" });
  await ui.choose("日本語");
  const tree = ui.render();
  assert.equal((tree.find(node => node.props.accessibilityLabel === "English")!.props.accessibilityState as { checked: boolean }).checked, true);
  assert.ok(tree.some(node => node.props.accessibilityRole === "alert" && node.props.children === "Couldn't save the language. Please try again."));
  assert.ok(ui.render(true).filter(node => node.props.accessibilityRole === "radio").every(node => node.props.disabled));
});
