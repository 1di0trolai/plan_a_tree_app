/** Xác minh chứng thực Google/Facebook với chữ ký, ứng dụng nhận và nonce phù hợp; chỉ trả hồ sơ tối thiểu, không lưu token nhà cung cấp. */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
import { ApiError } from './contracts.js';

const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const FACEBOOK_JWKS = 'https://limited.facebook.com/.well-known/oauth/openid/jwks/';
const FACEBOOK_GRAPH = 'https://graph.facebook.com/v26.0/';
const MAX_PROVIDER_RESPONSE = 64 * 1024;
const MAX_TOKEN_LENGTH = 12 * 1024;

function invalidToken() {
  return new ApiError(401, 'SOCIAL_TOKEN_INVALID', 'Phiên đăng nhập Google hoặc Facebook không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.');
}
function providerFailure() {
  return new ApiError(502, 'SOCIAL_PROVIDER_ERROR', 'Chưa thể xác minh với Google hoặc Facebook. Vui lòng thử lại sau.');
}
function providerUnavailable() {
  return new ApiError(503, 'SOCIAL_PROVIDER_UNAVAILABLE', 'Phương thức đăng nhập này chưa được cấu hình trên máy chủ.');
}
function validSubject(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 255 && !/[\s\u0000-\u001f\u007f]/.test(value);
}
function profileEmail(value) {
  if (typeof value !== 'string' || value.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null;
  return value.toLowerCase();
}
function profileName(value, provider) {
  if (typeof value !== 'string') return `Người dùng ${provider === 'google' ? 'Google' : 'Facebook'}`;
  const name = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return [...name].length >= 2 ? [...name].slice(0, 40).join('') : `Người dùng ${provider === 'google' ? 'Google' : 'Facebook'}`;
}
function sameNonce(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || expected.length < 16 || expected.length > 256) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Verify provider credentials only. Session creation, identity linking and nonce replay
 * protection belong to the account service; provider tokens are never stored here. */
export function createSocialIdentityVerifier({
  googleClientIds = [], facebookAppId = '', facebookAppSecret = '',
  fetchImpl = globalThis.fetch, now = () => new Date(), timeoutMs = 10_000,
  googleJwks, facebookJwks,
} = {}) {
  const audiences = [...new Set((Array.isArray(googleClientIds) ? googleClientIds : [googleClientIds])
    .filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
  const appId = typeof facebookAppId === 'string' ? facebookAppId.trim() : '';
  const appSecret = typeof facebookAppSecret === 'string' ? facebookAppSecret.trim() : '';
  const requestTimeout = Number.isSafeInteger(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 30_000) : 10_000;
  const availability = () => ({ google: audiences.length > 0, facebook: /^\d+$/.test(appId) && appSecret.length > 0 });
  const keyOptions = {
    timeoutDuration: requestTimeout,
    cacheMaxAge: 10 * 60_000,
    cooldownDuration: 30_000,
    [customFetch]: async (url, options) => {
      try {
        return await fetchImpl(url, { ...options, redirect: 'error' });
      } catch {
        throw providerFailure();
      }
    },
  };
  const googleKeys = googleJwks ?? createRemoteJWKSet(new URL(GOOGLE_JWKS), keyOptions);
  const facebookKeys = facebookJwks ?? createRemoteJWKSet(new URL(FACEBOOK_JWKS), keyOptions);

  async function verifyJwt(token, provider, nonce) {
    const limited = provider === 'facebook';
    const options = {
      algorithms: ['RS256'],
      issuer: limited ? 'https://www.facebook.com' : ['accounts.google.com', 'https://accounts.google.com'],
      audience: limited ? appId : audiences,
      requiredClaims: ['sub', 'exp', 'iat', ...(limited ? ['nonce'] : [])],
      currentDate: now(),
      clockTolerance: 5,
    };
    const { payload } = await jwtVerify(token, limited ? facebookKeys : googleKeys, options);
    if (!validSubject(payload.sub) || (typeof payload.iat !== 'number')
      || payload.iat > now().getTime() / 1000 + 5 || (limited && !sameNonce(payload.nonce, nonce))) throw invalidToken();
    // Native Google sign-in may name the Android/iOS client in azp while aud is
    // the configured server Web client. The signed aud, not azp, binds this API.
    const email = profileEmail(payload.email);
    return {
      provider, subject: payload.sub, email,
      // Facebook supplies an email with permission, but no email_verified claim.
      // Do not mark its address as independently verified in the PAT database.
      emailVerified: !limited && Boolean(email) && payload.email_verified === true,
      username: profileName(payload.name, provider),
    };
  }

  async function graphRequest(path, parameters, bearer) {
    const url = new URL(path, FACEBOOK_GRAPH);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    const signal = AbortSignal.timeout(requestTimeout);
    let response;
    try {
      response = await fetchImpl(url, { method: 'GET', headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' }, signal, redirect: 'error' });
      if (!response.ok) {
        if ([400, 401, 403].includes(response.status)) throw invalidToken();
        throw providerFailure();
      }
      if (Number(response.headers.get('content-length')) > MAX_PROVIDER_RESPONSE) throw providerFailure();
      const text = await response.text();
      if (Buffer.byteLength(text) > MAX_PROVIDER_RESPONSE) throw providerFailure();
      const result = JSON.parse(text);
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw providerFailure();
      if (result.error) throw invalidToken();
      return result;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw providerFailure(); // Never include the upstream URL, token, secret or response.
    }
  }

  async function verifyFacebookAccess(token) {
    const { data } = await graphRequest('debug_token', { input_token: token }, `${appId}|${appSecret}`);
    const seconds = now().getTime() / 1000;
    if (!data || data.is_valid !== true || String(data.app_id) !== appId || data.type !== 'USER'
      || !validSubject(data.user_id) || !Number.isFinite(data.expires_at) || data.expires_at <= seconds
      || (data.data_access_expires_at !== undefined && (!Number.isFinite(data.data_access_expires_at)
        || (data.data_access_expires_at !== 0 && data.data_access_expires_at <= seconds)))) throw invalidToken();
    const proof = createHmac('sha256', appSecret).update(token).digest('hex');
    const profile = await graphRequest('me', { fields: 'id,name,email', appsecret_proof: proof }, token);
    if (profile.id !== data.user_id) throw invalidToken();
    const email = profileEmail(profile.email);
    return { provider: 'facebook', subject: profile.id, email, emailVerified: false, username: profileName(profile.name, 'facebook') };
  }

  return {
    availability,
    async verify(input) {
      if (!input || typeof input !== 'object' || !['google', 'facebook'].includes(input.provider)
        || typeof input.token !== 'string' || !input.token || input.token.length > MAX_TOKEN_LENGTH || /\s/.test(input.token)
        || (input.provider === 'google' ? input.tokenType !== 'id_token' : !['access_token', 'authentication_token'].includes(input.tokenType)))
        throw new ApiError(400, 'INVALID_AUTH_REQUEST', 'Thông tin đăng nhập Google hoặc Facebook không hợp lệ.');
      if (!availability()[input.provider]) throw providerUnavailable();
      try {
        return input.tokenType === 'access_token'
          ? await verifyFacebookAccess(input.token)
          : await verifyJwt(input.token, input.provider, input.nonce);
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (['ERR_JWKS_TIMEOUT', 'ERR_JWKS_INVALID'].includes(error?.code) || error?.code === 'ERR_JOSE_GENERIC') throw providerFailure();
        throw invalidToken();
      }
    },
  };
}
