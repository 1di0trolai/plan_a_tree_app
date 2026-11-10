/** Hiển thị các biểu mẫu đăng nhập, đăng ký và khôi phục mật khẩu, kèm ghi nhớ tài khoản và đăng nhập mạng xã hội. */

import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BrandArtwork } from "@/components/BrandArtwork";
import { PasswordRules } from "@/components/PasswordRules";
import { SocialProviderButton } from "@/components/SocialProviderButton";
import { useControlFocus } from "@/hooks/useControlFocus";
import { useI18n } from "@/i18n";
import { useApp } from "@/store/AppStore";
import { COLORS, GRADIENTS, INPUT, INTERACTION, LAYOUT, RADIUS, SPACING, TYPE } from "@/theme";
import { isValidNewPassword, PASSWORD_REQUIREMENTS } from "@/utils/passwordPolicy";
import type { SocialProvider } from "@/services/accountAuth";

type AuthMode = "login" | "register" | "forgot" | "reset";

const AUTH_COPY: Record<AuthMode, { title: string; action: string }> = {
  login: { title: "Mở khu vườn của bạn", action: "Vào khu vườn" },
  register: { title: "Tạo tài khoản", action: "Tạo tài khoản" },
  forgot: { title: "Quên mật khẩu", action: "Gửi mã khôi phục" },
  reset: { title: "Đặt lại mật khẩu", action: "Đặt mật khẩu mới" },
};

export default function AuthScreen() {
  const { state } = useApp();
  return (
    <AuthForm key={state.auth.loggedIn ? "active-session" : "signed-out"} />
  );
}

