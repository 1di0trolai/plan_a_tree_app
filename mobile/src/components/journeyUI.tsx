/** Cung cấp các thành phần giao diện dùng chung cho hành trình chăm cây và tiện ích chọn ảnh. */

import { t, useI18n } from "@/i18n";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useState, type ComponentProps, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useControlFocus } from "@/hooks/useControlFocus";
import { COLORS, GRADIENTS, INPUT, INTERACTION, LAYOUT, RADIUS, SHADOWS, SPACING, TYPE } from "@/theme";
import type { CaptureSource, CropKind, PlantPhase } from "@/types/app";

export const cropEmoji: Record<CropKind, string> = {
  mango: "🥭",
  tomato: "🍅",
  chili: "🌶️",
  other: "🌱",
};
export const phaseLabels: Record<PlantPhase, string> = {
  planning: "Chuẩn bị trồng",
  germinating: "Đang ươm hạt",
  seedling: "Cây con",
  growing: "Đang phát triển",
  flowering: "Ra hoa",
  fruiting: "Có quả",
};

export async function selectJourneyPhoto(
  source: CaptureSource,
): Promise<string | null> {
  if (source === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        t("Cần quyền máy ảnh"),
        t("Cho phép PAT truy cập máy ảnh trong Cài đặt, hoặc chọn ảnh từ thư viện."),
      );
      return null;
    }
  }
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images"],
    allowsEditing: false,
    quality: 0.75,
  };
  const result =
    source === "camera"
      ? await ImagePicker.launchCameraAsync({
          ...options,
          cameraType: ImagePicker.CameraType.back,
        })
      : await ImagePicker.launchImageLibraryAsync({
          ...options,
          selectionLimit: 1,
        });
  return result.canceled ? null : (result.assets[0]?.uri ?? null);
}

