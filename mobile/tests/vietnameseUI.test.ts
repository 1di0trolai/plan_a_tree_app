/** Kiểm tra nhãn tiếng Việt mặc định không còn các từ cũ như pet, EXP, Battle hoặc tiền tố cấp ngoại ngữ. */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
const legacyWords = /\b(?:pets?|EXP|Battle|Coming Soon|Lv\.?)\b/i;
const readableProps = new Set(['title', 'label', 'placeholder', 'accessibilityLabel', 'accessibilityHint']);

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sources(path) : path.endsWith('.tsx') ? [path] : [];
  });
}

test('first-party visible labels use Vietnamese rather than old pet, EXP, Battle or Lv copy', () => {
  const violations: string[] = [];
  for (const path of sources(sourceRoot)) {
    const ast = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const check = (node: ts.Node, text: string) => {
      if (legacyWords.test(text)) violations.push(`${path}:${ast.getLineAndCharacterOfPosition(node.pos).line + 1}: ${text.trim()}`);
    };
    // Only displayed values, not route IDs, icon names, enums, comparisons or developer comments.
    const value = (node: ts.Expression): void => {
      if (ts.isStringLiteralLike(node)) check(node, node.text);
      else if (ts.isTemplateExpression(node)) {
        check(node.head, node.head.text);
        for (const span of node.templateSpans) check(span.literal, span.literal.text);
      } else if (ts.isConditionalExpression(node)) { value(node.whenTrue); value(node.whenFalse); }
      else if (ts.isParenthesizedExpression(node)) value(node.expression);
      else if (ts.isBinaryExpression(node) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(node.operatorToken.kind)) value(node.right);
    };
    const visit = (node: ts.Node): void => {
      if (ts.isJsxText(node)) check(node, node.text);
      if (ts.isJsxAttribute(node) && readableProps.has(node.name.getText(ast)) && node.initializer) {
        if (ts.isStringLiteral(node.initializer)) check(node.initializer, node.initializer.text);
        else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) value(node.initializer.expression);
      }
      if (ts.isJsxExpression(node) && node.expression && ts.isJsxElement(node.parent)
        && node.parent.openingElement.tagName.getText(ast) === 'Text') value(node.expression);
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  assert.deepEqual(violations, []);
});
