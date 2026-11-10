/**
 * Nối cấu hình Expo với bộ kiểm tra HTTPS và mã truy cập cho bản cài cá nhân; không đưa bí mật máy chủ vào cấu hình công khai.
 */

const { validatePersonalConfig } = require('./build/personalConfig');

module.exports = ({ config }) => {
  // EAS_BUILD_PROFILE is set on the builder, not during every local config read.
  // The explicit flag lets the same guard be checked locally without a cloud build.
  if (['personal', 'ios-simulator'].includes(process.env.EAS_BUILD_PROFILE) || process.env.PAT_PERSONAL_BUILD_CHECK === '1')
    validatePersonalConfig(process.env);
  return config;
};
