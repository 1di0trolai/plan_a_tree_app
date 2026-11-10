/** Kiểm tra cách căn chữ, khoảng đệm và khả năng co giãn của toàn bộ ô nhập liệu gốc. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

type Style = Record<string, unknown>;
type Node = { type: unknown; props: Record<string, unknown> };
const read = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const theme = {} as typeof import("../src/theme");
runInNewContext(compile(read("theme.ts")), { exports: theme, require: () => ({ Platform: { OS: "ios", Version: 26 } }) });

function parse(file: string) { return ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); }
function collect<T extends ts.Node>(node: ts.Node, predicate: (node: ts.Node) => node is T): T[] {
  const matches: T[] = [];
  const visit = (entry: ts.Node) => { if (predicate(entry)) matches.push(entry); ts.forEachChild(entry, visit); };
  visit(node); return matches;
}

/** Evaluate the actual StyleSheet object, not a copied version of its declarations. */
function styles(file: string) {
  const ast = parse(file);
  const declarations = collect(ast, ts.isVariableDeclaration).filter((node) => node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(ast) === "StyleSheet.create");
  const result: Record<string, Record<string, Style>> = {};
  for (const declaration of declarations) {
    const call = declaration.initializer as ts.CallExpression;
    const exports: { value?: Record<string, Style> } = {};
    runInNewContext(compile(`exports.value = ${call.arguments[0].getText(ast)};`), { exports, ...theme, ...(file !== "components/journeyUI.tsx" ? { ui: styles("components/journeyUI.tsx").ui } : {}), StyleSheet: { hairlineWidth: 0.5 }, Platform: { OS: "ios" } });
    result[declaration.name.getText(ast)] = exports.value!;
  }
  return result;
}

function assertNativeMetrics(style: Style, name: string) {
  assert.equal(style.lineHeight, undefined, `${name}: paragraph line height must not shift the native baseline`);
  assert.equal(style.height, undefined, `${name}: text can grow rather than a fixed input height`);
  assert.equal(style.includeFontPadding, false, `${name}: Android padding is explicit and symmetric`);
  assert.ok(Number(style.minHeight) >= theme.LAYOUT.touch, `${name}: native touch target`);
  assert.ok(Number(style.fontSize) > 0, `${name}: readable inherited text size`);
  assert.equal(style.paddingTop, undefined, `${name}: no one-sided top correction`);
  assert.equal(style.paddingBottom, undefined, `${name}: no one-sided bottom correction`);
  assert.ok(Number(style.paddingVertical) > 0, `${name}: symmetric vertical padding`);
}

test("shared INPUT tokens preserve native metrics, symmetric padding and scalable minimum heights", () => {
  for (const [name, input] of Object.entries(theme.INPUT)) assertNativeMetrics(input as unknown as Style, name);
  assert.equal(theme.INPUT.singleLine.textAlignVertical, "center");
  assert.equal(theme.INPUT.multiline.textAlignVertical, "top");
  assert.equal(theme.INPUT.compact.textAlignVertical, "center");
  assert.equal(theme.INPUT.compact.textAlign, "center");
  assert.equal(theme.TYPE.body.lineHeight, 24, "Paragraph typography remains unchanged outside inputs");
});

test("all eleven native TextInput sites adopt INPUT metrics without disabling text scaling", () => {
  const sites = [
    { file: "app/index.tsx", dictionary: "styles", key: "input", count: 5, align: "center" },
    { file: "components/journeyUI.tsx", dictionary: "ui", key: "input", count: 1, align: "center" },
    { file: "app/(tabs)/profile.tsx", dictionary: "styles", key: "input", alternateKey: "passwordInput", count: 2, align: "center" },
    { file: "app/plant-chat.tsx", dictionary: "styles", key: "input", count: 1, align: "top" },
    { file: "screens/plant-chat/DailyCareComposer.tsx", dictionary: "styles", key: "careInput", count: 1, align: "center" },
    { file: "app/shop.tsx", dictionary: "styles", key: "quantity", count: 1, align: "center" },
  ];
  let total = 0;
  for (const site of sites) {
    const ast = parse(site.file);
    const inputs = collect(ast, ts.isJsxSelfClosingElement).filter((node) => node.tagName.getText(ast) === "TextInput");
    assert.equal(inputs.length, site.count, site.file); total += inputs.length;
    const definitions = styles(site.file)[site.dictionary];
    for (const element of inputs) {
      const attributes = element.attributes.properties.filter(ts.isJsxAttribute);
      const attribute = (name: string) => attributes.find((entry) => entry.name.getText(ast) === name);
      const styleExpression = attribute("style")?.initializer?.getText(ast) ?? "";
      const key = [site.key, site.alternateKey].find(candidate => candidate && styleExpression.includes(`${site.dictionary}.${candidate}`));
      assert.ok(key, `${site.file}: native input uses the shared contract`);
      const input = definitions[key];
      assertNativeMetrics(input, `${site.file}/${key}`);
      assert.equal(input.textAlignVertical, site.align, site.file);
      assert.equal(attribute("allowFontScaling")?.initializer?.getText(ast).includes("false") ?? false, false);
      assert.equal(attribute("maxFontSizeMultiplier"), undefined, `${site.file}: no arbitrary text-scale ceiling`);
    }
  }
  assert.equal(total, 11);
  assert.equal(styles("app/shop.tsx").styles.quantity.textAlign, "center");
  assert.equal(styles("screens/plant-chat/DailyCareComposer.tsx").styles.careInput.textAlign, undefined, "Care note keeps horizontal typing direction; only vertical center is intentional");
});

test("actual JourneyField single/multiline and compact variants use the right native vertical alignment", () => {
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const exports = {} as { JourneyField: (props: Record<string, unknown>) => Node };
  runInNewContext(compile(read("components/journeyUI.tsx")), { exports, require: (id: string) => {
    if (id === "react") return { useState: (initial: unknown) => [initial, () => {}] };
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (id === "react-native") return { StyleSheet: { create: (value: unknown) => value, hairlineWidth: 0.5 }, TextInput: "TextInput", Text: "Text", View: "View" };
    if (id === "@/theme") return theme;
    return {};
  } });
  const nodes = (value: unknown): Node[] => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === "object" && "props" in value ? [value as Node, ...nodes((value as Node).props.children)] : [];
  for (const multiline of [false, true]) for (const size of ["sm", "md"]) {
    const field = exports.JourneyField({ label: "Tên cây", value: "Cây của tôi", onChangeText: () => {}, multiline, size });
    const input = nodes(field).find((node) => node.type === "TextInput")!;
    const style = Object.assign({}, ...(input.props.style as (Style | false)[]).filter(Boolean));
    assertNativeMetrics(style, `${size}/${multiline}`);
    assert.equal(style.textAlignVertical, multiline ? "top" : "center");
    assert.equal(input.props.allowFontScaling, undefined);
  }
});
