/** Gọi API tài khoản cho đăng ký, đăng nhập, liên kết mạng xã hội và khôi phục mật khẩu. Lưu phiên và thông tin ghi nhớ bằng vùng lưu bảo mật riêng trên thiết bị. */

import * as SecureStore from "expo-secure-store";
import { isValidNewPassword, PASSWORD_REQUIREMENTS } from "../utils/passwordPolicy";
import { getLocale } from "../i18n/core";

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  hasPassword?: boolean;
  providers?: SocialProvider[];
}

export type SocialProvider = "google" | "facebook";
export interface SocialCredential {
  provider: SocialProvider;
  tokenType: "id_token" | "access_token" | "authentication_token";
  token: string;
  challengeId?: string;
}
export interface SocialChallenge { challengeId: string; nonce: string; expiresAt: string }

export interface AuthEnvelope {
  user: AuthUser;
  session: { token: string; expiresAt: string };
}

/** Device-only opt-in autofill. Never put this value in AppState or cloud data. */
export interface RememberedLogin { email: string; password?: string }

export interface AccountAuthPort {
  socialProviders(): Promise<Record<SocialProvider, boolean>>;
  socialChallenge(purpose: "login" | "link", token?: string): Promise<SocialChallenge>;
  socialLogin(credential: SocialCredential, remember: boolean): Promise<AuthEnvelope>;
  linkSocial(token: string, credential: SocialCredential): Promise<AuthUser>;
  login(email: string, password: string, remember: boolean): Promise<AuthEnvelope>;
  register(username: string, email: string, password: string): Promise<AuthEnvelope>;
  me(token: string): Promise<AuthUser>;
  updateProfile(token: string, username: string): Promise<AuthUser>;
  changePassword(token: string, currentPassword: string, newPassword: string): Promise<AuthEnvelope>;
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(token: string, newPassword: string): Promise<void>;
  logout(token: string): Promise<void>;
  loadSession(): Promise<AuthEnvelope | null>;
  saveSession(envelope: AuthEnvelope | null): Promise<void>;
  loadRememberedLogin(): Promise<RememberedLogin | null>;
  /** Omit password to preserve a matching credential; null explicitly removes it. */
  saveRememberedLogin(email: string | null, password?: string | null): Promise<void>;
}

export class AccountAuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "AccountAuthError";
  }
}

type SecureStorage = Pick<typeof SecureStore, "getItemAsync" | "setItemAsync" | "deleteItemAsync">;
type Dependencies = {
  baseUrl: string;
  fetch?: typeof fetch;
  secureStore?: SecureStorage;
  now?: () => number;
  allowInsecureDevelopment?: boolean;
};

const SESSION_KEY = "pat.account.session.v1";
const REMEMBERED_LOGIN_KEY = "pat.account.remembered-login.v1";
const REMEMBERED_PASSWORD_KEY = "pat.account.remembered-password.v1";
const SESSION_OPTIONS = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const MAX_RESPONSE_BYTES = 16_384;
const REQUEST_TIMEOUT_MS = 20_000;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const safeIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const controlPattern = /[\u0000-\u001f\u007f]/;

