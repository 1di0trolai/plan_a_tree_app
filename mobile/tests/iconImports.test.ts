/** Kiểm tra các biểu tượng chỉ nhập đúng họ phông cần dùng để tránh đóng gói toàn bộ bộ biểu tượng. */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.tsx?$/.test(entry.name) ? [file] : [];
  });
}

test("icons use direct family imports so Metro does not include every font family", () => {
  for (const file of sourceFiles(fileURLToPath(new URL("../src/", import.meta.url)))) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const inspect = (node: ts.Node) => {
      const module = ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
        ? node.moduleSpecifier
        : ts.isCallExpression(node) && (
          node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === "require")
        ) ? node.arguments[0] : undefined;
      if (module && ts.isStringLiteral(module)) {
        assert.notEqual(module.text, "@expo/vector-icons", `Use an icon family subpath in ${file}`);
      }
      ts.forEachChild(node, inspect);
    };
    inspect(source);
  }
});
