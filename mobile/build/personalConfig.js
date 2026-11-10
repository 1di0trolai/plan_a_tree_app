/**
 * Kiểm tra URL API HTTPS và mã truy cập trước khi build; chỉ xác thực cấu hình, không trả bí mật vào cấu hình công khai của Expo.
 */
function validatePersonalConfig(env) {
  const rawUrl = env.EXPO_PUBLIC_PAT_API_URL?.trim();
  let url;
  try { url = new URL(rawUrl); }
  catch { throw new Error('APK cá nhân cần EXPO_PUBLIC_PAT_API_URL là địa chỉ HTTPS hợp lệ trong môi trường preview.'); }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (url.protocol !== 'https:' || url.username || url.password || rawUrl.includes('?') || rawUrl.includes('#') || url.pathname !== '/')
    throw new Error('APK cá nhân cần URL HTTPS gốc, không kèm /api, mật khẩu, query hoặc fragment.');
  if (['localhost', 'localhost.localdomain', '[::1]', '[::]', '0.0.0.0'].includes(host)
    || host.endsWith('.localhost') || /^127\./.test(host) || /^\[::ffff:(?:7f[0-9a-f]{2}:|0:0\])/.test(host))
    throw new Error('APK trên điện thoại không gọi được localhost của máy tính. Hãy dùng URL HTTPS riêng của máy chủ.');
  const token = env.EXPO_PUBLIC_PAT_API_TOKEN?.trim() ?? '';
  if (token.length < 24 || /[^\x21-\x7e]/.test(token))
    throw new Error('APK cá nhân cần EXPO_PUBLIC_PAT_API_TOKEN từ 24 ký tự ASCII không có khoảng trắng, khớp API_AUTH_TOKEN trên máy chủ.');
}

module.exports = { validatePersonalConfig };
