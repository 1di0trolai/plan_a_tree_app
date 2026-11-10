/** Khởi tạo ngôn ngữ, trạng thái ứng dụng và điều hướng gốc; gắn các hiệu ứng cài đặt, quà thưởng và xử lý xung đột đồng bộ. */

import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { AppProvider, useApp } from "@/store/AppStore";
import { PreferenceEffects } from "@/components/PreferenceEffects";
import { EconomyEffects } from "@/components/EconomyEffects";
import { SyncStatusBanner } from "@/components/SyncStatusBanner";
import { useControlFocus } from "@/hooks/useControlFocus";
import { loadLanguage, useI18n } from "@/i18n";
import { COLORS, GRADIENTS, INTERACTION, LAYOUT, RADIUS, SPACING, TYPE } from "@/theme";

export { ErrorBoundary } from "expo-router";

export default function RootLayout() {
  const [languageReady, setLanguageReady] = useState(false);
  useEffect(() => { let mounted = true; void loadLanguage().finally(() => { if (mounted) setLanguageReady(true); });
    return () => { mounted = false; }; }, []);
  if (!languageReady) return <View style={{ flex: 1, justifyContent: "center", backgroundColor: COLORS.background }}><ActivityIndicator color={COLORS.primary} /></View>;
  return (
    <AppProvider>
      <StatusBar style="dark" />
      <PreferenceEffects />
      <RootNavigator />
      <EconomyEffects />
    </AppProvider>
  );
}

function RootNavigator() {
  const { t } = useI18n();
  const { ready, state, storageError, retryStorage } = useApp();
  const focus = useControlFocus();
  if (!ready) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: COLORS.background,
          ...GRADIENTS.ambient,
          padding: SPACING.lg,
        }}
      >
        {storageError ? (
          <>
            <Text
              style={{
                ...TYPE.title,
                textAlign: "center",
              }}
            >
              {t("Chưa thể mở dữ liệu PAT")}
            </Text>
            <Text
              accessibilityRole="alert"
              selectable
              style={{
                ...TYPE.body,
                color: COLORS.textMuted,
                maxWidth: LAYOUT.contentMaxWidth,
                marginVertical: SPACING.md,
                textAlign: "center",
              }}
            >
              {t(storageError)}
            </Text>
            <Text
              style={{ ...TYPE.subhead, maxWidth: LAYOUT.contentMaxWidth, textAlign: "center" }}
            >
              {t("Nếu đọc/ghi dữ liệu gặp lỗi, ứng dụng sẽ dừng ở đây để bạn thử lại. Cấu hình trợ lý thông minh trên máy tính không bị thay đổi.")}
            </Text>
            <Pressable
              {...focus.props("retry")}
              accessibilityRole="button"
              onPress={retryStorage}
              testID="retry-storage"
              style={({ pressed }) => [{
                backgroundColor: COLORS.actionSurface,
                ...GRADIENTS.action,
                borderRadius: RADIUS.md,
                borderCurve: "continuous",
                minHeight: LAYOUT.control,
                justifyContent: "center",
                paddingHorizontal: SPACING.lg,
                paddingVertical: SPACING.compact,
                marginTop: SPACING.lg,
              }, pressed && { opacity: INTERACTION.pressedOpacity }, focus.style("retry")]}
            >
              <Text style={{ ...TYPE.label, color: COLORS.onAction }}>
                {t("Thử tải lại dữ liệu")}
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <ActivityIndicator color={COLORS.primary} size="large" />
            <Text style={{ ...TYPE.subhead, marginTop: SPACING.md }}>
              {t("Đang mở dữ liệu PAT…")}
            </Text>
          </>
        )}
      </View>
    );
  }
  return (
    <View style={{ flex: 1 }}>
    <SyncStatusBanner />
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: COLORS.background },
        animation: "fade",
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Protected guard={state.auth.loggedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="ar-hunt"
          options={{
            animation: "slide_from_bottom",
            presentation: "fullScreenModal",
          }}
        />
        <Stack.Screen
          name="add-plant"
          options={{ animation: "slide_from_bottom" }}
        />
        <Stack.Screen name="plant-detail" />
        <Stack.Screen name="plant-chat" />
        <Stack.Screen name="shop" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="mailbox" options={{ animation: "slide_from_right" }} />
        <Stack.Screen
          name="reward-pack"
          options={{
            animation: "none",
            presentation: "transparentModal",
            contentStyle: { backgroundColor: COLORS.transparent },
            gestureEnabled: false,
          }}
        />
      </Stack.Protected>
    </Stack>
    </View>
  );
}