const messages: Record<string, string> = {
  INVALID_INPUT: "Thông tin chưa hợp lệ. Kiểm tra lại các ô đã nhập.",
  INVALID_EMAIL: "Nhập email đăng nhập hợp lệ.",
  INVALID_USERNAME: "Tên người dùng cần từ 2 đến 40 ký tự.",
  INVALID_PASSWORD: PASSWORD_REQUIREMENTS,
  INVALID_CREDENTIALS: "Email hoặc mật khẩu không đúng.",
  EMAIL_EXISTS: "Email này đã được đăng ký.",
  EMAIL_ALREADY_EXISTS: "Email này đã được đăng ký.",
  AUTH_REQUIRED: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
  INVALID_SESSION: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
  SESSION_EXPIRED: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
  UNAUTHORIZED: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
  CURRENT_PASSWORD_INVALID: "Mật khẩu hiện tại không đúng.",
  INVALID_CURRENT_PASSWORD: "Mật khẩu hiện tại không đúng.",
  CURRENT_PASSWORD_INCORRECT: "Mật khẩu hiện tại không đúng.",
  PASSWORD_UNCHANGED: "Mật khẩu mới cần khác mật khẩu hiện tại.",
  PASSWORD_TOO_WEAK: PASSWORD_REQUIREMENTS,
  RESET_NOT_CONFIGURED: "Máy chủ chưa cấu hình email khôi phục. Vui lòng thử lại sau.",
  RESET_TOKEN_INVALID: "Mã khôi phục không hợp lệ hoặc đã hết hạn. Hãy yêu cầu mã mới.",
  RESET_RATE_LIMITED: "Hãy đợi một phút trước khi yêu cầu mã khôi phục mới.",
  RATE_LIMITED: "Bạn đã thử quá nhiều lần. Hãy đợi một lúc rồi thử lại.",
  AUTH_RATE_LIMITED: "Bạn đã thử quá nhiều lần. Hãy đợi một lúc rồi thử lại.",
  AUTH_UNAVAILABLE: "Chưa thể kết nối tài khoản. Hãy thử lại sau.",
  SERVICE_UNAVAILABLE: "Chưa thể kết nối tài khoản. Hãy thử lại sau.",
  SOCIAL_LINK_REQUIRED: "Email này đã có tài khoản PAT. Hãy đăng nhập bằng email rồi liên kết trong Hồ sơ tài khoản.",
  SOCIAL_EMAIL_REQUIRED: "Dịch vụ chưa cung cấp email cần thiết. Hãy đăng nhập bằng email PAT rồi liên kết trong Hồ sơ tài khoản.",
  SOCIAL_NOT_CONFIGURED: "Máy chủ chưa cấu hình đăng nhập này. Vui lòng thử lại sau.",
  SOCIAL_SCHEMA_REQUIRED: "Máy chủ cần cập nhật cơ sở dữ liệu đăng nhập. Vui lòng thử lại sau.",
  SOCIAL_TOKEN_INVALID: "Phiên xác thực không hợp lệ hoặc đã hết hạn. Hãy đăng nhập lại.",
  SOCIAL_PROVIDER_ERROR: "Chưa xác thực được với nhà cung cấp. Hãy thử lại.",
  SOCIAL_PROVIDER_UNAVAILABLE: "Chưa kết nối được dịch vụ xác thực. Hãy thử lại sau.",
  INVALID_AUTH_REQUEST: "Thông tin xác thực chưa hợp lệ. Hãy đăng nhập lại.",
  SOCIAL_ALREADY_LINKED: "Tài khoản này đã được liên kết với một tài khoản PAT khác.",
  SOCIAL_CHALLENGE_INVALID: "Phiên xác thực đã hết hạn. Hãy thử lại.",
  SOCIAL_CHALLENGE_EXPIRED: "Phiên xác thực đã hết hạn. Hãy thử lại.",
  SOCIAL_IDENTITY_IN_USE: "Tài khoản Google hoặc Facebook này đã được liên kết với một tài khoản PAT khác.",
  SOCIAL_PROVIDER_ALREADY_LINKED: "Tài khoản PAT đã liên kết với nhà cung cấp này.",
  SOCIAL_PASSWORD_MANAGED: "Mật khẩu của tài khoản này được quản lý tại Google hoặc Facebook.",
  PASSWORD_NOT_AVAILABLE: "Mật khẩu của tài khoản này được quản lý tại Google hoặc Facebook.",
};

function invalidInput(message: string): never {
  throw new AccountAuthError("INVALID_INPUT", message);
}

function emailInput(value: string): string {
  const result = value.trim().toLowerCase();
  if (result.length > 254 || !emailPattern.test(result) || controlPattern.test(result))
    invalidInput("Nhập email đăng nhập hợp lệ.");
  return result;
}

function usernameInput(value: string): string {
  const result = value.trim();
  if (result.length < 2 || result.length > 40 || controlPattern.test(result))
    invalidInput("Tên người dùng cần từ 2 đến 40 ký tự.");
  return result;
}

