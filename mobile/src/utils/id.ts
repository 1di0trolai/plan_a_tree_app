/** Tạo mã cục bộ có tiền tố từ thời gian và số ngẫu nhiên cho các bản ghi; không dùng làm mã xác thực bảo mật. */

export function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
