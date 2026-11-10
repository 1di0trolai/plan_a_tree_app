/** Mở màn hình nhận thẻ thú nuôi, xác định gói quà và điều phối việc đóng màn hình thưởng. */

import { useI18n } from "@/i18n";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect } from "react";
import { BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useControlFocus } from "@/hooks/useControlFocus";
import { PackReveal } from "@/screens/rewards/PackReveal";
import { useApp } from "@/store/AppStore";
import { PET_SPECIES } from "@/data/seed";
import { COLORS, INTERACTION, LAYOUT, RADIUS, SPACING, TYPE } from "@/theme";

export default function RewardPackScreen() {
  const { t } = useI18n();
  const { state } = useApp();
  const { packId } = useLocalSearchParams<{ packId?: string }>();
  const focus = useControlFocus();
  const insets = useSafeAreaInsets();
  // An invalid explicit ID must not open an unrelated, still-sealed reward.
  const pack = packId
    ? state.dailyPacks.find((entry) => entry.id === packId)
    : state.dailyPacks.find((entry) => !entry.revealedAt) ?? state.dailyPacks.at(-1);
  const pet = PET_SPECIES.find((entry) => entry.id === pack?.beastId);
  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/garden");
  }, []);
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      close();
      return true;
    });
    return () => subscription.remove();
  }, [close]);
  return (
    <View style={styles.root} accessibilityViewIsModal>
      <StatusBar style="light" />
      <Pressable
        {...focus.props("reward-backdrop")}
        testID="reward-backdrop"
        accessibilityRole="button"
        accessibilityLabel={t("Đóng phần thưởng")}
        onPress={close}
        style={[StyleSheet.absoluteFill, focus.style("reward-backdrop", true)]}
      />
      <SafeAreaView style={styles.safe} pointerEvents="box-none">
        <View style={styles.body} pointerEvents="box-none">
          {pack && pet ? <PackReveal key={pack.id} pack={pack} pet={pet} /> : (
            <View style={styles.empty}>
              <Ionicons name="gift-outline" color={COLORS.primary} size={LAYOUT.control} />
              <Text style={styles.emptyTitle}>{t("Chưa có quà để mở")}</Text>
              <Text style={styles.emptyText}>{t("Ghé thăm đủ cây trong vườn để nhận thẻ thú nuôi.")}</Text>
            </View>
          )}
        </View>
        <Pressable
          {...focus.props("close-reward")}
          testID="close-reward"
          accessibilityRole="button"
          accessibilityLabel={t("Đóng phần thưởng")}
          onPress={close}
          style={({ pressed }) => [styles.close, { top: insets.top + SPACING.xs }, pressed && { opacity: INTERACTION.primaryPressedOpacity }, focus.style("close-reward", true)]}
        >
          <Ionicons name="close" size={LAYOUT.icon} color={COLORS.white} />
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.rewardBackdrop },
  safe: { flex: 1 },
  body: { flex: 1, alignItems: "center", justifyContent: "center" },
  close: { position: "absolute", top: SPACING.xs, right: SPACING.sm, width: LAYOUT.touch, height: LAYOUT.touch, borderRadius: RADIUS.pill, alignItems: "center", justifyContent: "center" },
  empty: { margin: SPACING.page, maxWidth: LAYOUT.formMaxWidth, borderRadius: RADIUS.lg, padding: SPACING.lg, gap: SPACING.sm, alignItems: "center", backgroundColor: COLORS.surface },
  emptyTitle: { ...TYPE.headline, textAlign: "center" },
  emptyText: { ...TYPE.subhead, textAlign: "center" },
});
