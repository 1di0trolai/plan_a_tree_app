/**
 * Thiết lập quy tắc ESLint theo Expo và bỏ qua đầu ra dist khi kiểm tra chất lượng mã nguồn.
 */

// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  }
]);