export function JourneyHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  useI18n();
  const focus = useControlFocus();
  return (
    <View style={ui.header}>
      <Pressable
        {...focus.props("back")}
        accessibilityLabel={t("Quay lại")}
        accessibilityRole="button"
        onPress={() => {
          if (router.canGoBack()) router.back();
          else router.replace("/(tabs)/garden");
        }}
        style={({ pressed }) => [
          ui.back,
          pressed && { backgroundColor: COLORS.pressed },
          focus.style("back"),
        ]}
      >
        <Ionicons name="arrow-back" size={LAYOUT.tabIcon} color={COLORS.text} />
      </Pressable>
      <View style={ui.flex}>
        <Text style={ui.title}>{title}</Text>
        {subtitle ? <Text style={ui.caption}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

export function JourneyButton({
  title,
  onPress,
  secondary = false,
  disabled = false,
  loading = false,
  icon,
  testID,
  variant,
  size = "md",
  style,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  loading?: boolean;
  icon?: ComponentProps<typeof Ionicons>["name"];
  testID?: string;
  variant?: "primary" | "secondary" | "ghost" | "inverse" | "destructive";
  size?: "sm" | "md";
  style?: StyleProp<ViewStyle>;
}) {
  const focus = useControlFocus();
  const intent = variant ?? (secondary ? "secondary" : "primary");
  const foreground =
    disabled ? COLORS.onDisabled : intent === "primary"
      ? COLORS.onAction
      : intent === "destructive" ? COLORS.onPrimary : COLORS.primaryDark;
  return (
    <Pressable
      {...focus.props("button")}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        ui.button,
        intent === "primary" && !disabled && GRADIENTS.action,
        intent === "secondary" && ui.secondary,
        intent === "ghost" && { backgroundColor: COLORS.transparent },
        intent === "inverse" && { backgroundColor: COLORS.scannerFrame },
        intent === "destructive" && { backgroundColor: COLORS.danger },
        size === "sm" && {
          minHeight: LAYOUT.touch,
          paddingVertical: SPACING.sm,
        },
        disabled && { backgroundColor: COLORS.disabled },
        pressed && { opacity: intent === "primary" || intent === "destructive" ? INTERACTION.primaryPressedOpacity : INTERACTION.pressedOpacity },
        focus.style("button", intent === "inverse"),
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : icon ? (
        <Ionicons name={icon} size={LAYOUT.smallIcon} color={foreground} />
      ) : null}
      <Text style={[ui.buttonText, { color: foreground }]}>{title}</Text>
    </Pressable>
  );
}

export function JourneyCard({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[ui.card, style]}>{children}</View>;
}

export function JourneyDisclosure({
  title,
  children,
  initiallyOpen = false,
}: {
  title: string;
  children: ReactNode;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const focus = useControlFocus();
  return (
    <View style={{ marginTop: SPACING.sm }}>
      <Pressable
        {...focus.props("disclosure")}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((current) => !current)}
        style={({ pressed }) => ({
          minHeight: LAYOUT.touch,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: SPACING.compact,
          backgroundColor: pressed ? COLORS.pressed : COLORS.transparent,
          borderRadius: RADIUS.sm,
          ...focus.style("disclosure"),
        })}
      >
        <Text
          style={{
            ...TYPE.label,
            color: COLORS.textMuted,
            flex: 1,
          }}
        >
          {title}
        </Text>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={LAYOUT.smallIcon}
          color={COLORS.textMuted}
        />
      </Pressable>
      {open ? children : null}
    </View>
  );
}
export function JourneyField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  disabled = false,
  size = "md",
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginTop: size === "sm" ? SPACING.sm : SPACING.md }}>
      <Text style={ui.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={COLORS.textMuted}
        underlineColorAndroid={COLORS.transparent}
        maxLength={multiline ? 1200 : 100}
        multiline={multiline}
        editable={!disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          ui.input,
          size === "sm" && { minHeight: LAYOUT.touch },
          focused && {
            ...INTERACTION.focus,
            borderColor: COLORS.focus,
            backgroundColor: COLORS.surface,
          },
          disabled && ui.disabled,
          multiline && {
            ...INPUT.multiline,
            minHeight: size === "sm" ? LAYOUT.touch + SPACING.lg : LAYOUT.touch * 2,
          },
        ]}
      />
    </View>
  );
}
export function JourneyChoices<T extends string>({
  label,
  values,
  selected,
  onSelect,
  size = "md",
}: {
  label: string;
  values: Record<T, string>;
  selected: T;
  onSelect: (value: T) => void;
  size?: "sm" | "md";
}) {
  useI18n();
  const focus = useControlFocus();
  return (
    <View style={{ marginTop: size === "sm" ? SPACING.sm : SPACING.md }}>
      <Text style={ui.label}>{label}</Text>
      <View style={ui.choices}>
        {(Object.keys(values) as T[]).map((value) => (
          <Pressable
            {...focus.props(value)}
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected === value }}
            onPress={() => onSelect(value)}
            style={({ pressed }) => [
              ui.chip,
              size === "sm" && { padding: SPACING.sm, maxWidth: "100%" },
              value === selected && ui.chipSelected,
              pressed && { opacity: INTERACTION.pressedOpacity },
              focus.style(value),
            ]}
          >
            <Text
              style={[
                ui.chipText,
                size === "sm" && { flexShrink: 1 },
                value === selected && { color: COLORS.onAction },
              ]}
            >
              {t(values[value])}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export const ui = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background, ...GRADIENTS.ambient },
  flex: { flex: 1 },
  content: { padding: SPACING.page, paddingBottom: SPACING.xxl, width: "100%", maxWidth: LAYOUT.contentMaxWidth, alignSelf: "center" },
  header: {
    width: "100%",
    maxWidth: LAYOUT.contentMaxWidth,
    alignSelf: "center",
    paddingHorizontal: SPACING.page,
    paddingVertical: SPACING.md,
    gap: SPACING.compact,
    flexDirection: "row",
    alignItems: "center",
  },
  back: {
    width: LAYOUT.touch,
    height: LAYOUT.touch,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surfaceSoft,
    justifyContent: "center",
    alignItems: "center",
  },
  title: TYPE.title,
  subtitle: TYPE.headline,
  caption: { ...TYPE.subhead, marginTop: SPACING.xs },
  text: TYPE.body,
  card: {
    ...SHADOWS.card,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderCurve: "continuous",
    padding: SPACING.page,
    marginBottom: SPACING.md,
  },
  button: {
    backgroundColor: COLORS.actionSurface,
    minHeight: LAYOUT.control,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.page,
    borderRadius: RADIUS.md,
    borderCurve: "continuous",
    justifyContent: "center",
    alignItems: "center",
    flexDirection: "row",
    gap: SPACING.sm,
    marginTop: SPACING.compact,
  },
  buttonText: {
    ...TYPE.label,
    color: COLORS.onAction,
    flexShrink: 1,
    textAlign: "center",
  },
  secondary: { backgroundColor: COLORS.sage },
  disabled: { opacity: INTERACTION.disabledOpacity },
  label: {
    ...TYPE.label,
    marginBottom: SPACING.sm,
  },
  input: {
    ...INPUT.singleLine,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.controlBorder,
    borderRadius: RADIUS.md,
    borderCurve: "continuous",
  },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm },
  chip: {
    minHeight: LAYOUT.touch,
    justifyContent: "center",
    backgroundColor: COLORS.surfaceSoft,
    borderRadius: RADIUS.md,
    borderCurve: "continuous",
    padding: SPACING.compact,
  },
  chipSelected: { backgroundColor: COLORS.actionSurface },
  chipText: TYPE.subhead,
  error: { ...TYPE.subhead, color: COLORS.danger, marginTop: SPACING.compact },
});
