import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { experienceForNextLevel } from '@/data/seed';
import { useApp } from '@/store/AppStore';
import { theme } from '@/theme';

type InventoryTab = 'beasts' | 'items';
type DetailSelection = { kind: InventoryTab; id: string } | null;
type FilterKey = 'all' | 'owned' | 'locked' | 'rare' | 'available';

type CardModel = {
  id: string;
  name: string;
  icon: string;
  rarity: string;
  meta: string;
  quantity: number;
  locked: boolean;
  companion: boolean;
};

const rareRanks = ['Hiếm', 'Sử thi', 'Huyền thoại'];

const rarityTone = (rarity: string) => {
  switch (rarity) {
    case 'Huyền thoại':
      return { accent: '#F59E0B', soft: '#FFF5D6' };
    case 'Sử thi':
      return { accent: '#8B5CF6', soft: '#F2ECFF' };
    case 'Hiếm':
      return { accent: '#3286E8', soft: '#EAF4FF' };
    case 'Sự kiện':
      return { accent: '#EC4899', soft: '#FDECF5' };
    default:
      return { accent: '#67856F', soft: '#EEF5EF' };
  }
};

export default function InventoryScreen() {
  const { ready, state, selectCompanion, feedPet } = useApp();
  const [tab, setTab] = useState<InventoryTab>('beasts');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [selected, setSelected] = useState<DetailSelection>(null);

  const collected = state.inventory.beasts.filter((beast) => beast.owned).length;
  const collectionTotal = state.inventory.beasts.length;
  const collectionPercent = collectionTotal ? Math.round((collected / collectionTotal) * 100) : 0;

  const cards = useMemo<CardModel[]>(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('vi');

    if (tab === 'beasts') {
      return state.inventory.beasts
        .filter((beast) => {
          const searchable = `${beast.name} ${beast.rarity} ${beast.element} ${beast.role}`.toLocaleLowerCase('vi');
          if (normalizedQuery && !searchable.includes(normalizedQuery)) return false;
          if (filter === 'owned' && !beast.owned) return false;
          if (filter === 'locked' && beast.owned) return false;
          if (filter === 'rare' && !rareRanks.includes(beast.rarity)) return false;
          return true;
        })
        .map((beast) => ({
          id: beast.id,
          name: beast.name,
          icon: beast.icon,
          rarity: beast.rarity,
          meta: beast.owned ? `${beast.element} · ${beast.role}` : beast.hint,
          quantity: beast.quantity,
          locked: !beast.owned,
          companion: state.inventory.companionId === beast.id,
        }));
    }

    return state.inventory.items
      .filter((item) => {
        const searchable = `${item.name} ${item.rarity} ${item.category}`.toLocaleLowerCase('vi');
        if (normalizedQuery && !searchable.includes(normalizedQuery)) return false;
        if (filter === 'available' && item.quantity < 1) return false;
        if (filter === 'rare' && !rareRanks.includes(item.rarity)) return false;
        return true;
      })
      .map((item) => ({
        id: item.id,
        name: item.name,
        icon: item.icon,
        rarity: item.rarity,
        meta: item.category,
        quantity: item.quantity,
        locked: false,
        companion: false,
      }));
  }, [filter, query, state.inventory, tab]);

  const selectedBeast = selected?.kind === 'beasts'
    ? state.inventory.beasts.find((beast) => beast.id === selected.id)
    : undefined;
  const selectedItem = selected?.kind === 'items'
    ? state.inventory.items.find((item) => item.id === selected.id)
    : undefined;
  const availableFoods = state.inventory.items.filter(
    (item) => item.category === 'Thức ăn' && item.quantity > 0,
  );
  const ownedPets = state.inventory.beasts.filter((beast) => beast.owned);

  const changeTab = (next: InventoryTab) => {
    setTab(next);
    setFilter('all');
    setQuery('');
    Keyboard.dismiss();
  };

  const chooseCompanion = () => {
    if (!selectedBeast?.owned) return;
    selectCompanion(selectedBeast.id);
    setSelected(null);
  };

  const giveFood = (petId: string, itemId: string) => {
    const result = feedPet(petId, itemId);
    Alert.alert(result.ok ? 'Pet đã ăn ngon lành' : 'Chưa thể cho ăn', result.message);
  };

  const filters: { key: FilterKey; label: string }[] = tab === 'beasts'
    ? [
        { key: 'all', label: 'Tất cả' },
        { key: 'owned', label: 'Đã bắt' },
        { key: 'locked', label: 'Chưa gặp' },
        { key: 'rare', label: 'Hiếm +' },
      ]
    : [
        { key: 'all', label: 'Tất cả' },
        { key: 'available', label: 'Còn dùng được' },
        { key: 'rare', label: 'Hiếm +' },
      ];

  const renderHeader = () => (
    <View>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>BỘ SƯU TẬP</Text>
          <Text style={styles.title}>Kho khám phá</Text>
        </View>
        <View style={styles.headerIcon} accessibilityElementsHidden>
          <Text style={styles.headerEmoji}>🎒</Text>
        </View>
      </View>

      <View style={styles.progressCard}>
        <View style={styles.progressTop}>
          <View>
            <Text style={styles.progressLabel}>Sinh vật đã khám phá</Text>
            <Text style={styles.progressValue}>{collected}/{collectionTotal} loài</Text>
          </View>
          <Text style={styles.progressPercent}>{collectionPercent}%</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${collectionPercent}%` }]} />
        </View>
      </View>

      <View style={styles.segmented} accessibilityRole="tablist">
        <Pressable
          accessibilityRole="tab"
          accessibilityLabel="Xem bộ sưu tập thú"
          accessibilityState={{ selected: tab === 'beasts' }}
          onPress={() => changeTab('beasts')}
          style={[styles.segment, tab === 'beasts' && styles.segmentActive]}>
          <Ionicons name="paw-outline" size={18} color={tab === 'beasts' ? theme.colors.primaryDark : theme.colors.textMuted} />
          <Text style={[styles.segmentText, tab === 'beasts' && styles.segmentTextActive]}>Thú</Text>
          <View style={[styles.countPill, tab === 'beasts' && styles.countPillActive]}>
            <Text style={[styles.countPillText, tab === 'beasts' && styles.countPillTextActive]}>{collected}</Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="tab"
          accessibilityLabel="Xem kho vật phẩm"
          accessibilityState={{ selected: tab === 'items' }}
          onPress={() => changeTab('items')}
          style={[styles.segment, tab === 'items' && styles.segmentActive]}>
          <Ionicons name="cube-outline" size={18} color={tab === 'items' ? theme.colors.primaryDark : theme.colors.textMuted} />
          <Text style={[styles.segmentText, tab === 'items' && styles.segmentTextActive]}>Vật phẩm</Text>
          <View style={[styles.countPill, tab === 'items' && styles.countPillActive]}>
            <Text style={[styles.countPillText, tab === 'items' && styles.countPillTextActive]}>{state.inventory.items.length}</Text>
          </View>
        </Pressable>
      </View>

      <View style={styles.searchBox}>
        <Ionicons name="search" size={20} color={theme.colors.textMuted} />
        <TextInput
          accessibilityLabel={tab === 'beasts' ? 'Tìm thú' : 'Tìm vật phẩm'}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          onChangeText={setQuery}
          placeholder={tab === 'beasts' ? 'Tìm theo tên, hệ, vai trò…' : 'Tìm vật phẩm…'}
          placeholderTextColor={theme.colors.textMuted}
          returnKeyType="search"
          style={styles.searchInput}
          value={query}
        />
        {query.length > 0 && (
          <Pressable
            accessibilityLabel="Xóa nội dung tìm kiếm"
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={20} color={theme.colors.textMuted} />
          </Pressable>
        )}
      </View>

      <View style={styles.filterRow}>
        {filters.map((option) => {
          const active = filter === option.key;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              key={option.key}
              onPress={() => setFilter(option.key)}
              style={[styles.filterChip, active && styles.filterChipActive]}>
              <Text style={[styles.filterText, active && styles.filterTextActive]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>{tab === 'beasts' ? 'Sinh vật quanh vườn' : 'Đồ chăm sóc pet'}</Text>
        <Text style={styles.resultCount}>{cards.length} kết quả</Text>
      </View>
    </View>
  );

  if (!ready) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.loadingWrap}>
          <View style={styles.loadingLeaf}><Text style={styles.loadingEmoji}>🌱</Text></View>
          <Text style={styles.loadingText}>Đang mở kho…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <FlatList
        data={cards}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={(
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🔎</Text>
            <Text style={styles.emptyTitle}>Chưa tìm thấy</Text>
            <Text style={styles.emptyBody}>Thử đổi từ khóa hoặc chọn bộ lọc khác nhé.</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => { setQuery(''); setFilter('all'); }}
              style={styles.emptyButton}>
              <Text style={styles.emptyButtonText}>Xóa bộ lọc</Text>
            </Pressable>
          </View>
        )}
        renderItem={({ item }) => {
          const tone = rarityTone(item.rarity);
          return (
            <Pressable
              accessibilityLabel={item.locked ? `Sinh vật chưa khám phá. ${item.meta}` : `${item.name}, ${item.rarity}`}
              accessibilityRole="button"
              onPress={() => setSelected({ kind: tab, id: item.id })}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
              <View style={styles.cardTop}>
                <View style={[styles.rarityPill, { backgroundColor: tone.soft }]}>
                  <Text style={[styles.rarityText, { color: tone.accent }]}>{item.rarity}</Text>
                </View>
                {item.companion && (
                  <View style={styles.companionBadge}>
                    <Ionicons name="star" size={11} color="#7B5D00" />
                  </View>
                )}
              </View>
              <View style={[styles.iconWell, { backgroundColor: tone.soft }]}>
                <Text style={[styles.cardEmoji, item.locked && styles.lockedEmoji]}>{item.locked ? '?' : item.icon}</Text>
              </View>
              <Text numberOfLines={2} style={[styles.cardName, item.locked && styles.lockedName]}>
                {item.locked ? 'Chưa khám phá' : item.name}
              </Text>
              <Text numberOfLines={2} style={styles.cardMeta}>{item.meta}</Text>
              <View style={styles.cardFooter}>
                <Text style={styles.quantity}>{item.locked ? '???' : `×${item.quantity}`}</Text>
                <Ionicons name="chevron-forward" size={16} color={theme.colors.textMuted} />
              </View>
            </Pressable>
          );
        }}
      />

      <Modal
        animationType="slide"
        onRequestClose={() => setSelected(null)}
        transparent
        visible={Boolean(selected)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Đóng chi tiết" onPress={() => setSelected(null)} style={styles.modalBackdrop} />
        <SafeAreaView style={styles.sheetSafe} edges={['bottom']}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Pressable
              accessibilityLabel="Đóng"
              accessibilityRole="button"
              hitSlop={12}
              onPress={() => setSelected(null)}
              style={styles.closeButton}>
              <Ionicons name="close" size={22} color={theme.colors.text} />
            </Pressable>

            <ScrollView
              contentContainerStyle={styles.sheetContent}
              showsVerticalScrollIndicator={false}>

            {selectedBeast && !selectedBeast.owned && (
              <View style={styles.detailBody}>
                <View style={[styles.detailIcon, styles.unknownDetailIcon]}><Text style={styles.detailQuestion}>?</Text></View>
                <Text style={styles.detailEyebrow}>CHƯA KHÁM PHÁ</Text>
                <Text style={styles.detailTitle}>Một người bạn bí ẩn</Text>
                <Text style={styles.detailDescription}>{selectedBeast.hint}</Text>
                <View style={styles.tipBox}>
                  <Ionicons name="scan-outline" size={21} color={theme.colors.primaryDark} />
                  <Text style={styles.tipText}>Dùng lượt quét AR hằng ngày quanh cây để có cơ hội bắt gặp sinh vật này.</Text>
                </View>
                <Pressable accessibilityRole="button" onPress={() => setSelected(null)} style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>Đã hiểu</Text>
                </Pressable>
              </View>
            )}

            {selectedBeast?.owned && (() => {
              const tone = rarityTone(selectedBeast.rarity);
              const isCompanion = state.inventory.companionId === selectedBeast.id;
              const neededExperience = experienceForNextLevel(selectedBeast.level);
              const experiencePercent = Math.min(
                100,
                Math.round((selectedBeast.experience / neededExperience) * 100),
              );
              return (
                <View style={styles.detailBody}>
                  <View style={[styles.detailIcon, { backgroundColor: tone.soft }]}><Text style={styles.detailEmoji}>{selectedBeast.icon}</Text></View>
                  <Text style={[styles.detailEyebrow, { color: tone.accent }]}>{selectedBeast.rarity.toLocaleUpperCase('vi')} · HỆ {selectedBeast.element.toLocaleUpperCase('vi')}</Text>
                  <Text style={styles.detailTitle}>{selectedBeast.name}</Text>
                  <Text style={styles.detailDescription}>Sinh vật hệ {selectedBeast.element.toLocaleLowerCase('vi')} chuyên vai trò {selectedBeast.role.toLocaleLowerCase('vi')}.</Text>
                  <View style={styles.statRow}>
                    <View style={styles.miniStat}><Text style={styles.miniStatValue}>Lv.{selectedBeast.level}</Text><Text style={styles.miniStatLabel}>Cấp độ</Text></View>
                    <View style={styles.miniStat}><Text style={styles.miniStatValue}>×{selectedBeast.quantity}</Text><Text style={styles.miniStatLabel}>Số lượng</Text></View>
                    <View style={styles.miniStat}><Text style={styles.miniStatValue}>{selectedBeast.role}</Text><Text style={styles.miniStatLabel}>Vai trò</Text></View>
                  </View>
                  <View style={styles.experienceBox}>
                    <View style={styles.experienceHeader}>
                      <Text style={styles.experienceLabel}>Tiến độ lên cấp</Text>
                      <Text style={styles.experienceValue}>{selectedBeast.experience}/{neededExperience} EXP</Text>
                    </View>
                    <View style={styles.experienceTrack}>
                      <View style={[styles.experienceFill, { width: `${experiencePercent}%` }]} />
                    </View>
                  </View>
                  <View style={styles.buffBox}>
                    <View style={styles.buffIcon}><Ionicons name="sparkles" size={18} color="#7B5D00" /></View>
                    <View style={styles.buffCopy}><Text style={styles.buffLabel}>Năng lực đồng hành</Text><Text style={styles.buffValue}>{selectedBeast.buff}</Text></View>
                  </View>
                  <View style={styles.feedHeader}>
                    <View>
                      <Text style={styles.feedTitle}>Cho pet ăn</Text>
                      <Text style={styles.feedCaption}>Chọn một món trong kho để tăng EXP</Text>
                    </View>
                    <Ionicons name="restaurant-outline" size={21} color={theme.colors.primaryDark} />
                  </View>
                  {availableFoods.length > 0 ? (
                    <ScrollView
                      contentContainerStyle={styles.foodRow}
                      horizontal
                      showsHorizontalScrollIndicator={false}>
                      {availableFoods.map((food) => (
                        <Pressable
                          accessibilityLabel={`Cho ${selectedBeast.name} ăn ${food.name}, tăng ${food.experienceGain} EXP`}
                          accessibilityRole="button"
                          key={food.id}
                          onPress={() => giveFood(selectedBeast.id, food.id)}
                          style={({ pressed }) => [styles.foodCard, pressed && styles.foodCardPressed]}>
                          <Text style={styles.foodEmoji}>{food.icon}</Text>
                          <Text numberOfLines={1} style={styles.foodName}>{food.name}</Text>
                          <Text style={styles.foodExp}>+{food.experienceGain} EXP</Text>
                          <Text style={styles.foodQuantity}>Còn ×{food.quantity}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  ) : (
                    <View style={styles.noFoodBox}>
                      <Text style={styles.noFoodText}>Kho đang hết thức ăn cho pet.</Text>
                    </View>
                  )}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: isCompanion }}
                    disabled={isCompanion}
                    onPress={chooseCompanion}
                    style={[styles.primaryButton, isCompanion && styles.primaryButtonDisabled]}>
                    <Ionicons name={isCompanion ? 'checkmark-circle' : 'star-outline'} size={20} color="#FFFFFF" />
                    <Text style={styles.primaryButtonText}>{isCompanion ? 'Đang đồng hành' : 'Chọn làm bạn đồng hành'}</Text>
                  </Pressable>
                </View>
              );
            })()}

            {selectedItem && (() => {
              const tone = rarityTone(selectedItem.rarity);
              const unavailable = selectedItem.quantity < 1;
              return (
                <View style={styles.detailBody}>
                  <View style={[styles.detailIcon, { backgroundColor: tone.soft }]}><Text style={styles.detailEmoji}>{selectedItem.icon}</Text></View>
                  <Text style={[styles.detailEyebrow, { color: tone.accent }]}>{selectedItem.rarity.toLocaleUpperCase('vi')} · {selectedItem.category.toLocaleUpperCase('vi')}</Text>
                  <Text style={styles.detailTitle}>{selectedItem.name}</Text>
                  <Text style={styles.detailDescription}>{selectedItem.description}</Text>
                  <View style={styles.itemCountBox}>
                    <View>
                      <Text style={styles.itemCountLabel}>Đang có trong kho</Text>
                      <Text style={styles.itemEffect}>Mỗi phần +{selectedItem.experienceGain} EXP</Text>
                    </View>
                    <Text style={styles.itemCountValue}>×{selectedItem.quantity}</Text>
                  </View>
                  <Text style={styles.choosePetTitle}>{unavailable ? 'Vật phẩm đã hết' : 'Chọn pet để cho ăn'}</Text>
                  <ScrollView
                    contentContainerStyle={styles.petTargetRow}
                    horizontal
                    showsHorizontalScrollIndicator={false}>
                    {ownedPets.map((pet) => (
                      <Pressable
                        accessibilityLabel={`Cho ${pet.name} ăn ${selectedItem.name}`}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: unavailable }}
                        disabled={unavailable}
                        key={pet.id}
                        onPress={() => giveFood(pet.id, selectedItem.id)}
                        style={({ pressed }) => [
                          styles.petTargetCard,
                          unavailable && styles.petTargetDisabled,
                          pressed && !unavailable && styles.foodCardPressed,
                        ]}>
                        <Text style={styles.petTargetEmoji}>{pet.icon}</Text>
                        <Text numberOfLines={1} style={styles.petTargetName}>{pet.name}</Text>
                        <Text style={styles.petTargetLevel}>Lv.{pet.level}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                  <Text style={styles.demoNote}>EXP và số lượng thức ăn được lưu trong dữ liệu demo trên thiết bị.</Text>
                </View>
              );
            })()}
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.colors.background },
  listContent: { paddingHorizontal: 18, paddingBottom: 124 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, marginBottom: 16 },
  eyebrow: { color: theme.colors.primaryDark, fontSize: 12, fontWeight: '800', letterSpacing: 1.3 },
  title: { color: theme.colors.text, fontSize: 29, fontWeight: '800', letterSpacing: -0.7, marginTop: 3 },
  headerIcon: { width: 48, height: 48, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceAlt },
  headerEmoji: { fontSize: 25 },
  progressCard: { backgroundColor: theme.colors.surface, borderRadius: 22, padding: 17, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 15 },
  progressTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  progressLabel: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '600' },
  progressValue: { color: theme.colors.text, fontSize: 18, fontWeight: '800', marginTop: 3 },
  progressPercent: { color: theme.colors.primaryDark, fontSize: 17, fontWeight: '800' },
  progressTrack: { height: 8, backgroundColor: theme.colors.surfaceSoft, borderRadius: 8, overflow: 'hidden', marginTop: 13 },
  progressFill: { height: '100%', backgroundColor: theme.colors.primary, borderRadius: 8 },
  segmented: { flexDirection: 'row', padding: 4, borderRadius: 17, backgroundColor: theme.colors.surfaceSoft, marginBottom: 13 },
  segment: { flex: 1, minHeight: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 },
  segmentActive: { backgroundColor: theme.colors.surface },
  segmentText: { color: theme.colors.textMuted, fontSize: 14, fontWeight: '700' },
  segmentTextActive: { color: theme.colors.primaryDark },
  countPill: { minWidth: 22, height: 22, paddingHorizontal: 5, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.border },
  countPillActive: { backgroundColor: theme.colors.surfaceAlt },
  countPillText: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '800' },
  countPillTextActive: { color: theme.colors.primaryDark },
  searchBox: { height: 50, borderRadius: 16, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  searchInput: { flex: 1, color: theme.colors.text, fontSize: 15, paddingVertical: 0 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 11, marginBottom: 20 },
  filterChip: { paddingHorizontal: 13, height: 34, justifyContent: 'center', borderRadius: 17, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  filterChipActive: { backgroundColor: theme.colors.primaryDark, borderColor: theme.colors.primaryDark },
  filterText: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '700' },
  filterTextActive: { color: '#FFFFFF' },
  sectionHeading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 11 },
  sectionTitle: { color: theme.colors.text, fontSize: 17, fontWeight: '800' },
  resultCount: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '600' },
  gridRow: { gap: 11 },
  card: { flex: 1, minWidth: 0, padding: 13, minHeight: 226, borderRadius: 20, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 11 },
  cardPressed: { opacity: 0.76, transform: [{ scale: 0.985 }] },
  cardTop: { minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rarityPill: { paddingHorizontal: 8, height: 23, justifyContent: 'center', borderRadius: 8 },
  rarityText: { fontSize: 10, fontWeight: '800' },
  companionBadge: { width: 23, height: 23, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF1B8' },
  iconWell: { width: 64, height: 64, borderRadius: 24, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginVertical: 10 },
  cardEmoji: { fontSize: 37 },
  lockedEmoji: { color: theme.colors.textMuted, fontSize: 30, fontWeight: '800' },
  cardName: { color: theme.colors.text, fontSize: 14, fontWeight: '800', lineHeight: 18, minHeight: 36 },
  lockedName: { color: theme.colors.textMuted },
  cardMeta: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 15, minHeight: 30, marginTop: 4 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 8 },
  quantity: { color: theme.colors.primaryDark, fontSize: 12, fontWeight: '800' },
  emptyState: { alignItems: 'center', paddingVertical: 44, paddingHorizontal: 24 },
  emptyEmoji: { fontSize: 42 },
  emptyTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '800', marginTop: 12 },
  emptyBody: { color: theme.colors.textMuted, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 5 },
  emptyButton: { marginTop: 16, paddingHorizontal: 18, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceAlt },
  emptyButtonText: { color: theme.colors.primaryDark, fontSize: 14, fontWeight: '800' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingLeaf: { width: 70, height: 70, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceAlt },
  loadingEmoji: { fontSize: 35 },
  loadingText: { color: theme.colors.textMuted, fontSize: 14, fontWeight: '600', marginTop: 12 },
  modalBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(17, 29, 22, 0.48)' },
  sheetSafe: { marginTop: 'auto' },
  sheet: { minHeight: 390, maxHeight: '90%', backgroundColor: theme.colors.surface, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 22, paddingTop: 14, paddingBottom: 16 },
  sheetContent: { paddingTop: 1, paddingBottom: 8 },
  sheetHandle: { width: 42, height: 5, borderRadius: 3, backgroundColor: theme.colors.border, alignSelf: 'center' },
  closeButton: { position: 'absolute', zIndex: 2, top: 17, right: 18, width: 38, height: 38, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceSoft },
  detailBody: { paddingTop: 15 },
  detailIcon: { width: 86, height: 86, borderRadius: 31, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 14 },
  unknownDetailIcon: { backgroundColor: theme.colors.surfaceSoft },
  detailQuestion: { color: theme.colors.textMuted, fontSize: 40, fontWeight: '800' },
  detailEmoji: { fontSize: 48 },
  detailEyebrow: { color: theme.colors.primaryDark, fontSize: 11, fontWeight: '800', letterSpacing: 1, textAlign: 'center' },
  detailTitle: { color: theme.colors.text, fontSize: 24, fontWeight: '800', textAlign: 'center', letterSpacing: -0.4, marginTop: 4 },
  detailDescription: { color: theme.colors.textMuted, fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 7, paddingHorizontal: 4 },
  tipBox: { flexDirection: 'row', gap: 11, alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderRadius: 17, padding: 14, marginTop: 20 },
  tipText: { flex: 1, color: theme.colors.text, fontSize: 13, lineHeight: 18 },
  statRow: { flexDirection: 'row', gap: 8, marginTop: 18 },
  miniStat: { flex: 1, alignItems: 'center', backgroundColor: theme.colors.surfaceSoft, borderRadius: 15, paddingVertical: 11, paddingHorizontal: 4 },
  miniStatValue: { color: theme.colors.text, fontSize: 14, fontWeight: '800' },
  miniStatLabel: { color: theme.colors.textMuted, fontSize: 10, fontWeight: '600', marginTop: 2 },
  experienceBox: { borderRadius: 16, backgroundColor: theme.colors.surfaceSoft, padding: 13, marginTop: 11 },
  experienceHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  experienceLabel: { color: theme.colors.text, fontSize: 12, fontWeight: '700' },
  experienceValue: { color: theme.colors.primaryDark, fontSize: 12, fontWeight: '800' },
  experienceTrack: { height: 7, borderRadius: 7, overflow: 'hidden', backgroundColor: theme.colors.border, marginTop: 9 },
  experienceFill: { height: '100%', borderRadius: 7, backgroundColor: theme.colors.primary },
  buffBox: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 14, borderRadius: 17, backgroundColor: '#FFF7D8', marginTop: 11 },
  buffIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFECA1' },
  buffCopy: { flex: 1 },
  buffLabel: { color: '#806A18', fontSize: 11, fontWeight: '700' },
  buffValue: { color: '#59480C', fontSize: 14, fontWeight: '800', marginTop: 1 },
  feedHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 10 },
  feedTitle: { color: theme.colors.text, fontSize: 15, fontWeight: '800' },
  feedCaption: { color: theme.colors.textMuted, fontSize: 11, marginTop: 2 },
  foodRow: { gap: 9, paddingRight: 8 },
  foodCard: { width: 118, borderRadius: 16, padding: 11, backgroundColor: theme.colors.surfaceSoft, borderWidth: 1, borderColor: theme.colors.border },
  foodCardPressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
  foodEmoji: { fontSize: 27 },
  foodName: { color: theme.colors.text, fontSize: 12, fontWeight: '800', marginTop: 6 },
  foodExp: { color: theme.colors.primaryDark, fontSize: 11, fontWeight: '800', marginTop: 4 },
  foodQuantity: { color: theme.colors.textMuted, fontSize: 10, marginTop: 2 },
  noFoodBox: { borderRadius: 15, padding: 13, backgroundColor: theme.colors.surfaceSoft },
  noFoodText: { color: theme.colors.textMuted, fontSize: 12, textAlign: 'center' },
  itemCountBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 16, backgroundColor: theme.colors.surfaceSoft, padding: 15, marginTop: 20 },
  itemCountLabel: { color: theme.colors.textMuted, fontSize: 13, fontWeight: '600' },
  itemEffect: { color: theme.colors.primaryDark, fontSize: 12, fontWeight: '800', marginTop: 3 },
  itemCountValue: { color: theme.colors.text, fontSize: 17, fontWeight: '800' },
  choosePetTitle: { color: theme.colors.text, fontSize: 15, fontWeight: '800', marginTop: 18, marginBottom: 10 },
  petTargetRow: { gap: 9, paddingRight: 8 },
  petTargetCard: { width: 112, alignItems: 'center', borderRadius: 17, padding: 11, backgroundColor: theme.colors.surfaceSoft, borderWidth: 1, borderColor: theme.colors.border },
  petTargetDisabled: { opacity: 0.45 },
  petTargetEmoji: { fontSize: 31 },
  petTargetName: { width: '100%', color: theme.colors.text, fontSize: 11, fontWeight: '800', textAlign: 'center', marginTop: 5 },
  petTargetLevel: { color: theme.colors.primaryDark, fontSize: 10, fontWeight: '700', marginTop: 3 },
  primaryButton: { height: 52, borderRadius: 17, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primaryDark, marginTop: 18 },
  primaryButtonDisabled: { backgroundColor: theme.colors.textMuted, opacity: 0.65 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  secondaryButton: { height: 50, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceSoft, marginTop: 18 },
  secondaryButtonText: { color: theme.colors.text, fontSize: 15, fontWeight: '800' },
  demoNote: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 10 },
});