function passwordInput(value: string, isNew = false): string {
  if (isNew ? !isValidNewPassword(value) : value.length < 1 || value.length > 128)
    invalidInput(isNew ? PASSWORD_REQUIREMENTS : "Nhập mật khẩu từ 1 đến 128 ký tự.");
  // Passwords are deliberately never trimmed or otherwise normalized.
  return value;
}

function assertToken(token: string): void {
  if (!tokenPattern.test(token))
    throw new AccountAuthError("INVALID_SESSION", messages.INVALID_SESSION);
}

function isLocalHost(host: string): boolean {
  if (host === "localhost" || host === "[::1]" || host.endsWith(".local")) return true;
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return false;
  return octets[0] === 127 || octets[0] === 10 ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31);
}

function validatedBaseUrl(value: string, allowInsecure: boolean): string {
  if (!value.trim())
    throw new AccountAuthError("NOT_CONFIGURED", "Chưa cấu hình địa chỉ máy chủ tài khoản.");
  let parsed: URL;
  try { parsed = new URL(value.trim()); }
  catch { throw new AccountAuthError("INVALID_URL", "Địa chỉ máy chủ tài khoản chưa hợp lệ."); }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/" ||
      !["http:", "https:"].includes(parsed.protocol))
    throw new AccountAuthError("INVALID_URL", "Địa chỉ máy chủ tài khoản chưa hợp lệ.");
  if (parsed.protocol !== "https:" && !(allowInsecure && isLocalHost(parsed.hostname)))
    throw new AccountAuthError("HTTPS_REQUIRED", "Kết nối tài khoản cần máy chủ HTTPS.");
  return parsed.origin;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validUser(value: unknown): AuthUser {
  if (!object(value) || typeof value.id !== "string" || !safeIdPattern.test(value.id) ||
      typeof value.email !== "string" || value.email.length > 254 ||
      !emailPattern.test(value.email) || controlPattern.test(value.email) ||
      typeof value.username !== "string" || value.username.trim() !== value.username ||
      value.username.length < 2 || value.username.length > 40 || controlPattern.test(value.username))
    throw new AccountAuthError("INVALID_RESPONSE", "Máy chủ trả thông tin tài khoản chưa hợp lệ.");
  if ((value.hasPassword !== undefined && typeof value.hasPassword !== "boolean") ||
      (value.providers !== undefined && (!Array.isArray(value.providers) ||
        value.providers.some(provider => provider !== "google" && provider !== "facebook"))))
    throw new AccountAuthError("INVALID_RESPONSE", "Máy chủ trả thông tin liên kết chưa hợp lệ.");
  return { id: value.id, email: value.email, username: value.username,
    ...(typeof value.hasPassword === "boolean" ? { hasPassword: value.hasPassword } : {}),
    ...(Array.isArray(value.providers) ? { providers: [...new Set(value.providers)] as SocialProvider[] } : {}),
  };
}

function socialInput(value: SocialCredential): SocialCredential {
  if (!["google", "facebook"].includes(value.provider) ||
      !["id_token", "access_token", "authentication_token"].includes(value.tokenType) ||
      typeof value.token !== "string" || value.token.length < 1 || value.token.length > 12_000 ||
      /\s/.test(value.token) || (value.challengeId !== undefined && !tokenPattern.test(value.challengeId)))
    invalidInput("Thông tin xác thực chưa hợp lệ. Hãy đăng nhập lại.");
  return { provider: value.provider, tokenType: value.tokenType, token: value.token,
    ...(value.challengeId ? { challengeId: value.challengeId } : {}) };
}

function validEnvelope(value: unknown, now: number): AuthEnvelope {
  if (!object(value) || !object(value.session) || typeof value.session.token !== "string" ||
      !tokenPattern.test(value.session.token) || typeof value.session.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(value.session.expiresAt)) || Date.parse(value.session.expiresAt) <= now)
    throw new AccountAuthError("INVALID_RESPONSE", "Máy chủ trả phiên đăng nhập chưa hợp lệ.");
  return {
    user: validUser(value.user),
    session: { token: value.session.token, expiresAt: value.session.expiresAt },
  };
}

