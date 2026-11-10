/** Hiển thị màn hình giới thiệu Đấu trường trong thời gian tính năng chưa được triển khai. */

import Ionicons from "@expo/vector-icons/Ionicons";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { COLORS, GRADIENTS, RADIUS, SPACING, TYPE } from "@/theme";
import { useI18n } from "@/i18n";

export default function BattleScreen() {
  const { t } = useI18n();
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.content}>
        <View
          style={styles.art}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <View style={styles.cardBack} />
          <View style={styles.outerRing} />
          <View style={styles.innerRing}>
            <Ionicons
              name="shield-outline"
              size={SPACING.xxl}
              color={COLORS.primaryDark}
            />
          </View>
          <View style={styles.leaf}>
            <Ionicons name="leaf" size={SPACING.page} color={COLORS.primary} />
          </View>
        </View>
        <Text style={styles.title}>{t("Sắp ra mắt")}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background, ...GRADIENTS.ambient },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: SPACING.lg,
    paddingBottom: SPACING.hero,
  },
  art: {
    width: 192,
    height: 224,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: SPACING.xl,
  },
  // A restrained card-back silhouette ties the placeholder to the pet collection.
  cardBack: {
    position: "absolute",
    width: 136,
    height: 184,
    borderRadius: RADIUS.xl,
    borderCurve: "continuous",
    backgroundColor: COLORS.ochreSoft,
    transform: [{ rotate: "-12deg" }, { translateX: -SPACING.compact }],
  },
  outerRing: {
    ...GRADIENTS.garden,
    position: "absolute",
    width: 136,
    height: 184,
    borderRadius: RADIUS.xl,
    borderCurve: "continuous",
    backgroundColor: COLORS.sage,
    transform: [{ rotate: "7deg" }, { translateX: SPACING.sm }],
  },
  innerRing: {
    width: SPACING.hero + SPACING.lg,
    height: SPACING.hero + SPACING.lg,
    borderRadius: RADIUS.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surface,
  },
  leaf: {
    position: "absolute",
    bottom: SPACING.hero - SPACING.compact,
    right: SPACING.xxl - SPACING.xs,
    backgroundColor: COLORS.ochreSoft,
    width: SPACING.xl,
    height: SPACING.xl,
    borderRadius: RADIUS.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    ...TYPE.largeTitle,
    color: COLORS.primaryDark,
  },
});
