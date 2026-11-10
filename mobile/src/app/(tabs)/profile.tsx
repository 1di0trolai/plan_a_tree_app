/** Quản lý hồ sơ tài khoản, mật khẩu, liên kết đăng nhập và các tùy chỉnh cá nhân. */

import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ComponentRef,
} from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { JourneyButton } from "@/components/journeyUI";
import { LanguageSelector } from "@/components/LanguageSelector";
import { PasswordRules } from "@/components/PasswordRules";
import { SocialProviderButton } from "@/components/SocialProviderButton";
import { UnreadDot } from "@/components/UnreadDot";
import { useControlFocus } from "@/hooks/useControlFocus";
import { usePreferenceStatus } from "@/hooks/usePreferenceStatus";
import { useI18n } from "@/i18n";
import { GardenerAvatar, OUTFITS } from "@/screens/profile/GardenerAvatar";
import { requestReminderPermission } from "@/services/preferences";
import { useApp } from "@/store/AppStore";
import { isValidNewPassword, PASSWORD_REQUIREMENTS } from "@/utils/passwordPolicy";
import {
  COLORS,
  GRADIENTS,
  INPUT,
  INTERACTION,
  LAYOUT,
  RADIUS,
  SPACING,
  TYPE,
} from "@/theme";
import { validateAccountProfile } from "@/utils/profilePreferences";
import type { SocialProvider } from "@/services/accountAuth";

type Sheet =
  | "account"
  | "password"
  | "wardrobe"
  | "help"
  | "privacy"
  | "about"
  | null;
type IconName = ComponentProps<typeof Ionicons>["name"];
const titles = {
  account: "Hồ sơ tài khoản",
  password: "Đổi mật khẩu",
  wardrobe: "Tủ đồ của bạn",
  help: "Chăm cây cùng PAT",
  privacy: "Dữ liệu & quyền riêng tư",
  about: "Về PAT",
};
const information = {
  help: [
    "Thêm cây vào Vườn bằng ảnh hoặc nhập thủ công. Với quả và hạt, chọn giai đoạn phù hợp rồi bắt đầu trồng khi bạn sẵn sàng.",
    "Mở Quét cây, đưa cây vào khung rồi xác nhận cây được nhận diện. PAT lưu ảnh, tình trạng và hướng chăm sóc vào trò chuyện. Nếu chưa nhận ra, chọn cây trong vườn rồi quét lại để kiểm tra. Kiểm tra đủ cây trong nhiệm vụ hôm nay để nhận một gói thẻ thú nuôi.",
    "Thú nuôi và thức ăn nằm trong Kho đồ. Cho thú nuôi ăn để tăng kinh nghiệm. Cây được chăm ngoài đời, không dùng vật phẩm trong ứng dụng. Nhận xét trợ lý thông minh chỉ để tham khảo.",
  ],
  privacy: [
    "Ảnh, cây và tiến trình được lưu trên thiết bị và đồng bộ riêng theo tài khoản lên máy chủ của bạn. Trước khi chuyển máy, hãy chờ đồng bộ thành công; phần còn chờ gửi chưa được sao lưu.",
    "Khi dùng trợ lý thông minh, ảnh và thông tin liên quan được gửi qua máy chủ đến Gemini. Khóa kết nối chỉ nằm ở máy chủ. Tránh chụp dữ liệu riêng tư không cần thiết.",
    "Nhạc nền được tích hợp sẵn trong PAT và không cần tải từ mạng. Lời nhắc được lên lịch trên thiết bị, không dùng dịch vụ thông báo đẩy từ máy chủ.",
  ],
  about: [
    "PAT giúp bạn chăm cây thật mỗi ngày: lưu hành trình, kiểm tra bằng ảnh và hỏi trợ lý thông minh về từng cây. Sưu tầm thú nuôi là phần thưởng cho thói quen chăm vườn.",
    "Người chăm vườn là nhân vật đại diện riêng của bạn. Chọn một trong ba bộ trang phục miễn phí để thể hiện phong cách của mình.",
    "Ứng dụng dành cho Android và iOS. Đấu trường sắp ra mắt.",
  ],
};

