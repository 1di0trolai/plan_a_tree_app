/** Khai báo thông báo và quy tắc mật khẩu 8–128 ký tự chỉ gồm A–Z, a–z, 0–9; trả trạng thái từng điều kiện mà không tự sửa mật khẩu nhập vào. */

export const PASSWORD_REQUIREMENTS =
  "Mật khẩu cần từ 8 đến 128 ký tự và chỉ gồm A–Z, a–z, 0–9.";

export function getPasswordRules(value: string): { length: boolean; characters: boolean } {
  return {
    length: value.length >= 8,
    characters: value.length > 0 && !/[^A-Za-z0-9]/.test(value),
  };
}

/** Validate the original input; never silently trim or rewrite a password. */
export function isValidNewPassword(value: string): boolean {
  const rules = getPasswordRules(value);
  return rules.length && rules.characters && value.length <= 128;
}
