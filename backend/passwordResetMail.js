/** Tạo bộ gửi mã khôi phục mật khẩu qua SMTP có TLS, giới hạn thời gian chờ và nội dung thư Việt/Anh/Nhật. */
import nodemailer from 'nodemailer';
import { normalizeLocale } from './locale.js';

const EMAIL = /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/;
const SMTP_TIMEOUT_MS = 10000;

/** Server-only SMTP settings. Creating the transport never connects or sends mail. */
export function createPasswordResetMailer({ env = process.env, createTransport = nodemailer.createTransport } = {}) {
  const host = env.SMTP_HOST?.trim() || 'smtp.gmail.com';
  const port = Number(env.SMTP_PORT || 465);
  const secureSetting = env.SMTP_SECURE?.trim().toLowerCase() || 'true';
  const user = env.SMTP_USER?.trim(), pass = env.SMTP_PASS?.trim(), from = env.SMTP_FROM?.trim() || user;
  const configured = Boolean(user && pass && from && EMAIL.test(user) && EMAIL.test(from)
    && !/[\s/\\\r\n]/.test(host) && Number.isInteger(port) && port > 0 && port <= 65535
    && ['true', 'false'].includes(secureSetting) && (port !== 465 || secureSetting === 'true'));
  return {
    configured,
    async sendReset({ to, token, locale = 'vi' }) {
      if (!configured || !EMAIL.test(to) || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('RESET_MAIL_UNAVAILABLE');
      // No URL, attachment, HTML interpolation or untrusted Host header is used.
      const transport = createTransport({ host, port, secure: secureSetting === 'true', requireTLS: true,
        auth: { user, pass }, tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
        connectionTimeout: SMTP_TIMEOUT_MS, greetingTimeout: SMTP_TIMEOUT_MS, socketTimeout: SMTP_TIMEOUT_MS,
        dnsTimeout: SMTP_TIMEOUT_MS, logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true });
      let timer;
      const copy = {
        vi: { subject: 'Mã khôi phục mật khẩu PAT', text: `Bạn vừa yêu cầu khôi phục mật khẩu PAT.\n\nSao chép toàn bộ mã dưới đây và dán vào ứng dụng:\n\n${token}\n\nMã có hiệu lực trong 10 phút và chỉ dùng được một lần.\nKhông chia sẻ mã này với bất kỳ ai. Nếu bạn không yêu cầu, hãy bỏ qua thư này; mật khẩu hiện tại không thay đổi.` },
        en: { subject: 'PAT password recovery code', text: `You requested a PAT password reset.\n\nCopy the entire code below and paste it into the app:\n\n${token}\n\nThis code expires in 10 minutes and can be used only once.\nDo not share it with anyone. If you did not request this, ignore this email; your current password has not changed.` },
        ja: { subject: 'PAT パスワード再設定コード', text: `PAT のパスワード再設定がリクエストされました。\n\n以下のコードをすべてコピーして、アプリに貼り付けてください。\n\n${token}\n\nコードの有効期限は10分間で、1回のみ使用できます。\nコードを他の人に教えないでください。心当たりがない場合は、このメールを無視してください。現在のパスワードは変更されていません。` },
      }[normalizeLocale(locale)];
      try {
        const result = await Promise.race([
          transport.sendMail({ from: { name: 'PAT', address: from }, to: { address: to },
            subject: copy.subject,
            // Keep the UTF-8 source intact and use an ASCII-safe MIME body on the wire.
            // Do not construct Vietnamese messages through a shell's stdin encoding.
            textEncoding: 'base64',
            text: copy.text }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('RESET_MAIL_TIMEOUT')), SMTP_TIMEOUT_MS); }),
        ]);
        if (!result?.accepted?.some(address => address.toLowerCase() === to.toLowerCase())) throw new Error('RESET_MAIL_REJECTED');
      } finally {
        clearTimeout(timer);
        transport.close?.();
      }
    },
  };
}