export default function ProfileScreen() {
  const { t } = useI18n();
  const {
    state,
    updateProfile,
    updateAccountProfile,
    changePassword,
    linkSocial,
    account,
    updateSetting,
    persistNow,
    logout,
  } = useApp();
  const hasUnreadMail = state.mailbox.some((mail) => !mail.readAt);
  const focus = useControlFocus();
  const { musicError, reminderError } = usePreferenceStatus();
  const isFocused = useIsFocused();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [draft, setDraft] = useState(state.profile);
  const [stageVisible, setStageVisible] = useState(true);
  const [previewVisible, setPreviewVisible] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [musicSaveError, setMusicSaveError] = useState("");
  const [notificationSaveError, setNotificationSaveError] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [linkMessage, setLinkMessage] = useState("");
  const [linkPending, setLinkPending] = useState<SocialProvider | null>(null);
  const mounted = useRef(true);
  const operation = useRef(false);
  const stageBottom = useRef(0);
  const previewBottom = useRef(0);
  const sheetScroll = useRef<ComponentRef<typeof ScrollView>>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const openSheet = (next: Sheet) => {
    if (operation.current) return;
    setDraft(state.profile);
    setError("");
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordMessage("");
    setLinkMessage("");
    setPreviewVisible(true);
    setSheet(next);
  };
  const closeSheet = () => {
    if (!operation.current) {
      setSheet(null);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
  };
  const run = async (
    task: () => Promise<void>,
    onError: (message: string) => void = setError,
  ) => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (cause) {
      if (!mounted.current) return;
      onError(
        cause instanceof Error
          ? cause.message
          : "Chưa thể lưu thay đổi. Vui lòng thử lại.",
      );
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const saveAccount = () =>
    void run(async () => {
      const validation = validateAccountProfile({
        name: draft.name,
        phone: draft.phone,
      });
      if (!validation.ok) throw new Error(validation.message);
      const result = await updateAccountProfile(validation.value);
      if (!result.ok)
        throw new Error(result.message || "Hãy kiểm tra thông tin hồ sơ.");
      if (mounted.current) setSheet(null);
    });
  const savePassword = () => {
    if (operation.current) return;
    setPasswordMessage("");
    if (!currentPassword || currentPassword.length > 128) {
      setError("Nhập mật khẩu hiện tại, tối đa 128 ký tự.");
      return;
    }
    if (!isValidNewPassword(newPassword)) {
      setError(PASSWORD_REQUIREMENTS);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Mật khẩu nhập lại chưa khớp.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("Mật khẩu mới cần khác mật khẩu hiện tại.");
      return;
    }
    void run(async () => {
      const result = await changePassword(currentPassword, newPassword);
      if (!result.ok) throw new Error(result.message || "Chưa thể đổi mật khẩu.");
      if (!mounted.current) return;
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage(result.message || "Đã đổi mật khẩu.");
    });
  };
  const connectSocial = (provider: SocialProvider) => void run(async () => {
    setLinkMessage("");
    setLinkPending(provider);
    try {
      const result = await linkSocial(provider);
      if (result.cancelled) return;
      if (!result.ok) throw new Error(result.message ?? "Chưa thể liên kết tài khoản.");
      if (mounted.current) setLinkMessage(result.message ?? "Đã liên kết tài khoản.");
    } finally {
      if (mounted.current) setLinkPending(null);
    }
  });
  const clearPasswordValidation = () => setError(previous => [
    PASSWORD_REQUIREMENTS,
    "Nhập mật khẩu hiện tại, tối đa 128 ký tự.",
    "Mật khẩu nhập lại chưa khớp.",
    "Mật khẩu mới cần khác mật khẩu hiện tại.",
  ].includes(previous) ? "" : previous);
  const toggleMusic = (enabled: boolean) => {
    if (operation.current) return;
    setMusicSaveError("");
    void run(async () => {
      updateSetting("musicConsent", true);
      updateSetting("music", enabled);
      await persistNow();
    }, setMusicSaveError);
  };
  const toggleNotifications = (enabled: boolean) => {
    if (operation.current) return;
    setNotificationSaveError("");
    void run(async () => {
      const allowed = !enabled || (await requestReminderPermission());
      updateSetting("notificationConsent", true);
      updateSetting("notifications", enabled && allowed);
      await persistNow();
      if (!allowed)
        throw new Error(
          "Quyền thông báo chưa được cấp. Bật quyền cho PAT trong Cài đặt hệ thống rồi thử lại.",
        );
    }, setNotificationSaveError);
  };
  const confirmLogout = () =>
    Alert.alert(
      t("Đăng xuất?"),
      t("Tiến trình vẫn được giữ trên thiết bị. Nhạc và lời nhắc sẽ dừng cho đến khi đăng nhập lại."),
      [
        { text: t("Ở lại"), style: "cancel" },
        {
          text: t("Đăng xuất"),
          onPress: () => {
            logout();
            router.replace("/");
          },
        },
      ],
    );
  const currentOutfit =
    OUTFITS.find((outfit) => outfit.id === state.profile.outfit) ?? OUTFITS[0];
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={100}
        onScroll={(event) =>
          setStageVisible(
            event.nativeEvent.contentOffset.y < stageBottom.current,
          )
        }
      >
        <View style={styles.pageHeader}>
          <View style={styles.flex}>
            <Text style={styles.eyebrow}>{t("NGƯỜI CHĂM VƯỜN")}</Text>
            <Text style={styles.name}>
              {state.profile.name.trim() || t("Người chăm cây")}
            </Text>
          </View>
        </View>
        <View
          style={styles.characterStage}
          onLayout={(event) => {
            stageBottom.current =
              event.nativeEvent.layout.y + event.nativeEvent.layout.height;
          }}
        >
          <View style={styles.characterArt}>
            <View style={styles.sun} accessible={false} />
            <View style={styles.waterGlow} accessible={false} />
            <GardenerAvatar
              outfit={state.profile.outfit}
              size={192}
              animated={isFocused && !sheet && stageVisible}
            />
          </View>
          <View style={styles.stageActions}>
            <View style={styles.outfitSummary}>
              <Text style={styles.caption}>{t("Trang phục hiện tại")}</Text>
              <Text style={styles.rowText}>{t(currentOutfit.name)}</Text>
            </View>
            <JourneyButton
              title={t("Trang phục")}
              icon="shirt-outline"
              onPress={() => openSheet("wardrobe")}
              size="sm"
              style={{ marginTop: 0 }}
            />
          </View>
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t("Cài đặt của bạn")}</Text>
          <View style={styles.group}>
            <MenuRow
              icon="person-outline"
              label={t("Hồ sơ tài khoản")}
              detail={t("Tên, email & mật khẩu")}
              onPress={() => openSheet("account")}
            />
            <MenuRow
              icon="mail-outline"
              label={t("Hòm thư")}
              unread={hasUnreadMail}
              onPress={() => router.push("/mailbox")}
            />
            <Toggle
              icon="musical-notes-outline"
              label={t("Âm thanh nền")}
              value={state.settings.music}
              disabled={busy}
              onValueChange={toggleMusic}
            />
            {(musicSaveError || musicError) && (
              <Text
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                style={[styles.error, styles.soundError]}
              >
                {t(musicSaveError || musicError || "")}
              </Text>
            )}
            <Toggle
              icon="notifications-outline"
              label={t("Thông báo")}
              value={state.settings.notifications}
              disabled={busy}
              onValueChange={toggleNotifications}
            />
            {(notificationSaveError || reminderError) && (
              <Text
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                style={[styles.error, styles.soundError]}
              >
                {t(notificationSaveError || reminderError || "")}
              </Text>
            )}
          </View>
          <LanguageSelector disabled={busy} />
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t("Thông tin & hỗ trợ")}</Text>
          <View style={styles.group}>
            <MenuRow
              icon="help-circle-outline"
              label={t("Hướng dẫn sử dụng")}
              onPress={() => openSheet("help")}
            />
            <MenuRow
              icon="shield-checkmark-outline"
              label={t("Dữ liệu & quyền riêng tư")}
              onPress={() => openSheet("privacy")}
            />
            <MenuRow
              icon="information-circle-outline"
              label={t("Về PAT")}
              onPress={() => openSheet("about")}
            />
          </View>
        </View>
        <View style={styles.group}>
          <MenuRow
            icon="log-out-outline"
            label={t("Đăng xuất")}
            onPress={confirmLogout}
          />
        </View>
        <Text style={styles.localNote}>{t("PAT · Lớn lên cùng khu vườn của bạn")}</Text>
      </ScrollView>

      <Modal
        visible={Boolean(sheet)}
        presentationStyle="pageSheet"
        allowSwipeDismissal={!busy}
        animationType="slide"
        onRequestClose={closeSheet}
        onShow={() => sheetScroll.current?.scrollTo({ y: 0, animated: false })}
      >
        <KeyboardAvoidingView
          style={styles.safe}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <SafeAreaView edges={["top", "bottom"]} style={styles.safe}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>
                {sheet ? t(titles[sheet]) : ""}
              </Text>
              <Pressable
                {...focus.props("close")}
                disabled={busy}
                accessibilityState={{ disabled: busy }}
                accessibilityRole="button"
                accessibilityLabel={t("Đóng")}
                onPress={closeSheet}
                style={({ pressed }) => [
                  styles.iconButton,
                  pressed && styles.pressed,
                  focus.style("close"),
                ]}
              >
                <Ionicons
                  name="close"
                  size={LAYOUT.icon}
                  color={COLORS.textMuted}
                />
              </Pressable>
            </View>
            <ScrollView
              ref={sheetScroll}
              contentContainerStyle={styles.sheetContent}
              keyboardShouldPersistTaps="handled"
              scrollEventThrottle={100}
              onScroll={(event) =>
                setPreviewVisible(
                  event.nativeEvent.contentOffset.y < previewBottom.current,
                )
              }
            >
              {sheet === "wardrobe" && (
                <>
                  <View
                    style={styles.preview}
                    onLayout={(event) => {
                      previewBottom.current =
                        event.nativeEvent.layout.y +
                        event.nativeEvent.layout.height;
                    }}
                  >
                    <GardenerAvatar
                      outfit={state.profile.outfit}
                      size={192}
                      animated={isFocused && previewVisible}
                    />
                    <View style={styles.previewCaption}>
                      <Text style={styles.sheetTitle}>
                        {t(currentOutfit.name)}
                      </Text>
                      <Text style={[styles.caption, styles.centerText]}>
                        {t(currentOutfit.description)}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.caption}>{t("Chạm để đổi trang phục. Cả ba bộ đều miễn phí.")}</Text>
                  <View style={styles.outfitGrid}>
                    {OUTFITS.map((outfit) => (
                      <Pressable
                        key={outfit.id}
                        {...focus.props(outfit.id)}
                        disabled={busy}
                        accessibilityRole="radio"
                        accessibilityState={{
                          checked: state.profile.outfit === outfit.id,
                          disabled: busy,
                        }}
                        accessibilityLabel={t("Trang phục {name}. {description}", { name: t(outfit.name), description: t(outfit.description) })}
                        onPress={() =>
                          void run(async () => {
                            updateProfile({ outfit: outfit.id });
                            await persistNow();
                          })
                        }
                        style={({ pressed }) => [
                          styles.outfitOption,
                          state.profile.outfit === outfit.id && styles.selected,
                          pressed && styles.pressed,
                          focus.style(outfit.id),
                        ]}
                      >
                        <View
                          accessible={false}
                          accessibilityElementsHidden
                          importantForAccessibility="no-hide-descendants"
                        >
                          <GardenerAvatar outfit={outfit.id} size={80} />
                        </View>
                        <Text style={[styles.rowText, styles.centerText]}>
                          {t(outfit.name)}
                        </Text>
                        <View style={styles.outfitSelection}>
                          <Ionicons
                            name={
                              state.profile.outfit === outfit.id
                                ? "checkmark-circle"
                                : "ellipse-outline"
                            }
                            color={COLORS.primary}
                            size={LAYOUT.badgeIcon}
                            accessible={false}
                          />
                          <Text style={styles.outfitStatus}>
                            {t(state.profile.outfit === outfit.id
                              ? "Đang mặc"
                              : "Miễn phí")}
                          </Text>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}
              {sheet === "account" && (
                <>
                  <Field
                    label={t("Tên người dùng")}
                    value={draft.name}
                    onChangeText={(name) =>
                      setDraft((current) => ({ ...current, name }))
                    }
                    maxLength={40}
                    editable={!busy}
                    autoComplete="name"
                  />
                  <View style={styles.field}>
                    <Text style={styles.label}>{t("Email đăng nhập")}</Text>
                    <Text selectable style={styles.accountEmail} accessibilityLabel={t("Email đăng nhập: {email}", { email: state.auth.identity })}>
                      {state.auth.identity}
                    </Text>
                  </View>
                  <Field
                    label={t("Số điện thoại")}
                    value={draft.phone}
                    onChangeText={(phone) =>
                      setDraft((current) => ({ ...current, phone }))
                    }
                    maxLength={20}
                    keyboardType="phone-pad"
                    autoComplete="tel"
                    editable={!busy}
                    placeholder={t("Chưa thêm")}
                  />
                  <View testID="account-connections" style={styles.accountSection}>
                    <Text accessibilityRole="header" style={styles.label}>{t("Tài khoản liên kết")}</Text>
                    {(["google", "facebook"] as const).map(provider => (
                      <SocialProviderButton key={provider} provider={provider} action="link"
                        linked={account?.providers?.includes(provider) ?? false}
                        loading={linkPending === provider} disabled={busy}
                        onPress={() => connectSocial(provider)} />
                    ))}
                    {linkMessage ? <Text accessibilityLiveRegion="polite" style={styles.success}>{t(linkMessage)}</Text> : null}
                  </View>
                  <View testID="account-security" style={styles.accountSection}>
                    <Text accessibilityRole="header" style={styles.label}>{t("Bảo mật")}</Text>
                    {account?.hasPassword !== false ? (
                      <View style={styles.group}>
                        <MenuRow icon="lock-closed-outline" label={t("Đổi mật khẩu")} disabled={busy} onPress={() => openSheet("password")} />
                      </View>
                    ) : <Text style={styles.caption}>{t("Mật khẩu được quản lý tại Google hoặc Facebook.")}</Text>}
                  </View>
                  <JourneyButton
                    title={t("Lưu hồ sơ")}
                    onPress={saveAccount}
                    loading={busy}
                  />
                </>
              )}
              {sheet === "password" && (
                <>
                  <PasswordField label={t("Mật khẩu hiện tại")} value={currentPassword} onChangeText={value => { setCurrentPassword(value); clearPasswordValidation(); }} editable={!busy} />
                  <PasswordField label={t("Mật khẩu mới")} value={newPassword} onChangeText={value => { setNewPassword(value); clearPasswordValidation(); }} editable={!busy} isNew />
                  <PasswordRules value={newPassword} />
                  <PasswordField label={t("Nhập lại mật khẩu mới")} value={confirmPassword} onChangeText={value => { setConfirmPassword(value); clearPasswordValidation(); }} editable={!busy} isNew />
                  <JourneyButton title={t("Đổi mật khẩu")} onPress={savePassword} loading={busy} />
                  {passwordMessage ? <Text accessibilityLiveRegion="polite" style={styles.success}>{t(passwordMessage)}</Text> : null}
                </>
              )}
              {sheet &&
                sheet in information &&
                information[sheet as keyof typeof information].map(
                  (paragraph) => (
                    <Text key={paragraph} style={styles.paragraph}>
                      {t(paragraph)}
                    </Text>
                  ),
                )}
              {busy && (
                <ActivityIndicator
                  color={COLORS.primary}
                  accessibilityLabel={t("Đang lưu thay đổi")}
                />
              )}
              {error ? (
                <Text
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                  style={styles.error}
                >
                  {t(error)}
                </Text>
              ) : null}
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function MenuRow({
  icon,
  label,
  detail,
  unread,
  disabled = false,
  onPress,
}: {
  icon: IconName;
  label: string;
  detail?: string;
  unread?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { t } = useI18n();
  const focus = useControlFocus();
  return (
    <Pressable
      {...focus.props("row")}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      accessibilityLabel={unread ? t("{label}, có thư chưa đọc", { label }) : [label, detail].filter(Boolean).join(", ")}
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuRow,
        pressed && styles.pressed,
        disabled && { opacity: INTERACTION.disabledOpacity },
        focus.style("row"),
        focus.style("row") && { outlineOffset: INTERACTION.insetFocusOffset },
      ]}
    >
      <View style={styles.menuIcon}>
        <Ionicons
          name={icon}
          size={LAYOUT.icon}
          color={COLORS.primary}
          accessible={false}
        />
        {unread && <UnreadDot />}
      </View>
      <View style={styles.flex}>
        <Text style={styles.rowText}>{label}</Text>
        {detail && <Text style={styles.caption}>{detail}</Text>}
      </View>
      <Ionicons
        name="chevron-forward"
        size={LAYOUT.smallIcon}
        color={COLORS.textMuted}
        accessible={false}
      />
    </Pressable>
  );
}

function Field({ label, style, ...props }: TextInputProps & { label: string }) {
  const focus = useControlFocus();
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...props}
        {...focus.props("field")}
        accessibilityLabel={label}
        underlineColorAndroid={COLORS.transparent}
        placeholderTextColor={COLORS.textMuted}
        style={[styles.input, focus.style("field"), style]}
      />
    </View>
  );
}

function PasswordField({ label, isNew, ...props }: TextInputProps & { label: string; isNew?: boolean }) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const focus = useControlFocus();
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.passwordRow}>
        <TextInput
          {...props}
          {...focus.props("password")}
          accessibilityLabel={label}
          secureTextEntry={!visible}
          autoComplete={isNew ? "new-password" : "current-password"}
          textContentType={isNew ? "newPassword" : "password"}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={isNew ? t("Từ 8 đến 128 ký tự") : undefined}
          placeholderTextColor={COLORS.textMuted}
          maxLength={128}
          underlineColorAndroid={COLORS.transparent}
          style={[styles.passwordInput, focus.style("password")]}
        />
        <Pressable
          {...focus.props("visibility")}
          accessibilityRole="button"
          accessibilityLabel={t(visible ? "Ẩn {field}" : "Hiện {field}", { field: label })}
          onPress={() => setVisible((value) => !value)}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed, focus.style("visibility")]}
        >
          <Ionicons name={visible ? "eye-off-outline" : "eye-outline"} size={LAYOUT.smallIcon} color={COLORS.textMuted} accessible={false} />
        </Pressable>
      </View>
    </View>
  );
}

