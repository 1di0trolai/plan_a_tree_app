/** Cấu hình thanh điều hướng chính, nút máy ảnh và dấu báo thư chưa đọc của ứng dụng. */

import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import { PlatformPressable } from "expo-router/react-navigation";
import type { ComponentProps } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { UnreadDot } from "@/components/UnreadDot";
import { useControlFocus } from "@/hooks/useControlFocus";
import { useI18n } from "@/i18n";
import { useApp } from "@/store/AppStore";
import { COLORS, GRADIENTS, INTERACTION, LAYOUT, RADIUS, SPACING, TYPE } from "@/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];
const ICONS: Record<string, { active: IconName; inactive: IconName }> = {
  garden: { active: "leaf", inactive: "leaf-outline" },
  inventory: { active: "file-tray-full", inactive: "file-tray-full-outline" },
  camera: { active: "scan", inactive: "scan-outline" },
  battle: { active: "shield", inactive: "shield-outline" },
  profile: { active: "person", inactive: "person-outline" },
};

export default function TabLayout() {
  const { t } = useI18n();
  const { state } = useApp();
  const hasUnreadMail = state.mailbox.some((mail) => !mail.readAt);
  const insets = useSafeAreaInsets();
  const focus = useControlFocus();
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        sceneStyle: { backgroundColor: COLORS.background },
        tabBarActiveTintColor: COLORS.primaryDark,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: styles.label,
        // Use Router's existing button primitive; only add themed focus/press.
        tabBarButton: (props) => {
          const focusId = route.key ?? route.name;
          const bindings = focus.props(focusId);
          return <PlatformPressable
            {...props}
            onFocus={(event) => { bindings.onFocus(); props.onFocus?.(event); }}
            onBlur={(event) => { bindings.onBlur(); props.onBlur?.(event); }}
            pressColor={COLORS.pressed}
            pressOpacity={INTERACTION.pressedOpacity}
            style={[props.style, focus.style(focusId), focus.style(focusId) && { outlineOffset: INTERACTION.insetFocusOffset }]}
          />;
        },
        tabBarStyle:
          route.name === "camera"
            ? { display: "none" }
            : {
                height: SPACING.hero + SPACING.md + insets.bottom,
                paddingTop: SPACING.sm,
                paddingBottom: insets.bottom,
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: COLORS.border,
                backgroundColor: COLORS.surface,
                elevation: 0,
              },
        tabBarItemStyle: { minHeight: LAYOUT.touch },
        tabBarIcon: ({ color, focused }) => {
          const icon = ICONS[route.name] ?? ICONS.garden;
          if (route.name === "camera") {
            return (
              <View style={styles.cameraIcon}>
                <Ionicons
                  name="camera-outline"
                  color={COLORS.onAction}
                  size={SPACING.xl}
                  style={styles.cameraGlyph}
                  accessible={false}
                />
              </View>
            );
          }
          return (
            <View style={styles.tabIcon}>
              <Ionicons
                name={focused ? icon.active : icon.inactive}
                color={typeof color === "string" ? color : COLORS.primaryDark}
                size={LAYOUT.tabIcon}
                accessible={false}
              />
              {route.name === "profile" && hasUnreadMail && <UnreadDot />}
            </View>
          );
        },
      })}
    >
      <Tabs.Screen name="garden" options={{ title: t("Vườn") }} />
      <Tabs.Screen name="inventory" options={{ title: t("Kho đồ") }} />
      <Tabs.Screen
        name="camera"
        options={{
          title: t("Quét cây"),
          tabBarShowLabel: false,
          tabBarIconStyle: styles.cameraSlot,
          tabBarAccessibilityLabel: t("Mở máy ảnh nhận diện cây"),
        }}
      />
      <Tabs.Screen name="battle" options={{ title: t("Đấu trường") }} />
      <Tabs.Screen
        name="profile"
        options={{
          title: t("Hồ sơ"),
          tabBarAccessibilityLabel: t(hasUnreadMail ? "Hồ sơ, có thư chưa đọc" : "Hồ sơ"),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  // Let the navigator supply selected/unselected colors, not TYPE.caption.color.
  label: { fontSize: TYPE.caption.fontSize, lineHeight: TYPE.caption.lineHeight, fontWeight: TYPE.label.fontWeight, marginTop: SPACING.xs },
  tabIcon: { width: LAYOUT.tabIcon, height: LAYOUT.tabIcon },
  cameraSlot: { width: SPACING.hero, height: SPACING.hero },
  cameraGlyph: { lineHeight: SPACING.xl, includeFontPadding: false, textAlign: "center", textAlignVertical: "center" },
  cameraIcon: {
    ...GRADIENTS.action,
    width: SPACING.hero,
    height: SPACING.hero,
    borderRadius: RADIUS.pill,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.actionSurface,
  },
});
