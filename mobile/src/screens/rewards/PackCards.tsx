/** Cung cấp các mặt thẻ gói quà chưa mở, thú nuôi nhận được và thức ăn thưởng đi kèm. */

import { useI18n } from "@/i18n";
import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { BrandArtwork } from "@/components/BrandArtwork";
import { FoodArtwork } from "@/components/FoodArtwork";
import { PetArtwork } from "@/components/PetArtwork";
import { COLORS, GRADIENTS, LAYOUT, RADIUS, RARITY, SPACING, TYPE } from "@/theme";
import type { Beast, DailyPetPack, InventoryItem } from "@/types/app";

export const RARITY_LABEL = {
  Common: "Thường", Uncommon: "Không phổ biến", Rare: "Hiếm", Epic: "Sử thi", Legendary: "Huyền thoại",
} as const;

export function SealedPack({ caption, artSize }: { caption: string; artSize: number }) {
  const { t } = useI18n();
  return (
    <LinearGradient colors={GRADIENTS.actionStops} style={[cardStyles.face, cardStyles.sealed]}>
      <View style={cardStyles.sealedInner}>
        <ScrollView style={cardStyles.sealedScroll} contentContainerStyle={cardStyles.sealedContent} showsVerticalScrollIndicator={false}>
          <Text style={cardStyles.overline}>{t("MÓN QUÀ TỪ KHU VƯỜN")}</Text>
          <View style={cardStyles.brandSeal}><BrandArtwork size={artSize} /></View>
          <Text style={cardStyles.packTitle}>{t("Một người bạn\nđang chờ bạn")}</Text>
        </ScrollView>
        <View testID="sealed-card-open-footer" style={cardStyles.openLabel}>
          <Text style={cardStyles.openText}>{caption}</Text>
        </View>
      </View>
    </LinearGradient>
  );
}

export function PetRewardCard({ pack, pet, artSize }: { pack: DailyPetPack; pet: Beast; artSize: number }) {
  const { t } = useI18n();
  const tint = RARITY[pack.rarity];
  return (
    <View testID="revealed-pet-card" style={[cardStyles.face, { borderColor: tint.glow }]}>
      <ScrollView contentContainerStyle={cardStyles.frontContent} showsVerticalScrollIndicator nestedScrollEnabled>
        <View style={cardStyles.cardTop}>
          <Text style={[cardStyles.tier, { color: tint.color }]}>{t(RARITY_LABEL[pack.rarity])}</Text>
        </View>
        <LinearGradient colors={[tint.background, COLORS.surface]} style={cardStyles.art}>
          <PetArtwork petId={pet.id} size={artSize} />
        </LinearGradient>
        <View style={cardStyles.info}>
          <Text style={cardStyles.name}>{t(pet.name)}</Text>
          <Text style={[cardStyles.detail, { color: tint.color }]}>{t(pet.element)}</Text>
          <View style={cardStyles.footer}>
            <Text style={cardStyles.footerText}>{t(pack.isNew ? "BẠN MỚI TRONG VƯỜN" : "THÊM MỘT NGƯỜI BẠN")}</Text>
            <Text style={cardStyles.footerText}>PAT</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

export function FoodRewardCard({ item, artSize }: { item: InventoryItem; artSize: number }) {
  const { t } = useI18n();
  return (
    <View testID="pack-bonus-food" style={[cardStyles.face, { borderColor: COLORS.sunshine }]}>
      <ScrollView contentContainerStyle={cardStyles.frontContent} showsVerticalScrollIndicator nestedScrollEnabled>
        <View style={cardStyles.cardTop}>
          <Text style={[cardStyles.tier, { color: COLORS.secondary }]}>{t("Quà đi kèm")}</Text>
          <Ionicons name="gift-outline" size={LAYOUT.smallIcon} color={COLORS.secondary} />
        </View>
        <LinearGradient colors={[COLORS.sunTint, COLORS.surface]} style={cardStyles.art}>
          <FoodArtwork itemId={item.id} size={artSize} />
        </LinearGradient>
        <View style={cardStyles.info}>
          <Text style={cardStyles.name}>{t(item.name)}</Text>
          <Text style={cardStyles.quantity}>×1</Text>
          <Text style={cardStyles.detail}>{t("Đã cất vào kho đồ")}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  face: { flex: 1, borderRadius: RADIUS.lg, borderCurve: "continuous", borderWidth: 3, borderColor: COLORS.primary, backgroundColor: COLORS.surface, overflow: "hidden" },
  sealed: { padding: SPACING.sm },
  sealedInner: { flex: 1, borderWidth: 1, borderRadius: RADIUS.md, borderCurve: "continuous", borderColor: COLORS.primary, padding: SPACING.md },
  sealedScroll: { flex: 1 },
  sealedContent: { flexGrow: 1, alignItems: "center", justifyContent: "space-evenly", gap: SPACING.md, paddingBottom: SPACING.sm },
  overline: { ...TYPE.overline, color: COLORS.onAction, textAlign: "center" },
  brandSeal: { backgroundColor: COLORS.surface, borderRadius: RADIUS.pill, padding: SPACING.sm },
  packTitle: { ...TYPE.title, textAlign: "center", color: COLORS.onAction },
  openLabel: { minHeight: LAYOUT.touch, flexShrink: 0, marginTop: SPACING.sm, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: SPACING.sm },
  openText: { ...TYPE.label, flexShrink: 1, textAlign: "center", color: COLORS.onAction },
  frontContent: { flexGrow: 1 },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: SPACING.sm, padding: SPACING.md, paddingBottom: SPACING.sm },
  tier: { ...TYPE.label, flexShrink: 1 },
  art: { flexGrow: 1, alignItems: "center", justifyContent: "center", paddingVertical: SPACING.sm },
  info: { padding: SPACING.md, gap: SPACING.xs },
  name: { ...TYPE.title, textAlign: "center" },
  detail: { ...TYPE.subhead, textAlign: "center" },
  quantity: { ...TYPE.headline, textAlign: "center", color: COLORS.secondary },
  footer: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderColor: COLORS.border, paddingTop: SPACING.compact, marginTop: SPACING.sm, gap: SPACING.sm },
  footerText: { ...TYPE.caption, fontWeight: "600", flexShrink: 1 },
});
