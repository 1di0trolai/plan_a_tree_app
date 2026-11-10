/** Cung cấp nút Google và Facebook dùng chung cho đăng nhập hoặc liên kết tài khoản. */

import Ionicons from "@expo/vector-icons/Ionicons";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { useControlFocus } from "@/hooks/useControlFocus";
import { useI18n } from "@/i18n";
import type { SocialProvider } from "@/services/accountAuth";
import { INTERACTION, LAYOUT, RADIUS, SPACING, TYPE } from "@/theme";

// Provider brand colors intentionally remain independent of PAT's theme.
const BRAND = {
  google: { surface: "#FFFFFF", ink: "#1F1F1F", border: "#747775" },
  facebook: { surface: "#0866FF", ink: "#FFFFFF", border: "#0866FF" },
} as const;

export function SocialProviderButton({
  provider, onPress, action = "continue", disabled = false, loading = false, linked = false,
}: {
  provider: SocialProvider;
  onPress: () => void;
  action?: "continue" | "link";
  disabled?: boolean;
  loading?: boolean;
  linked?: boolean;
}) {
  const { t } = useI18n();
  const focus = useControlFocus();
  const brand = BRAND[provider];
  const name = provider === "google" ? "Google" : "Facebook";
  const label = linked ? name : t(action === "link" ? "Liên kết {provider}" : "Tiếp tục với {provider}", { provider: name });
  const inactive = disabled || loading || linked;
  return (
    <Pressable
      {...focus.props("provider")}
      accessibilityRole="button"
      accessibilityLabel={linked ? t("{provider}, đã liên kết", { provider: name }) : label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: brand.surface, borderColor: brand.border },
        pressed && styles.pressed, disabled && !linked && styles.disabled, focus.style("provider")]}
    >
      <View style={styles.logo} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <ProviderLogo provider={provider} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.label, { color: brand.ink }]}>{label}</Text>
        {linked && <Text style={[styles.status, { color: brand.ink }]}>{t("Đã liên kết")}</Text>}
      </View>
      <View style={styles.trailing} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {loading ? <ActivityIndicator color={brand.ink} /> : linked ? (
          <Ionicons name="checkmark-circle" size={LAYOUT.smallIcon} color={brand.ink} />
        ) : null}
      </View>
    </Pressable>
  );
}

function ProviderLogo({ provider }: { provider: SocialProvider }) {
  if (provider === "google") {
    // Unchanged official asset: https://developers.google.com/static/identity/images/g-logo.png
    return <Image source={require("../../assets/logo/google-g.png")} style={styles.mark} resizeMode="contain" />;
  }
  // Exact white Facebook Login mark from Meta's Android SDK:
  // https://github.com/facebook/facebook-android-sdk/blob/main/facebook-common/src/main/res/drawable/com_facebook_button_icon.xml
  // Copyright Meta Platforms, Inc. and affiliates; facebook-android-sdk/LICENSE.
  return (
    <Svg width={24} height={24} viewBox="0 0 1365.3333 1365.3333" fill="none">
      <Path fill="#FFFFFF" d="m1365.33,682.67c0,-377.03 -305.64,-682.67 -682.67,-682.67C305.64,-0 0,305.64 0,682.67 0,1023.41 249.64,1305.83 576,1357.04L576,880L402.67,880l0,-197.33l173.33,-0l0,-150.4c0,-171.09 101.92,-265.6 257.85,-265.6 74.69,-0 152.81,13.33 152.81,13.33L986.67,448L900.58,448C815.78,448 789.33,500.62 789.33,554.61L789.33,682.67L978.67,682.67L948.4,880L789.33,880L789.33,1357.04C1115.69,1305.83 1365.33,1023.41 1365.33,682.67" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: LAYOUT.control, width: "100%", flexDirection: "row", alignItems: "center",
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.compact, gap: SPACING.compact,
    borderWidth: 1, borderRadius: RADIUS.pill },
  logo: { width: LAYOUT.icon, alignItems: "center", justifyContent: "center" },
  mark: { width: LAYOUT.icon, height: LAYOUT.icon },
  copy: { flex: 1, minWidth: 0, alignItems: "center" },
  label: { ...TYPE.label, fontWeight: "600", textAlign: "center" },
  status: { ...TYPE.caption, textAlign: "center" },
  trailing: { width: LAYOUT.icon, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: INTERACTION.pressedOpacity },
  disabled: { opacity: INTERACTION.disabledOpacity },
});
