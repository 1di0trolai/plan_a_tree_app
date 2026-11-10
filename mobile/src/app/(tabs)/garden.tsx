/** Hiển thị khu vườn, chuyển giữa các cây và theo dõi tiến trình chăm sóc, quà thưởng cùng cây lưu trữ. */

import { t, useI18n } from "@/i18n";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Animated,
  type FlatListInstance,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { JourneyButton, phaseLabels } from "@/components/journeyUI";
import { localDateKey } from "@/data/seed";
import { PET_CAPACITY } from "@/data/petProgression";
import { useControlFocus } from "@/hooks/useControlFocus";
import { scheduleGardenNoticeDismiss } from "@/screens/garden/gardenFeedback";
import { GardenDots } from "@/screens/garden/GardenDots";
import { gardenViewportBudget } from "@/screens/garden/gardenLayout";
import {
  gardenPlantAtOffset,
  getGardenNavigation,
} from "@/screens/garden/gardenNavigation";
import { useApp } from "@/store/AppStore";
import {
  archivedGardenPlants,
  visibleGardenPlants,
} from "@/store/journeyActions";
import {
  COLORS,
  GRADIENTS,
  INTERACTION,
  LAYOUT,
  RADIUS,
  SHADOWS,
  SPACING,
  TYPE,
} from "@/theme";
import type { Plant } from "@/types/app";
import { getCurrentPlantStreak } from "@/utils/plantStreak";