async function readResponse(response: Response): Promise<unknown> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES)
    throw new AccountAuthError("INVALID_RESPONSE", "Phản hồi tài khoản vượt giới hạn cho phép.");
  let raw: string;
  // React Native may not expose a stream; still bound the decoded payload there.
  if (response.body?.getReader && typeof TextDecoder !== "undefined") {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    raw = "";
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          void reader.cancel().catch(() => undefined);
          throw new AccountAuthError("INVALID_RESPONSE", "Phản hồi tài khoản vượt giới hạn cho phép.");
        }
        raw += decoder.decode(part.value, { stream: true });
      }
      raw += decoder.decode();
    } finally { reader.releaseLock(); }
  } else raw = await response.text();
  if (raw.length > MAX_RESPONSE_BYTES)
    throw new AccountAuthError("INVALID_RESPONSE", "Phản hồi tài khoản vượt giới hạn cho phép.");
  try { return JSON.parse(raw); }
  catch { throw new AccountAuthError("INVALID_RESPONSE", "Máy chủ trả thông tin tài khoản chưa hợp lệ."); }
}

export function createAccountAuth(dependencies: Dependencies): AccountAuthPort {
  const fetchRequest = dependencies.fetch ?? fetch;
  const storage = dependencies.secureStore ?? SecureStore;
  const now = dependencies.now ?? Date.now;
  const allowInsecure = typeof __DEV__ !== "undefined" && __DEV__ &&
    (dependencies.allowInsecureDevelopment ?? true);

  async function request(path: "register" | "login" | "me" | "profile" | "password" | "logout" | "forgot-password" | "reset-password" | "social/providers" | "social/challenge" | "social/login" | "social/link",
    method: "GET" | "POST" | "PATCH", payload?: unknown, token?: string): Promise<unknown> {
    const baseUrl = validatedBaseUrl(dependencies.baseUrl, allowInsecure);
    if (token !== undefined) assertToken(token);
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new AccountAuthError("TIMEOUT", "Kết nối tài khoản quá lâu. Hãy thử lại."));
      }, REQUEST_TIMEOUT_MS);
    });
    try {
      return await Promise.race([deadline, (async () => {
        const response = await fetchRequest(`${baseUrl}/api/auth/${path}`, {
          method,
          headers: {
            Accept: "application/json",
            'Accept-Language': getLocale(),
            ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
          signal: controller.signal,
          credentials: "omit",
          redirect: "error",
        });
        const body = await readResponse(response);
        if (!response.ok) {
          const code = object(body) && object(body.error) && typeof body.error.code === "string"
            ? body.error.code : "";
          const fallback = response.status === 401 ? "INVALID_SESSION" : response.status === 429
            ? "RATE_LIMITED" : "AUTH_UNAVAILABLE";
          const safeCode = Object.hasOwn(messages, code) ? code : fallback;
          throw new AccountAuthError(safeCode, messages[safeCode], response.status);
        }
        return body;
      })()]);
    } catch (error) {
      if (error instanceof AccountAuthError) throw error;
      if (timedOut) throw new AccountAuthError("TIMEOUT", "Kết nối tài khoản quá lâu. Hãy thử lại.");
      throw new AccountAuthError("NETWORK", "Không kết nối được máy chủ tài khoản. Kiểm tra mạng rồi thử lại.");
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }

  async function saveSession(envelope: AuthEnvelope | null): Promise<void> {
    try {
      if (envelope === null) await storage.deleteItemAsync(SESSION_KEY, SESSION_OPTIONS);
      else await storage.setItemAsync(SESSION_KEY, JSON.stringify(validEnvelope(envelope, now())), SESSION_OPTIONS);
    } catch (error) {
      if (error instanceof AccountAuthError) throw error;
      throw new AccountAuthError("STORAGE", "Chưa lưu được phiên đăng nhập trên thiết bị. Hãy thử lại.");
    }
  }

  async function clearRememberedLogin(): Promise<void> {
    // Attempt both removals even if one native operation fails. A password is
    // only usable together with a valid, matching opt-in email record.
    const results = await Promise.allSettled([
      storage.deleteItemAsync(REMEMBERED_PASSWORD_KEY, SESSION_OPTIONS),
      storage.deleteItemAsync(REMEMBERED_LOGIN_KEY, SESSION_OPTIONS),
    ]);
    if (results.some(result => result.status === "rejected")) throw new Error("Secure storage unavailable");
  }

  async function saveRememberedLogin(email: string | null, password?: string | null): Promise<void> {
    const value = email === null ? null : { email: email === "" ? "" : emailInput(email) };
    const secret = typeof password === "string" ? passwordInput(password) : password;
    if (typeof secret === "string" && !value?.email) invalidInput("Nhập email trước khi ghi nhớ mật khẩu.");
    try {
      if (value === null) await clearRememberedLogin();
      else {
        const previous = await storage.getItemAsync(REMEMBERED_LOGIN_KEY, SESSION_OPTIONS);
        let sameEmail = false;
        try { sameEmail = previous !== null && JSON.parse(previous).email === value.email; } catch { /* Do not preserve malformed records. */ }
        if (secret !== undefined || !sameEmail)
          await storage.deleteItemAsync(REMEMBERED_PASSWORD_KEY, SESSION_OPTIONS);
        if (typeof secret === "string") await storage.setItemAsync(REMEMBERED_PASSWORD_KEY,
          JSON.stringify({ email: value.email, password: secret }), SESSION_OPTIONS);
        await storage.setItemAsync(REMEMBERED_LOGIN_KEY, JSON.stringify(value), SESSION_OPTIONS);
      }
    } catch {
      // Never leave a partially committed opt-in or a stale password available.
      await clearRememberedLogin().catch(() => {});
      throw new AccountAuthError("STORAGE", "Chưa lưu được lựa chọn ghi nhớ đăng nhập. Hãy thử lại.");
    }
  }

  return {
    async socialProviders() {
      const body = await request("social/providers", "GET");
      if (!object(body) || !object(body.providers) || typeof body.providers.google !== "boolean" || typeof body.providers.facebook !== "boolean")
        throw new AccountAuthError("INVALID_RESPONSE", "Máy chủ trả thông tin đăng nhập chưa hợp lệ.");
      return { google: body.providers.google, facebook: body.providers.facebook };
    },
    async socialChallenge(purpose, token) {
      if (purpose === "link" && !token) invalidInput("Vui lòng đăng nhập trước khi liên kết.");
      const body = await request("social/challenge", "POST", { purpose }, token);
      if (!object(body) || typeof body.challengeId !== "string" || !tokenPattern.test(body.challengeId) ||
          typeof body.nonce !== "string" || !tokenPattern.test(body.nonce) ||
          typeof body.expiresAt !== "string" || !Number.isFinite(Date.parse(body.expiresAt)) || Date.parse(body.expiresAt) <= now())
        throw new AccountAuthError("INVALID_RESPONSE", "Máy chủ trả phiên xác thực chưa hợp lệ.");
      return { challengeId: body.challengeId, nonce: body.nonce, expiresAt: body.expiresAt };
    },
    async socialLogin(credential, remember) {
      return validEnvelope(await request("social/login", "POST", { ...socialInput(credential), rememberMe: Boolean(remember) }), now());
    },
    async linkSocial(token, credential) {
      const body = await request("social/link", "POST", socialInput(credential), token);
      return validUser(object(body) ? body.user : undefined);
    },
    async login(email, password, remember) {
      const body = await request("login", "POST", {
        email: emailInput(email), password: passwordInput(password), rememberMe: Boolean(remember),
      });
      return validEnvelope(body, now());
    },
    async register(username, email, password) {
      const body = await request("register", "POST", {
        username: usernameInput(username), email: emailInput(email),
        password: passwordInput(password, true), rememberMe: false,
      });
      return validEnvelope(body, now());
    },
    async me(token) {
      const body = await request("me", "GET", undefined, token);
      return validUser(object(body) ? body.user : undefined);
    },
    async updateProfile(token, username) {
      const body = await request("profile", "PATCH", { username: usernameInput(username) }, token);
      return validUser(object(body) ? body.user : undefined);
    },
    async changePassword(token, currentPassword, newPassword) {
      const body = await request("password", "POST", {
        currentPassword: passwordInput(currentPassword), newPassword: passwordInput(newPassword, true),
      }, token);
      return validEnvelope(body, now());
    },
    async requestPasswordReset(email) {
      const body = await request("forgot-password", "POST", { email: emailInput(email) });
      if (!object(body) || body.ok !== true)
        throw new AccountAuthError("INVALID_RESPONSE", "Máy chủ chưa xác nhận yêu cầu khôi phục. Hãy thử lại.");
    },
    async resetPassword(token, newPassword) {
      const resetToken = token.trim();
      if (!tokenPattern.test(resetToken))
        throw new AccountAuthError("RESET_TOKEN_INVALID", messages.RESET_TOKEN_INVALID);
      const body = await request("reset-password", "POST", {
        token: resetToken, newPassword: passwordInput(newPassword, true),
      });
      if (!object(body) || body.ok !== true)
        throw new AccountAuthError("INVALID_RESPONSE", "Máy chủ chưa xác nhận đặt lại mật khẩu. Hãy thử lại.");
    },
    async logout(token) {
      const body = await request("logout", "POST", undefined, token);
      if (!object(body) || body.ok !== true)
        throw new AccountAuthError("INVALID_RESPONSE", "Máy chủ chưa xác nhận đăng xuất. Hãy thử lại.");
    },
    async loadSession() {
      let saved: string | null;
      try { saved = await storage.getItemAsync(SESSION_KEY, SESSION_OPTIONS); }
      catch { throw new AccountAuthError("STORAGE", "Chưa đọc được phiên đăng nhập trên thiết bị. Hãy thử lại."); }
      if (!saved) return null;
      try {
        if (saved.length > MAX_RESPONSE_BYTES) throw new Error("Invalid saved session");
        return validEnvelope(JSON.parse(saved), now());
      } catch {
        await saveSession(null);
        return null;
      }
    },
    saveSession,
    async loadRememberedLogin() {
      let saved: string | null; let credential: string | null;
      try {
        saved = await storage.getItemAsync(REMEMBERED_LOGIN_KEY, SESSION_OPTIONS);
        credential = await storage.getItemAsync(REMEMBERED_PASSWORD_KEY, SESSION_OPTIONS);
      }
      catch { throw new AccountAuthError("STORAGE", "Chưa đọc được lựa chọn ghi nhớ đăng nhập. Hãy thử lại."); }
      try {
        if (saved === null) {
          if (credential !== null) throw new Error("Credential without opt-in");
          return null;
        }
        if (saved.length > 512) throw new Error("Invalid login suggestion");
        const value: unknown = JSON.parse(saved);
        if (!object(value) || typeof value.email !== "string") throw new Error("Invalid login suggestion");
        const email = value.email === "" ? "" : emailInput(value.email);
        // Existing email-only opt-ins migrate naturally after the next
        // successful password login. Unknown fields in that old key are ignored.
        if (credential === null) return { email };
        if (credential.length > 2048) throw new Error("Invalid remembered credential");
        const secret: unknown = JSON.parse(credential);
        if (!email || !object(secret) || secret.email !== email ||
            typeof secret.password !== "string" || secret.password.length < 1 || secret.password.length > 128)
          throw new Error("Invalid remembered credential");
        return { email, password: secret.password };
      } catch {
        await saveRememberedLogin(null);
        throw new AccountAuthError("STORAGE", "Thông tin ghi nhớ không hợp lệ đã được xoá. Hãy thử mở lại và đăng nhập.");
      }
    },
    saveRememberedLogin,
  };
}

export const accountAuth = createAccountAuth({
  baseUrl: process.env.EXPO_PUBLIC_PAT_API_URL?.trim() ?? "",
});
