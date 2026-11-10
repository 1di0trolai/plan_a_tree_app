/** Mở đăng nhập Google hoặc Facebook qua thư viện trên thiết bị, trả bằng chứng cho máy chủ xác minh và xóa phiên nhà cung cấp khi cần chọn lại tài khoản. */

import { Platform } from "react-native";
import { AccountAuthError, type SocialChallenge, type SocialCredential, type SocialProvider } from "./accountAuth";

type GoogleSdk = typeof import("@react-native-google-signin/google-signin");
type FacebookSdk = typeof import("react-native-fbsdk-next");
type Dependencies = {
  platform: string;
  webClientId?: string;
  iosClientId?: string;
  loadGoogle: () => Promise<GoogleSdk>;
  loadFacebook: () => Promise<FacebookSdk>;
};

function nativeUnavailable(): AccountAuthError {
  return new AccountAuthError("NATIVE_REQUIRED", "Bản cài hiện tại chưa hỗ trợ đăng nhập này. Hãy cài bản PAT mới; không dùng Expo Go.");
}

/** Only proof tokens leave this adapter. Identity is verified by the PAT server. */
export function createSocialLogin(dependencies: Dependencies) {
  return async (provider: SocialProvider, challenge?: SocialChallenge): Promise<SocialCredential | null> => {
    if (dependencies.platform !== "android" && dependencies.platform !== "ios")
      throw new AccountAuthError("PLATFORM_UNSUPPORTED", "Hãy đăng nhập Google hoặc Facebook trong ứng dụng PAT trên điện thoại.");
    if (provider === "google") {
      if (!dependencies.webClientId || (dependencies.platform === "ios" && !dependencies.iosClientId))
        throw new AccountAuthError("SOCIAL_NOT_CONFIGURED", "Bản cài chưa được cấu hình đăng nhập Google.");
      let sdk: GoogleSdk;
      try { sdk = await dependencies.loadGoogle(); } catch { throw nativeUnavailable(); }
      try {
        sdk.GoogleSignin.configure({ webClientId: dependencies.webClientId,
          ...(dependencies.iosClientId ? { iosClientId: dependencies.iosClientId } : {}), offlineAccess: false });
        if (dependencies.platform === "android") await sdk.GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
        // PAT may reject this identity even though Google accepted it. Clear only
        // this app's cached sign-in so the next tap can choose another account.
        await sdk.GoogleSignin.signOut();
        const result = await sdk.GoogleSignin.signIn();
        if (result.type === "cancelled") return null;
        if (!result.data.idToken) throw new AccountAuthError("SOCIAL_NOT_CONFIGURED", "Google chưa cấp mã xác thực. Kiểm tra Web Client ID của bản cài.");
        return { provider, tokenType: "id_token", token: result.data.idToken };
      } catch (error) {
        if (error instanceof AccountAuthError) throw error;
        if (sdk.isErrorWithCode(error)) {
          if (error.code === sdk.statusCodes.SIGN_IN_CANCELLED) return null;
          if (error.code === sdk.statusCodes.PLAY_SERVICES_NOT_AVAILABLE)
            throw new AccountAuthError("GOOGLE_SERVICES", "Hãy cài hoặc cập nhật Dịch vụ Google Play rồi thử lại.");
          if (error.code === sdk.statusCodes.IN_PROGRESS)
            throw new AccountAuthError("SOCIAL_BUSY", "Đăng nhập đang được xử lý. Vui lòng đợi.");
          if (error.code === "DEVELOPER_ERROR" || error.code === "10")
            throw new AccountAuthError("GOOGLE_CONFIGURATION", "Cấu hình Google chưa khớp. Kiểm tra tên gói, SHA-1 và Web Client ID của bản cài.");
        }
        throw new AccountAuthError("SOCIAL_SIGN_IN_FAILED", "Chưa đăng nhập được Google. Kiểm tra mạng rồi thử lại.");
      }
    }
    if (dependencies.platform === "ios" && !challenge)
      throw new AccountAuthError("SOCIAL_CHALLENGE_INVALID", "Chưa tạo được phiên xác thực Facebook. Hãy thử lại.");
    let sdk: FacebookSdk;
    try { sdk = await dependencies.loadFacebook(); } catch { throw nativeUnavailable(); }
    try {
      sdk.Settings.initializeSDK();
      // A new explicit attempt must not reuse a token bound to an old nonce/account.
      sdk.LoginManager.logOut();
      // Avoid silently reusing the account in the Facebook app. The web dialog
      // owns its account controls; this never signs the global Facebook app out.
      if (dependencies.platform === "android") sdk.LoginManager.setLoginBehavior("web_only");
      const result = await sdk.LoginManager.logInWithPermissions(["public_profile", "email"],
        dependencies.platform === "ios" ? "limited" : "enabled", challenge?.nonce);
      if (result.isCancelled) return null;
      if (dependencies.platform === "ios") {
        const proof = await sdk.AuthenticationToken.getAuthenticationTokenIOS();
        if (!proof?.authenticationToken) throw new Error("Missing authentication token");
        return { provider, tokenType: "authentication_token", token: proof.authenticationToken, challengeId: challenge!.challengeId };
      }
      const proof = await sdk.AccessToken.getCurrentAccessToken();
      if (!proof?.accessToken) throw new Error("Missing access token");
      return { provider, tokenType: "access_token", token: proof.accessToken };
    } catch {
      throw new AccountAuthError("SOCIAL_SIGN_IN_FAILED", "Chưa đăng nhập được Facebook. Kiểm tra mạng và cấu hình ứng dụng rồi thử lại.");
    }
  };
}

/** Discard a rejected native session without revoking provider permissions. */
export function createSocialSessionReset(dependencies: Dependencies) {
  return async (provider: SocialProvider): Promise<void> => {
    try {
      if (provider === "google") {
        const sdk = await dependencies.loadGoogle();
        await sdk.GoogleSignin.signOut();
      } else {
        const sdk = await dependencies.loadFacebook();
        sdk.LoginManager.logOut();
      }
    } catch {
      // Cleanup must not replace the PAT error that explains why login failed.
      // The next interactive attempt also resets its SDK session before login.
    }
  };
}

// Native packages are deliberately loaded only after a tap, never on app startup.
const dependencies: Dependencies = {
  platform: Platform.OS,
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim(),
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim(),
  loadGoogle: () => import("@react-native-google-signin/google-signin"),
  loadFacebook: () => import("react-native-fbsdk-next"),
};
export const startSocialLogin = createSocialLogin(dependencies);
export const resetSocialLoginSession = createSocialSessionReset(dependencies);
