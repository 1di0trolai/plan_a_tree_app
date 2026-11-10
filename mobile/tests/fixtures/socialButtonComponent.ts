/** Nạp nút Google/Facebook thật vào cây giao diện kiểm thử nhẹ bằng các phụ thuộc được giả lập. */

import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { i18nFixture } from "./i18nFixture";

/** Render the actual shared provider button in the lightweight route test tree. */
export function socialButtonComponent(native: unknown, theme: unknown, jsx: unknown) {
  const source = readFileSync(new URL("../../src/components/SocialProviderButton.tsx", import.meta.url), "utf8");
  const exports = {};
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports,
    require: (id: string) => {
      if (id === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (id === "react-native") return native;
      if (id === "react-native-svg") return { __esModule: true, default: "Svg", Path: "Path" };
      if (id === "@expo/vector-icons/Ionicons") return { __esModule: true, default: "Icon" };
      if (id === "@/theme") return theme;
      if (id === "@/i18n") return i18nFixture;
      if (id === "@/hooks/useControlFocus") return { useControlFocus: () => ({ props: () => ({}), style: () => ({}) }) };
      if (id === "../../assets/logo/google-g.png") return "official-google-logo";
      throw new Error(`Unexpected social button dependency: ${id}`);
    },
  });
  return exports;
}