function Toggle({
  icon,
  label,
  value,
  disabled,
  onValueChange,
}: {
  icon: IconName;
  label: string;
  value: boolean;
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const focus = useControlFocus();
  return (
    <View style={styles.menuRow}>
      <Ionicons
        name={icon}
        size={LAYOUT.icon}
        color={COLORS.primary}
        accessible={false}
      />
      <Text style={[styles.rowText, styles.flex]}>{label}</Text>
      <View
        {...focus.props("switch")}
        style={[styles.switchTarget, focus.style("switch")]}
      >
        <Switch
          hitSlop={SPACING.sm}
          accessibilityLabel={label}
          value={value}
          disabled={disabled}
          accessibilityState={{ checked: value, disabled: Boolean(disabled) }}
          onValueChange={onValueChange}
          trackColor={{ false: COLORS.controlBorder, true: COLORS.primary }}
          thumbColor={COLORS.white}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  content: {
    width: "100%",
    maxWidth: LAYOUT.contentMaxWidth,
    alignSelf: "center",
    padding: SPACING.page,
    paddingBottom: SPACING.xl,
    gap: SPACING.lg,
  },
  flex: { flex: 1, minWidth: 0 },
  menuIcon: { width: LAYOUT.icon, height: LAYOUT.icon },
  pageHeader: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  eyebrow: {
    ...TYPE.overline,
    color: COLORS.primary,
    marginBottom: SPACING.xs,
  },
  name: { ...TYPE.title, color: COLORS.text },
  iconButton: {
    minWidth: LAYOUT.touch,
    minHeight: LAYOUT.touch,
    borderRadius: RADIUS.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  characterStage: {
    ...GRADIENTS.garden,
    backgroundColor: COLORS.leafTint,
    borderRadius: RADIUS.lg,
    borderCurve: "continuous",
    overflow: "hidden",
    alignItems: "center",
  },
  characterArt: {
    width: "100%",
    alignItems: "center",
    paddingTop: SPACING.sm,
  },
  // One-off illustration geometry; these shapes stay behind the character, never text.
  sun: {
    position: "absolute",
    width: 48,
    height: 48,
    borderRadius: RADIUS.pill,
    top: SPACING.lg,
    right: "16%",
    backgroundColor: COLORS.sunshine,
    opacity: 0.7,
  },
  waterGlow: {
    position: "absolute",
    width: 80,
    height: 80,
    bottom: SPACING.lg,
    left: "8%",
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.water,
    opacity: 0.4,
  },
  stageActions: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: SPACING.compact,
    padding: SPACING.md,
    backgroundColor: COLORS.surface,
  },
  outfitSummary: { flexGrow: 1, flexShrink: 1, gap: SPACING.xs },
  section: { gap: SPACING.sm },
  sectionLabel: {
    ...TYPE.label,
    color: COLORS.textMuted,
    paddingHorizontal: SPACING.xs,
  },
  group: {
    borderRadius: RADIUS.lg,
    borderCurve: "continuous",
    backgroundColor: COLORS.surface,
    overflow: "hidden",
  },
  menuRow: {
    minHeight: SPACING.hero,
    padding: SPACING.md,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.compact,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.background,
  },
  rowText: { ...TYPE.body, fontWeight: "600" },
  caption: { ...TYPE.subhead },
  localNote: { ...TYPE.caption, textAlign: "center" },
  pressed: { backgroundColor: COLORS.pressed },
  sheetHeader: {
    width: "100%",
    maxWidth: LAYOUT.contentMaxWidth,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.page,
    paddingVertical: SPACING.sm,
    gap: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  sheetTitle: { ...TYPE.headline, flexShrink: 1 },
  sheetContent: {
    width: "100%",
    maxWidth: LAYOUT.formMaxWidth,
    alignSelf: "center",
    padding: SPACING.page,
    paddingBottom: SPACING.xl,
    gap: SPACING.md,
  },
  preview: {
    ...GRADIENTS.garden,
    backgroundColor: COLORS.leafTint,
    borderRadius: RADIUS.lg,
    borderCurve: "continuous",
    overflow: "hidden",
    alignItems: "center",
    paddingTop: SPACING.sm,
    gap: SPACING.sm,
  },
  previewCaption: {
    width: "100%",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    padding: SPACING.md,
    gap: SPACING.xs,
  },
  centerText: { textAlign: "center" },
  outfitGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING.sm,
  },
  outfitOption: {
    flexBasis: "30%",
    flexGrow: 1,
    minWidth: SPACING.hero + SPACING.xl,
    alignItems: "center",
    gap: SPACING.sm,
    paddingHorizontal: SPACING.xs,
    paddingVertical: SPACING.compact,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderCurve: "continuous",
    borderWidth: 2,
    borderColor: COLORS.transparent,
  },
  outfitSelection: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    gap: SPACING.xs,
  },
  outfitStatus: { ...TYPE.caption, color: COLORS.primary },
  selected: { borderColor: COLORS.primary, backgroundColor: COLORS.leafTint },
  field: { gap: SPACING.sm },
  label: { ...TYPE.label },
  accountEmail: { ...TYPE.body, color: COLORS.textMuted, paddingVertical: SPACING.compact },
  accountSection: { gap: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.controlBorder,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surface,
  },
  passwordInput: { ...INPUT.singleLine, flex: 1, minWidth: 0 },
  success: { ...TYPE.subhead, color: COLORS.primaryDark },
  input: {
    ...INPUT.singleLine,
    borderWidth: 1,
    borderColor: COLORS.controlBorder,
    borderRadius: RADIUS.md,
    borderCurve: "continuous",
    backgroundColor: COLORS.surface,
  },
  switchTarget: {
    minWidth: LAYOUT.touch,
    minHeight: LAYOUT.touch,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: RADIUS.sm,
  },
  paragraph: { ...TYPE.body, color: COLORS.textMuted },
  error: { ...TYPE.subhead, color: COLORS.danger },
  soundError: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.md,
  },
});
