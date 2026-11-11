/** Bảo đảm lỗi nhạc/lời nhắc có bản dịch ngay tại lúc hiển thị, không dịch nội dung thư hoặc ghi chú của người dùng. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { commitLocale, messages, t } from '../src/i18n/core';

test('every preference playback/reminder failure has English and Japanese copy', () => {
  const file = new URL('../src/components/PreferenceEffects.tsx', import.meta.url);
  const source = ts.createSourceFile(file.pathname, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const failures = new Set<string>();
  const collect = (node: ts.Node) => {
    if (ts.isStringLiteral(node) && /^(Chưa|Thiết bị).+\.$/.test(node.text)) failures.add(node.text);
    ts.forEachChild(node, collect);
  };
  collect(source);
  assert.ok(failures.size >= 3, 'Read the actual preference failure keys, not copied fixture messages');
  try {
    for (const key of failures) {
      assert.ok(messages[key], `Missing system-error translation: ${key}`);
      commitLocale('vi');
      assert.equal(t(key), key);
      for (const locale of ['en', 'ja'] as const) {
        commitLocale(locale);
        assert.notEqual(t(key), key);
        assert.equal(t(key), messages[key][locale === 'en' ? 0 : 1]);
      }
    }
  } finally { commitLocale('vi'); }
});

test('a retained source error follows locale changes without rewriting user content', () => {
  const failure = 'Chưa tải được nhạc nền. Hãy thử bật nhạc lại.';
  const userContent = 'Ghi chú của tôi: nhạc nền và cây Paper — 日本語';
  try {
    commitLocale('en');
    assert.match(t(failure), /Couldn't load background music/);
    assert.equal(t(userContent), userContent);
    commitLocale('ja');
    assert.match(t(failure), /BGMを読み込めませんでした/);
    assert.equal(t(userContent), userContent);
  } finally { commitLocale('vi'); }
});
