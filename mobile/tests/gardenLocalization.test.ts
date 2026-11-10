/** Kiểm tra bản dịch hành trình chăm cây và định dạng ngày, giữ nguyên tên cùng dữ liệu do người dùng nhập. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { gardenMessages } from '../src/i18n/garden';
import { commitLocale, t } from '../src/i18n/core';
import { historyDate } from '../src/screens/plant-detail/history';

const sources = [
  'app/(tabs)/garden.tsx', 'app/(tabs)/camera.tsx', 'app/add-plant.tsx',
  'app/plant-chat.tsx', 'app/plant-detail.tsx',
  'screens/plant-chat/DailyCareComposer.tsx', 'screens/garden/GardenDots.tsx',
  'components/journeyUI.tsx', 'components/AiProgress.tsx',
];
const slots = (source: string) => [...source.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(match => match[1]).sort();

test('every explicit plant-flow source key has both English and Japanese copy', () => {
  for (const file of sources) {
    const source = ts.createSourceFile(file, readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 't' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        const key = node.arguments[0].text;
        assert.ok(gardenMessages[key], `${file}: ${key}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  for (const [source, pair] of Object.entries(gardenMessages)) {
    for (const translated of pair) {
      assert.ok(translated.trim(), source);
      assert.deepEqual(slots(translated), slots(source), `Template placeholders: ${source}`);
    }
  }
});

test('plant names interpolate untouched while growth stages change only for display', () => {
  try {
    commitLocale('en');
    assert.equal(t('Trợ lý của {name}', { name: 'Paper 🌿' }), "Paper 🌿's assistant");
    assert.equal(t('Đang phát triển'), 'Growing');
    commitLocale('ja');
    assert.equal(t('Trợ lý của {name}', { name: 'Paper 🌿' }), 'Paper 🌿のアシスタント');
    assert.equal(t('Đang phát triển'), '生長中');
    commitLocale('vi');
    assert.equal(t('Trợ lý của {name}', { name: 'Paper 🌿' }), 'Trợ lý của Paper 🌿');
  } finally { commitLocale('vi'); }
});

test('journal display dates follow the locale without shifting their stored calendar date', () => {
  try {
    commitLocale('vi'); assert.equal(historyDate('2026-11-06'), '06/11/2026');
    commitLocale('en'); assert.equal(historyDate('2026-11-06'), '11/06/2026');
    commitLocale('ja'); assert.equal(historyDate('2026-11-06'), '2026/11/06');
    assert.equal(historyDate(''), '日付不明');
  } finally { commitLocale('vi'); }
});