function AuthForm() {
  const { t } = useI18n();
  const focus = useControlFocus();
  const { ready, state, login, loginSocial, register, requestPasswordReset, resetPassword,
    rememberedEmail, rememberedPassword, rememberLogin, updateRememberLogin } = useApp();
  const [mode, setMode] = useState<AuthMode>("login");
  const [name, setName] = useState("");
  const [identity, setIdentity] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [message, setMessage] = useState<{
    type: "error" | "success";
    text: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [socialPending, setSocialPending] = useState<SocialProvider | null>(null);
  const [rememberPending, setRememberPending] = useState(false);
  const identityEdited = useRef(false);
  const passwordEdited = useRef(false);
  const passwordAutofilled = useRef(false);
  const rememberEdited = useRef(false);
  const rememberHydrated = useRef(false);
  const rememberOperation = useRef(false);
  const operation = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (ready && state.auth.loggedIn) router.replace("/garden");
  }, [ready, state.auth.loggedIn]);

  useEffect(() => {
    if (!ready || rememberHydrated.current) return;
    rememberHydrated.current = true;
    if (!identityEdited.current) setIdentity(rememberedEmail);
    if (!identityEdited.current && !passwordEdited.current && rememberLogin && rememberedPassword) {
      setPassword(rememberedPassword);
      passwordAutofilled.current = true;
    }
    if (!rememberEdited.current) setRemember(rememberLogin);
  }, [ready, rememberedEmail, rememberedPassword, rememberLogin]);

  const toggleRemember = async () => {
    if (operation.current || rememberOperation.current) return;
    rememberOperation.current = true;
    rememberEdited.current = true;
    const next = !remember;
    setRememberPending(true);
    try {
      const result = await updateRememberLogin(next);
      if (!mounted.current) return;
      if (result.ok) {
        setRemember(next);
        if (!next && passwordAutofilled.current) {
          setPassword("");
          passwordAutofilled.current = false;
        }
      }
      else setMessage({ type: "error", text: result.message ?? "Chưa lưu được lựa chọn ghi nhớ. Hãy thử lại." });
    } catch {
      if (mounted.current) setMessage({ type: "error", text: "Chưa lưu được lựa chọn ghi nhớ. Hãy thử lại." });
    } finally {
      rememberOperation.current = false;
      if (mounted.current) setRememberPending(false);
    }
  };

  const clearSecrets = () => {
    setPassword("");
    passwordAutofilled.current = false;
    setConfirmPassword("");
    setResetToken("");
    setShowPassword(false);
  };

  const switchMode = (nextMode: AuthMode) => {
    if (operation.current || rememberOperation.current) return;
    setMessage(null);
    clearSecrets();
    setMode(nextMode);
    if (nextMode === "login" && remember && rememberedPassword &&
        identity.trim().toLowerCase() === rememberedEmail.toLowerCase()) {
      setPassword(rememberedPassword);
      passwordAutofilled.current = true;
    }
  };

  const clearPasswordValidation = () => setMessage(previous =>
    previous?.type === "error" && [
      PASSWORD_REQUIREMENTS,
      "Nhập mật khẩu, tối đa 128 ký tự.",
      "Mật khẩu nhập lại chưa khớp.",
    ].includes(previous.text) ? null : previous,
  );

  const submit = async () => {
    if (operation.current || rememberOperation.current) return;
    setMessage(null);
    if (
      mode !== "reset" && (
        identity.trim().length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.trim())
      )
    ) {
      setMessage({
        type: "error",
        text: "Nhập email hợp lệ.",
      });
      return;
    }
    if (mode === "reset" && !/^[A-Za-z0-9_-]{43}$/.test(resetToken.trim())) {
      setMessage({ type: "error", text: "Dán đầy đủ mã khôi phục trong email." });
      return;
    }
    const createsPassword = mode === "register" || mode === "reset";
    if (createsPassword && !isValidNewPassword(password)) {
      setMessage({ type: "error", text: PASSWORD_REQUIREMENTS });
      return;
    }
    if (mode === "login" && (password.length > 128 || password.length < 1)) {
      setMessage({ type: "error", text: "Nhập mật khẩu, tối đa 128 ký tự." });
      return;
    }
    if (mode === "register" && (name.trim().length < 2 || name.trim().length > 40)) {
      setMessage({ type: "error", text: "Tên người dùng cần từ 2 đến 40 ký tự." });
      return;
    }
    if (createsPassword && confirmPassword !== password) {
      setMessage({ type: "error", text: "Mật khẩu nhập lại chưa khớp." });
      return;
    }
    operation.current = true;
    setSubmitting(true);
    try {
      if (mode === "forgot") {
        const result = await requestPasswordReset(identity.trim());
        if (!mounted.current) return;
        setMessage({ type: result.ok ? "success" : "error", text: result.message });
        if (result.ok) {
          clearSecrets();
          setMode("reset");
        }
      } else if (mode === "reset") {
        const result = await resetPassword(resetToken.trim(), password);
        if (!mounted.current) return;
        setMessage({ type: result.ok ? "success" : "error", text: result.message });
        if (result.ok) {
          clearSecrets();
          setMode("login");
        }
      } else if (mode === "register") {
        const result = await Promise.resolve(
          register(name.trim(), identity.trim(), password),
        );
        if (!mounted.current) return;
        if (!result.ok) {
          setMessage({
            type: "error",
            text: result.message ?? "Chưa thể tạo tài khoản.",
          });
          return;
        }
        router.replace("/garden");
      } else {
        const result = await Promise.resolve(
          login(identity.trim(), password, remember),
        );
        if (!mounted.current) return;
        if (!result.ok) {
          setMessage({
            type: "error",
            text: result.message ?? "Chưa thể đăng nhập.",
          });
          return;
        }
        router.replace("/garden");
      }
    } catch (cause) {
      if (!mounted.current) return;
      setMessage({
        type: "error",
        text: cause instanceof Error ? cause.message : "Chưa thể hoàn tất. Vui lòng thử lại.",
      });
    } finally {
      operation.current = false;
      if (mounted.current) setSubmitting(false);
    }
  };

  const submitSocial = async (provider: SocialProvider) => {
    if (operation.current || rememberOperation.current) return;
    operation.current = true;
    setSubmitting(true);
    setSocialPending(provider);
    setMessage(null);
    try {
      const result = await loginSocial(provider, remember);
      if (!mounted.current || result.cancelled) return;
      if (result.ok) { clearSecrets(); router.replace("/garden"); }
      else setMessage({ type: "error", text: result.message ?? "Chưa thể đăng nhập. Hãy thử lại." });
    } catch {
      if (mounted.current) setMessage({ type: "error", text: "Chưa thể đăng nhập. Hãy thử lại." });
    } finally {
      operation.current = false;
      if (mounted.current) { setSubmitting(false); setSocialPending(null); }
    }
  };

  if (!ready)
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={COLORS.primaryDark} />
      </View>
    );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View
            testID="auth-brand"
            style={styles.brand}
            accessible
            accessibilityRole="header"
            accessibilityLabel="PAT"
          >
            <BrandArtwork variant="logo" size={LAYOUT.authLogo} />
          </View>
          <View style={styles.form}>
            <Text style={styles.title}>{t(AUTH_COPY[mode].title)}</Text>
            {mode === "forgot" && (
              <Text style={styles.description}>{t("Nhập email đăng nhập để nhận mã khôi phục.")}</Text>
            )}
            {mode === "reset" && (
              <Text style={styles.description}>{t("Dán mã trong email. Mã có hiệu lực 10 phút và chỉ dùng một lần.")}</Text>
            )}
            {mode === "register" && (
              <Field label={t("Tên người dùng")}>
                <TextInput
                  {...focus.props("name")}
                  accessibilityLabel={t("Tên người dùng")}
                  value={name}
                  onChangeText={setName}
                  style={[styles.input, focus.style("name")]}
                  placeholder={t("Tên người dùng")}
                  underlineColorAndroid={COLORS.transparent}
                  placeholderTextColor={COLORS.textMuted}
                  autoCapitalize="words"
                  maxLength={40}
                  autoComplete="name"
                  editable={!submitting}
                />
              </Field>
            )}
            {mode !== "reset" && <Field
              label={t("Email đăng nhập")}
            >
              <TextInput
                {...focus.props("identity")}
                accessibilityLabel={t("Email đăng nhập")}
                value={identity}
                onChangeText={value => {
                  identityEdited.current = true;
                  setIdentity(value);
                  // Do not offer one account's saved secret for another email.
                  // Editing the form does not delete the encrypted saved login.
                  if (passwordAutofilled.current) { setPassword(""); passwordAutofilled.current = false; }
                }}
                style={[styles.input, focus.style("identity")]}
                placeholder="ban@example.com"
                underlineColorAndroid={COLORS.transparent}
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="username"
                autoComplete="email"
                maxLength={254}
                editable={!submitting}
              />
            </Field>}
            {mode === "reset" && (
              <Field label={t("Mã khôi phục")}>
                <TextInput
                  {...focus.props("reset-token")}
                  accessibilityLabel={t("Mã khôi phục")}
                  value={resetToken}
                  onChangeText={setResetToken}
                  style={[styles.input, focus.style("reset-token")]}
                  placeholder={t("Dán mã từ email")}
                  underlineColorAndroid={COLORS.transparent}
                  placeholderTextColor={COLORS.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={128}
                  editable={!submitting}
                />
              </Field>
            )}
            {mode !== "forgot" && <Field label={t(mode === "reset" ? "Mật khẩu mới" : "Mật khẩu")}>
                <TextInput
                  {...focus.props("password")}
                  accessibilityLabel={t(mode === "reset" ? "Mật khẩu mới" : "Mật khẩu")}
                  value={password}
                  onChangeText={value => {
                    passwordEdited.current = true;
                    passwordAutofilled.current = false;
                    setPassword(value);
                    clearPasswordValidation();
                  }}
                  style={[styles.input, styles.password, focus.style("password")]}
                  placeholder={t(mode !== "login" ? "Từ 8 đến 128 ký tự" : "Mật khẩu của bạn")}
                  underlineColorAndroid={COLORS.transparent}
                  placeholderTextColor={COLORS.textMuted}
                  secureTextEntry={!showPassword}
                  textContentType={
                    mode === "login" ? "password" : "newPassword"
                  }
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={128}
                  editable={!submitting}
                />
                <Pressable
                  {...focus.props("password-visibility")}
                  accessibilityRole="button"
                  accessibilityLabel={
                    t(showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu")
                  }
                  onPress={() => setShowPassword((value) => !value)}
                  disabled={submitting}
                  accessibilityState={{ disabled: submitting }}
                  style={({ pressed }) => [
                    styles.eye,
                    pressed && styles.pressed,
                    focus.style("password-visibility"),
                  ]}
                >
                  <Ionicons
                    name={showPassword ? "eye-off-outline" : "eye-outline"}
                    size={LAYOUT.smallIcon}
                    color={COLORS.textMuted}
                  />
                </Pressable>
            </Field>}
            {(mode === "register" || mode === "reset") && (
              <PasswordRules value={password} />
            )}
            {(mode === "register" || mode === "reset") && (
              <Field label={t("Nhập lại mật khẩu")}>
                <TextInput
                  {...focus.props("confirm-password")}
                  accessibilityLabel={t("Nhập lại mật khẩu")}
                  value={confirmPassword}
                  onChangeText={value => { setConfirmPassword(value); clearPasswordValidation(); }}
                  style={[styles.input, focus.style("confirm-password")]}
                  placeholder={t("Nhập lại mật khẩu")}
                  underlineColorAndroid={COLORS.transparent}
                  placeholderTextColor={COLORS.textMuted}
                  secureTextEntry={!showPassword}
                  textContentType="newPassword"
                  autoComplete="new-password"
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={128}
                  editable={!submitting}
                />
              </Field>
            )}
            {mode === "login" && (
              <View style={styles.options}>
                <Pressable
                  {...focus.props("remember")}
                  accessibilityRole="checkbox"
                  accessibilityLabel={t("Ghi nhớ đăng nhập")}
                  accessibilityState={{ checked: remember, disabled: submitting || rememberPending, busy: rememberPending }}
                  disabled={submitting || rememberPending}
                  onPress={() => void toggleRemember()}
                  style={({ pressed }) => [
                    styles.optionButton,
                    pressed && styles.pressed,
                    focus.style("remember"),
                  ]}
                >
                  <Ionicons
                    name={remember ? "checkbox" : "square-outline"}
                    size={LAYOUT.smallIcon}
                    color={remember ? COLORS.primaryDark : COLORS.textMuted}
                  />
                  <Text style={styles.optionText}>{t("Ghi nhớ đăng nhập")}</Text>
                </Pressable>
                <Pressable
                  {...focus.props("forgot-password")}
                  accessibilityRole="button"
                  accessibilityLabel={t("Quên mật khẩu?")}
                  accessibilityState={{ disabled: submitting }}
                  disabled={submitting}
                  onPress={() => switchMode("forgot")}
                  style={({ pressed }) => [styles.optionButton, pressed && styles.pressed, focus.style("forgot-password")]}
                >
                  <Text style={styles.link}>{t("Quên mật khẩu?")}</Text>
                </Pressable>
              </View>
            )}
            {message && (
              <Text
                accessibilityLiveRegion="polite"
                style={[
                  styles.message,
                  message.type === "error" && styles.error,
                ]}
              >
                {t(message.text)}
              </Text>
            )}
            <Pressable
              {...focus.props("submit")}
              accessibilityRole="button"
              accessibilityLabel={t(AUTH_COPY[mode].action)}
              accessibilityState={{ disabled: submitting || rememberPending, busy: submitting }}
              onPress={() => void submit()}
              disabled={submitting || rememberPending}
              style={({ pressed }) => [
                styles.primary,
                pressed && styles.pressed,
                submitting && styles.disabled,
                focus.style("submit"),
              ]}
            >
              {submitting ? (
                <ActivityIndicator color={COLORS.onAction} />
              ) : (
                <>
                  <Text style={styles.primaryText}>
                    {t(AUTH_COPY[mode].action)}
                  </Text>
                  <Ionicons
                    name="arrow-forward"
                    size={LAYOUT.smallIcon}
                    color={COLORS.onAction}
                  />
                </>
              )}
            </Pressable>
            {(mode === "login" || mode === "register") && (
              <View style={styles.socialOptions}>
                <View style={styles.socialDivider} accessible={false}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.optionText}>{t("hoặc")}</Text>
                  <View style={styles.dividerLine} />
                </View>
                {(["google", "facebook"] as const).map(provider => (
                  <SocialProviderButton key={provider}
                    provider={provider}
                    disabled={submitting || rememberPending}
                    loading={socialPending === provider}
                    onPress={() => void submitSocial(provider)}
                  />
                ))}
              </View>
            )}
            {mode === "reset" && (
              <Pressable
                {...focus.props("resend-reset")}
                accessibilityRole="button"
                accessibilityLabel={t("Gửi lại mã")}
                accessibilityState={{ disabled: submitting }}
                disabled={submitting}
                onPress={() => switchMode("forgot")}
                style={({ pressed }) => [styles.switchMode, pressed && styles.pressed, focus.style("resend-reset")]}
              >
                <Text style={styles.link}>{t("Gửi lại mã")}</Text>
              </Pressable>
            )}
            <Pressable
              {...focus.props("switch-mode")}
              accessibilityRole="button"
              accessibilityLabel={t(mode === "login" ? "Tạo tài khoản" : "Quay lại đăng nhập")}
              accessibilityState={{ disabled: submitting }}
              onPress={() =>
                switchMode(mode === "login" ? "register" : "login")
              }
              disabled={submitting}
              style={({ pressed }) => [
                styles.switchMode,
                pressed && styles.pressed,
                focus.style("switch-mode"),
              ]}
            >
              <Text style={styles.optionText}>
                {mode === "login" ? `${t("Chưa có tài khoản?")} ` : ""}
                <Text style={styles.link}>
                  {t(mode === "login" ? "Tạo tài khoản" : "Quay lại đăng nhập")}
                </Text>
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.field}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: COLORS.background, ...GRADIENTS.ambient },
  loading: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xl,
    width: "100%",
    maxWidth: LAYOUT.formMaxWidth,
    alignSelf: "center",
  },
  brand: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: SPACING.xl,
  },
  form: { gap: SPACING.md },
  title: {
    ...TYPE.headline,
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  description: { ...TYPE.subhead, color: COLORS.textMuted },
  fieldWrap: { gap: SPACING.sm },
  label: { ...TYPE.label, color: COLORS.text },
  field: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.controlBorder,
    borderRadius: RADIUS.md,
    borderCurve: "continuous",
    backgroundColor: COLORS.surface,
    minHeight: LAYOUT.control,
  },
  input: {
    flex: 1,
    ...INPUT.singleLine,
    minWidth: 0,
    borderRadius: RADIUS.md,
    borderCurve: "continuous",
  },
  password: { paddingRight: 0 },
  eye: {
    width: LAYOUT.touch,
    minHeight: LAYOUT.control,
    alignItems: "center",
    justifyContent: "center",
  },
  options: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: SPACING.sm,
    marginTop: -SPACING.sm,
    marginBottom: -SPACING.sm,
  },
  optionButton: {
    minHeight: LAYOUT.touch,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    borderRadius: RADIUS.sm,
    borderCurve: "continuous",
  },
  optionText: { ...TYPE.subhead, color: COLORS.textMuted },
  link: { ...TYPE.label, color: COLORS.primaryDark },
  message: { ...TYPE.subhead, color: COLORS.primaryDark },
  error: { color: COLORS.danger },
  primary: {
    minHeight: LAYOUT.control,
    borderRadius: RADIUS.md,
    borderCurve: "continuous",
    backgroundColor: COLORS.actionSurface,
    ...GRADIENTS.action,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: SPACING.compact,
    padding: SPACING.md,
  },
  primaryText: { ...TYPE.label, color: COLORS.onAction, flexShrink: 1 },
  socialOptions: { gap: SPACING.sm },
  socialDivider: { flexDirection: "row", alignItems: "center", gap: SPACING.compact, paddingVertical: SPACING.xs },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: COLORS.border },
  pressed: { opacity: INTERACTION.pressedOpacity },
  disabled: { opacity: INTERACTION.disabledOpacity },
  switchMode: {
    minHeight: LAYOUT.touch,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -SPACING.xs,
  },
});
