/** Kiểm thử hai điều kiện mật khẩu về độ dài và ký tự chữ/số ASCII, gồm cập nhật đánh dấu khi nhập. */

import assert from "node:assert/strict";
import { test } from "node:test";
import { getPasswordRules, isValidNewPassword } from "../src/utils/passwordPolicy";

test("password policy accepts eight ASCII letters or digits without requiring every class", () => {
  for (const value of ["", "Abcdef1", "a".repeat(129)])
    assert.equal(isValidNewPassword(value), false, value);
  for (const value of ["Abcdefg1", "abcdefgh", "ABCDEFGH", "12345678", "Gardener123", "a".repeat(128)])
    assert.equal(isValidNewPassword(value), true, value);
});

test("ASCII-only policy rejects spaces, accented letters, symbols and trailing newlines without rewriting", () => {
  for (const value of ["Abcdefg1 ", " Abcdefg1", "Đatmk1234", "Abcdefg!", "Abcdefg1\n", "Abcdefg1\r\n", "Abcdefg١"])
    assert.equal(isValidNewPassword(value), false, value);
});

test("the two checklist conditions update independently while typing and deleting", () => {
  assert.deepEqual(getPasswordRules(""), { length: false, characters: false });
  assert.deepEqual(getPasswordRules("abc"), { length: false, characters: true });
  assert.deepEqual(getPasswordRules("abcdefgh"), { length: true, characters: true });
  assert.deepEqual(getPasswordRules("abcdefg!"), { length: true, characters: false });
  assert.deepEqual(getPasswordRules("abc"), { length: false, characters: true });
});