/** Neutral illustration, never presented as a generated chibi or a real photo. */
function PlantSketch({ compact = false }: { compact?: boolean }) {
  return (
    <View
      style={[styles.sketchFrame, compact && styles.sketchFrameCompact]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <View style={[styles.sketch, compact && styles.sketchCompact]}>
        <View style={styles.sketchHalo} />
        <View style={styles.sketchGround} />
        <View style={styles.sketchStem} />
        <View style={styles.sketchLeafLeft} />
        <View style={styles.sketchLeafRight} />
        <View style={styles.sketchLeafTop} />
      </View>
    </View>
  );
}

function PlantPortrait({
  uri,
  name,
  isChibi,
}: {
  uri?: string;
  name: string;
  isChibi: boolean;
}) {
  useI18n();
  const [unavailable, setUnavailable] = useState(false);
  return uri && !unavailable ? (
    <Image
      source={{ uri }}
      style={StyleSheet.absoluteFill}
      resizeMode={isChibi ? "contain" : "cover"}
      accessibilityLabel={t(isChibi ? "Chibi {name}" : "Ảnh thật {name}", { name })}
      onError={() => setUnavailable(true)}
    />
  ) : (
    <View style={styles.placeholder}>
      <PlantSketch compact />
      <Text style={styles.placeholderCaption}>
        {uri ? t("Ảnh chưa tải được") : t("Chưa có ảnh cây")}
      </Text>
    </View>
  );
}

export default function GardenScreen() {
  useI18n();
  const focus = useControlFocus();
  const { gardenNotice } = useLocalSearchParams<{ gardenNotice?: string }>();
  const {
    ready,
    state,
    activePlant,
    setActivePlantIndex,
    restorePlant,
    persistNow,
  } = useApp();
  const { width, height, fontScale } = useWindowDimensions();
  const [viewportHeight, setViewportHeight] = useState(0);
  const [metadataMeasure, setMetadataMeasure] = useState({
    width: 0,
    fontScale: 0,
    height: 0,
  });
  const [progressHeight, setProgressHeight] = useState(0);
  const list = useRef<FlatListInstance>(null);
  const animateSelection = useRef(false);
  const [scrollOffset] = useState(() => new Animated.Value(0));
  const [reduceMotion, setReduceMotion] = useState(true);
  const restoreLock = useRef(false);
  const screenActive = useRef(false);
  const [showArchived, setShowArchived] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string } | null>(null);
  const plants = visibleGardenPlants(state);
  const archived = archivedGardenPlants(state);
  const navigation = getGardenNavigation(plants, activePlant?.id);
  const activeIndex = navigation.index;
  const current = plants[activeIndex];
  const today = localDateKey();
  const round = state.dailyRounds.find((entry) => entry.date === today);
  const pending = state.dailyPacks.find((pack) => !pack.revealedAt);
  const openPack = () => {
    if (!pending) return;
    if (pending.creditedAt === null && state.inventory.pets.length >= PET_CAPACITY) {
      Alert.alert(t("Kho thú nuôi đã đầy"), t("Hãy dọn kho để nhận quà. Hộp quà vẫn được giữ."), [
        { text: t("Để sau"), style: "cancel" },
        { text: t("Dọn kho"), onPress: () => router.push("/(tabs)/inventory") },
      ]);
      return;
    }
    router.push({ pathname: "/reward-pack", params: { packId: pending.id } });
  };
  const completed = round?.inspectedPlantIds.length ?? 0;
  const total =
    round?.plantIds.length ??
    plants.filter((plant) => plant.journey.phase !== "planning").length;
  // Measure the space below the safe-area header and above the navigator's tab
  // bar. Shrink only the photo; larger text and short/landscape screens can scroll.
  const metadataHeight =
    metadataMeasure.width === width && metadataMeasure.fontScale === fontScale
      ? metadataMeasure.height
      : (TYPE.title.lineHeight + TYPE.caption.lineHeight) * fontScale +
        SPACING.xs;
  const { imageHeight: portraitHeight } = gardenViewportBudget({
    viewportHeight: viewportHeight || height / 2,
    imageWidth: width - SPACING.page * 2,
    metadataHeight,
    progressHeight: progressHeight || SPACING.hero,
    indicatorHeight: LAYOUT.touch,
    cardGap: SPACING.sm,
    bottomPadding: SPACING.sm,
    minimumImageHeight: LAYOUT.artwork + SPACING.lg,
    maximumImageHeight: LAYOUT.formMaxWidth,
  });
  useEffect(() => {
    list.current?.scrollToOffset({
      offset: activeIndex * width,
      animated: animateSelection.current && !reduceMotion,
    });
    animateSelection.current = false;
  }, [activeIndex, activePlant?.id, width, plants.length, reduceMotion]);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (mounted) setReduceMotion(value);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      screenActive.current = true;
      return () => {
        screenActive.current = false;
        setNotice(null);
      };
    }, []),
  );
  useFocusEffect(
    useCallback(() => {
      if (!gardenNotice) return;
      setNotice({ message: gardenNotice });
      // Consume the navigation hand-off once; revisiting the tab must not replay it.
      router.setParams({ gardenNotice: undefined });
    }, [gardenNotice]),
  );
  useEffect(() => {
    if (!notice) return;
    if (Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibilityWithOptions(notice.message, {
        queue: true,
      });
    }
    return scheduleGardenNoticeDismiss(() => setNotice(null));
  }, [notice]);

  const selectPlant = (plantId: string | null) => {
    if (!plantId) return;
    const index = state.plants.findIndex(
      (plant) => plant.id === plantId && !plant.archived,
    );
    if (index >= 0) setActivePlantIndex(index);
  };
  const moveToNeighbor = (plantId: string | null) => {
    if (!plantId) return;
    animateSelection.current = true;
    selectPlant(plantId);
  };

  const openPlant = (pathname: "/plant-detail" | "/plant-chat") => {
    if (current) router.push({ pathname, params: { plantId: current.id } });
  };
  const restore = async (plant: Plant) => {
    if (restoreLock.current) return;
    restoreLock.current = true;
    setRestoring(plant.id);
    try {
      const result = restorePlant(plant.id);
      if (!result.ok) {
        Alert.alert(t("Chưa thể khôi phục"), t(result.message));
        return;
      }
      await persistNow();
      if (!screenActive.current) return;
      setShowArchived(false);
      setNotice({ message: t("Đã đưa {name} về vườn.", { name: plant.name }) });
    } catch {
      Alert.alert(
        t("Chưa lưu xuống máy"),
        t("Cây đã xuất hiện trong phiên này. Hãy thử lưu lại trước khi đóng ứng dụng."),
        [
          { text: t("Đóng"), style: "cancel" },
          { text: t("Thử lưu lại"), onPress: () => void restore(plant) },
        ],
      );
    } finally {
      restoreLock.current = false;
      setRestoring(null);
    }
  };

  if (!ready)
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator style={styles.loading} color={COLORS.primary} />
      </SafeAreaView>
    );
  return (
    <SafeAreaView edges={["top"]} style={styles.safe}>
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <Ionicons
            name="leaf"
            size={LAYOUT.smallIcon}
            color={COLORS.primary}
          />
          <Text style={styles.brand}>{t("PAT / NHẬT KÝ CHĂM CÂY")}</Text>
        </View>
        <View style={styles.row}>
          <View style={styles.flex}>
            <Text style={styles.title}>{t("Khu vườn")}</Text>
            <Text style={styles.subtitle}>
              {plants.length
                ? t("{count} cây đang đồng hành", { count: plants.length })
                : t("Một chút xanh, mỗi ngày.")}
            </Text>
          </View>
          <Pressable
            {...focus.props("add-plant")}
            accessibilityLabel={t("Thêm cây mới")}
            accessibilityRole="button"
            onPress={() => router.push("/add-plant")}
            style={({ pressed }) => [
              styles.add,
              pressed && styles.pressed,
              focus.style("add-plant"),
            ]}
          >
            <Ionicons
              name="add"
              size={LAYOUT.icon}
              color={COLORS.primaryDark}
            />
          </Pressable>
        </View>
      </View>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
      >
        {plants.length ? (
          <>
            <Animated.FlatList<Plant>
              style={styles.carousel}
              ref={list}
              data={plants}
              horizontal
              pagingEnabled
              onScroll={Animated.event(
                [{ nativeEvent: { contentOffset: { x: scrollOffset } } }],
                { useNativeDriver: true },
              )}
              scrollEventThrottle={16}
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item) => item.id}
              getItemLayout={(_, index) => ({
                length: width,
                offset: index * width,
                index,
              })}
              onMomentumScrollEnd={(event) => {
                selectPlant(
                  gardenPlantAtOffset(
                    plants,
                    event.nativeEvent.contentOffset.x,
                    width,
                  ),
                );
              }}
              renderItem={({ item }) => {
                const chibi = state.plantChibis.find(
                  (entry) => entry.plantId === item.id,
                );
                const photo = state.plantPhotos.find(
                  (entry) => entry.plantId === item.id,
                );
                const imageUri =
                  photo?.imageUri || chibi?.imageUri || undefined;
                const isChibi = !photo?.imageUri && !!chibi?.imageUri;
                const checked = item.lastCheckIn === today;
                const currentStreak = getCurrentPlantStreak(item);
                return (
                  <View style={[styles.page, { width }]}>
                    <Pressable
                      {...focus.props(`plant-${item.id}`)}
                      accessibilityRole="button"
                      accessibilityLabel={t("Hồ sơ {name}, {species}, {phase}", { name: item.name, species: item.species, phase: t(phaseLabels[item.journey.phase]) })}
                      onPress={() =>
                        router.push({
                          pathname: "/plant-detail",
                          params: { plantId: item.id },
                        })
                      }
                      style={({ pressed }) => [
                        styles.plant,
                        pressed && styles.plantPressed,
                        focus.style(`plant-${item.id}`),
                      ]}
                    >
                      <View
                        style={[styles.portrait, { height: portraitHeight }]}
                      >
                        <PlantPortrait
                          key={`${item.id}:${imageUri ?? "empty"}`}
                          uri={imageUri}
                          name={item.name}
                          isChibi={isChibi}
                        />
                        <View style={styles.photoTop}>
                          <View style={styles.phaseBadge}>
                            <Text style={styles.phaseText}>
                              {t(phaseLabels[item.journey.phase])}
                            </Text>
                          </View>
                        </View>
                      </View>
                      <View
                        style={styles.metadata}
                        onLayout={(event) => {
                          const measured = event.nativeEvent.layout.height;
                          setMetadataMeasure((previous) => ({
                            width,
                            fontScale,
                            height:
                              previous.width === width &&
                              previous.fontScale === fontScale
                                ? Math.max(previous.height, measured)
                                : measured,
                          }));
                        }}
                      >
                        <View style={styles.plantDescription}>
                          <Text style={styles.plantName}>{item.name}</Text>
                          {currentStreak > 0 ? (
                            <View style={styles.streakBadge} accessible accessibilityLabel={t("Chuỗi hiện tại {count} ngày", { count: currentStreak })}>
                              <Ionicons
                                name="flame-outline"
                                size={LAYOUT.smallIcon}
                                color={COLORS.warning}
                              />
                              <Text style={styles.streakText}>
                                {currentStreak}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        <View style={styles.statusRow}>
                          <View
                            style={[
                              styles.statusDot,
                              checked && styles.statusDotDone,
                            ]}
                          />
                          <Text style={styles.status}>
                            {item.journey.phase === "planning"
                              ? t("Chưa bắt đầu trồng")
                              : checked
                                ? t("Đã kiểm tra hôm nay")
                                : t("Chưa kiểm tra hôm nay")}
                          </Text>
                        </View>
                      </View>
                    </Pressable>
                  </View>
                );
              }}
            />
            <GardenDots
              offset={scrollOffset}
              pageWidth={width}
              index={activeIndex}
              count={plants.length}
              reduceMotion={reduceMotion}
              onPrevious={() => moveToNeighbor(navigation.previous)}
              onNext={() => moveToNeighbor(navigation.next)}
            />
            <View
              style={styles.section}
              onLayout={(event) =>
                setProgressHeight(event.nativeEvent.layout.height)
              }
            >
              {total > 0 ? (
                <View style={styles.progress}>
                  <View style={styles.row}>
                    <Text style={styles.sectionTitle}>{t("Chuyến thăm hôm nay")}</Text>
                    <Text style={styles.progressCount}>
                      {Math.min(completed, total)}
                      <Text style={styles.progressTotal}> / {total}</Text>
                    </Text>
                  </View>
                  <View
                    style={styles.track}
                    accessibilityRole="progressbar"
                    accessibilityLabel={t("Cây đã kiểm tra hôm nay")}
                    accessibilityValue={{
                      min: 0,
                      max: total,
                      now: Math.min(completed, total),
                    }}
                  >
                    <View
                      style={[
                        styles.fill,
                        {
                          width: `${Math.min(100, (completed / total) * 100)}%`,
                        },
                      ]}
                    />
                  </View>
                </View>
              ) : (
                <Text style={styles.planningHint}>
                  {t("Bắt đầu trồng để cùng cây tạo thói quen mỗi ngày.")}</Text>
              )}
              <View style={[styles.gardenActions, fontScale >= 1.3 && styles.gardenActionsStack]}>
              {current ? (
                <JourneyButton
                  title={
                    current.journey.phase === "planning"
                      ? t("Bắt đầu trồng")
                      : t("Chăm sóc cây")
                  }
                  icon="leaf-outline"
                  secondary={Boolean(pending)}
                  size="sm"
                  style={styles.careAction}
                  testID="garden-plant-care"
                  onPress={() =>
                    openPlant(
                      current.journey.phase === "planning"
                        ? "/plant-detail"
                        : "/plant-chat",
                    )
                  }
                />
              ) : null}
              {pending ? (
                <JourneyButton
                  title={t("Nhận quà")}
                  icon="gift-outline"
                  testID="garden-open-pack"
                  size="sm"
                  style={styles.claimAction}
                  onPress={openPack}
                />
              ) : null}
              </View>
              {archived.length ? (
                <Pressable
                  {...focus.props("archives")}
                  accessibilityRole="button"
                  onPress={() => setShowArchived(true)}
                  style={({ pressed }) => [
                    styles.archiveLink,
                    pressed && styles.pressed,
                    focus.style("archives"),
                  ]}
                  testID="garden-archived-plants"
                >
                  <Ionicons
                    name="archive-outline"
                    size={LAYOUT.smallIcon}
                    color={COLORS.textMuted}
                    accessible={false}
                  />
                  <Text style={styles.archiveText}>
                    {t("Cây đã lưu trữ ({count})", { count: archived.length })}
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={LAYOUT.smallIcon}
                    color={COLORS.textMuted}
                    accessible={false}
                  />
                </Pressable>
              ) : null}
            </View>
          </>
        ) : (
          <View style={styles.empty}>
            <View style={styles.emptyArt}>
              <Image
                source={require("../../../assets/tree_740934.png")}
                style={styles.sketchFrame}
                resizeMode="contain"
                accessible={false}
                testID="garden-empty-tree"
              />
            </View>
            <Text style={styles.emptyTitle}>
              {archived.length
                ? t("Đưa màu xanh trở lại")
                : t("Bắt đầu từ\nmột mầm xanh.")}
            </Text>
            <Text style={styles.emptyDescription}>
              {archived.length
                ? t("Cây đã lưu trữ vẫn giữ nguyên ảnh và nhật ký. Bạn có thể đưa cây về vườn bất cứ lúc nào.")
                : t("Chụp một quả, hạt giống hoặc cây của bạn. PAT sẽ cùng bạn chăm sóc từng ngày.")}
            </Text>
            <View style={styles.emptyButton}>
              <JourneyButton
                title={archived.length ? t("Thêm cây mới") : t("Thêm cây đầu tiên")}
                icon="add"
                onPress={() => router.push("/add-plant")}
              />
            </View>
            {archived.length ? (
              <JourneyButton
                title={t("Cây đã lưu trữ ({count})", { count: archived.length })}
                icon="archive-outline"
                variant="ghost"
                onPress={() => setShowArchived(true)}
                testID="garden-archived-plants"
              />
            ) : null}
            {pending ? (
              <JourneyButton
                title={t("Nhận quà")}
                icon="gift-outline"
                testID="garden-open-pack"
                size="sm"
                onPress={openPack}
              />
            ) : null}
          </View>
        )}
      </ScrollView>
      <Modal
        visible={showArchived}
        presentationStyle="pageSheet"
        animationType="slide"
        allowSwipeDismissal
        onRequestClose={() => setShowArchived(false)}
      >
        <SafeAreaView style={styles.safe}>
          <View style={styles.sheetHeader}>
            <View style={styles.flex}>
              <Text style={styles.sectionTitle}>{t("Cây đã lưu trữ")}</Text>
              <Text style={styles.subtitle}>{t("Ảnh và nhật ký vẫn ở đây.")}</Text>
            </View>
            <Pressable
              {...focus.props("close-archives")}
              accessibilityRole="button"
              onPress={() => setShowArchived(false)}
              style={({ pressed }) => [
                styles.done,
                pressed && styles.pressed,
                focus.style("close-archives"),
              ]}
            >
              <Text style={styles.doneText}>{t("Xong")}</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.archivedList}>
            {archived.map((plant) => (
              <View key={plant.id} style={styles.archivedItem}>
                <View style={styles.archivedHeading}>
                  <Ionicons
                    name="leaf-outline"
                    size={LAYOUT.icon}
                    color={COLORS.primary}
                  />
                  <View style={styles.flex}>
                    <Text style={styles.archivedName}>{plant.name}</Text>
                    <Text style={styles.species}>{plant.species}</Text>
                  </View>
                </View>
                <JourneyButton
                  title={t("Khôi phục về vườn")}
                  secondary
                  loading={restoring === plant.id}
                  disabled={!!restoring}
                  onPress={() => void restore(plant)}
                />
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
      {notice ? (
        <View style={styles.toastPlacement} pointerEvents="none">
          <View
            style={styles.toast}
            accessible
            accessibilityLabel={notice.message}
            accessibilityLiveRegion="polite"
            testID="garden-toast"
          >
            <Ionicons
              name="checkmark-circle"
              size={LAYOUT.smallIcon}
              color={COLORS.success}
              accessible={false}
            />
            <Text style={styles.toastText}>{notice.message}</Text>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background, ...GRADIENTS.ambient },
  flex: { flex: 1, minWidth: 0 },
  loading: { flex: 1 },
  header: {
    width: "100%",
    maxWidth: LAYOUT.contentMaxWidth,
    alignSelf: "center",
    paddingHorizontal: SPACING.page,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.compact,
    gap: SPACING.sm,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  brand: { ...TYPE.overline, color: COLORS.primary, flexShrink: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: SPACING.compact,
  },
  title: { ...TYPE.title },
  subtitle: { ...TYPE.subhead, marginTop: SPACING.xs },
  add: {
    width: LAYOUT.touch,
    height: LAYOUT.touch,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { backgroundColor: COLORS.pressed },
  scroll: { flexGrow: 1, paddingBottom: SPACING.sm },
  carousel: { flexGrow: 0, flexShrink: 0 },
  page: { paddingHorizontal: SPACING.page },
  plant: {
    gap: SPACING.sm,
    width: "100%",
    maxWidth: LAYOUT.contentMaxWidth - SPACING.page * 2,
    alignSelf: "center",
    borderRadius: RADIUS.xl,
    borderCurve: "continuous",
  },
  plantPressed: { opacity: INTERACTION.pressedOpacity },
  portrait: {
    backgroundColor: COLORS.sage,
    ...GRADIENTS.garden,
    borderRadius: RADIUS.xl,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  photoTop: {
    position: "absolute",
    top: SPACING.md,
    left: SPACING.md,
    right: SPACING.md,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: SPACING.sm,
  },
  phaseBadge: {
    maxWidth: "72%",
    backgroundColor: COLORS.imageBadge,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.pill,
  },
  phaseText: { ...TYPE.caption, fontWeight: "600", color: COLORS.primaryDark },
  streakBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
    backgroundColor: COLORS.imageBadge,
    paddingHorizontal: SPACING.compact,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.pill,
  },
  streakText: { ...TYPE.caption, fontWeight: "700", color: COLORS.warning },
  placeholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  placeholderCaption: { ...TYPE.caption, color: COLORS.primary },
  plantDescription: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    flexWrap: "wrap",
  },
  metadata: { gap: SPACING.xs },
  plantName: { ...TYPE.title, flexShrink: 1 },
  species: { ...TYPE.subhead, marginTop: SPACING.xs },
  statusRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  statusDot: {
    width: SPACING.sm,
    height: SPACING.sm,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.secondary,
  },
  statusDotDone: { backgroundColor: COLORS.primary },
  status: { ...TYPE.caption, flexShrink: 1 },
  section: {
    width: "100%",
    maxWidth: LAYOUT.contentMaxWidth,
    alignSelf: "center",
    paddingHorizontal: SPACING.page,
    paddingTop: SPACING.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  progress: { paddingBottom: SPACING.xs },
  gardenActions: { flexDirection: "row", alignItems: "stretch", gap: SPACING.sm },
  gardenActionsStack: { flexDirection: "column" },
  careAction: { flex: 1, flexBasis: 0, paddingHorizontal: SPACING.compact },
  claimAction: { paddingHorizontal: SPACING.compact },
  sectionTitle: { ...TYPE.headline, flexShrink: 1 },
  progressCount: {
    ...TYPE.headline,
    color: COLORS.primaryDark,
    fontVariant: ["tabular-nums"],
  },
  progressTotal: { color: COLORS.textMuted, fontWeight: "400" },
  track: {
    height: SPACING.sm,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.border,
    marginTop: SPACING.sm,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary,
  },
  planningHint: { ...TYPE.subhead, paddingBottom: SPACING.sm },
  empty: {
    width: "100%",
    maxWidth: LAYOUT.formMaxWidth,
    alignSelf: "center",
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xl,
    alignItems: "center",
    gap: SPACING.md,
  },
  emptyArt: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surfaceAlt,
    ...GRADIENTS.garden,
    borderRadius: RADIUS.pill,
    padding: SPACING.lg,
  },
  emptyTitle: {
    ...TYPE.largeTitle,
    textAlign: "center",
    marginTop: SPACING.sm,
  },
  emptyDescription: {
    ...TYPE.body,
    color: COLORS.textMuted,
    textAlign: "center",
  },
  emptyButton: { alignSelf: "stretch", marginTop: SPACING.sm },
  archiveLink: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    minHeight: LAYOUT.touch,
    borderRadius: RADIUS.md,
    borderCurve: "continuous",
  },
  archiveText: { ...TYPE.caption, flexShrink: 1 },
  // The navigator's tab bar is in normal layout, so the scene already ends above it.
  toastPlacement: {
    position: "absolute",
    left: SPACING.page,
    right: SPACING.page,
    bottom: SPACING.md,
    alignItems: "center",
  },
  toast: {
    maxWidth: LAYOUT.formMaxWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderCurve: "continuous",
    backgroundColor: COLORS.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    ...SHADOWS.floating,
  },
  toastText: { ...TYPE.subhead, color: COLORS.text, flexShrink: 1 },
  sheetHeader: {
    width: "100%",
    maxWidth: LAYOUT.contentMaxWidth,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
    padding: SPACING.page,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  done: {
    minWidth: LAYOUT.touch,
    minHeight: LAYOUT.touch,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: SPACING.compact,
    borderRadius: RADIUS.md,
    borderCurve: "continuous",
  },
  doneText: { ...TYPE.label, color: COLORS.primary },
  archivedList: {
    paddingHorizontal: SPACING.page,
    paddingBottom: SPACING.xl,
    width: "100%",
    maxWidth: LAYOUT.contentMaxWidth,
    alignSelf: "center",
  },
  archivedItem: {
    paddingVertical: SPACING.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  archivedHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
  },
  archivedName: { ...TYPE.headline },
  // Local illustration geometry, not a second reusable spacing/type scale.
  sketchFrame: { width: 180, height: 180 },
  sketchFrameCompact: { width: 120, height: 120 },
  sketchCompact: {
    position: "absolute",
    left: -30,
    top: -30,
    transform: [{ scale: 2 / 3 }],
  },
  sketch: {
    width: 180,
    height: 180,
    alignItems: "center",
    justifyContent: "center",
  },
  sketchHalo: {
    position: "absolute",
    width: 144,
    height: 144,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surfaceSoft,
  },
  sketchGround: {
    position: "absolute",
    bottom: 15,
    width: 92,
    height: 12,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.sageDeep,
  },
  sketchStem: {
    position: "absolute",
    top: 54,
    left: 88,
    width: 4,
    height: 106,
    backgroundColor: COLORS.botanical,
    borderRadius: RADIUS.pill,
  },
  sketchLeafLeft: {
    position: "absolute",
    width: 58,
    height: 36,
    top: 91,
    left: 34,
    borderTopLeftRadius: 58,
    borderBottomRightRadius: 58,
    backgroundColor: COLORS.botanical,
    transform: [{ rotate: "24deg" }],
  },
  sketchLeafRight: {
    position: "absolute",
    width: 62,
    height: 39,
    top: 65,
    left: 89,
    borderTopRightRadius: 62,
    borderBottomLeftRadius: 62,
    backgroundColor: COLORS.botanical,
    transform: [{ rotate: "-18deg" }],
  },
  sketchLeafTop: {
    position: "absolute",
    width: 44,
    height: 28,
    top: 32,
    left: 54,
    borderTopLeftRadius: 44,
    borderBottomRightRadius: 44,
    backgroundColor: COLORS.sageDeep,
    transform: [{ rotate: "48deg" }],
  },
});
