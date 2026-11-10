/** Định nghĩa cấu trúc dữ liệu dùng chung cho cây, chăm sóc, thú nuôi, kinh tế, thư, tài khoản và cài đặt; là hợp đồng kiểu cho trạng thái ứng dụng. */

export type AnalysisLevel = 'Tốt' | 'Chú ý' | 'Cảnh báo';

export interface Analysis {
  level: AnalysisLevel;
  title: string;
  summary: string;
  actions: string[];
}

export type AiMode = 'gemini' | 'demo' | 'legacy';
export type CropKind = 'mango' | 'tomato' | 'chili' | 'other';
export type PlantPhase = 'planning' | 'germinating' | 'seedling' | 'growing' | 'flowering' | 'fruiting';
export interface PlantJourney {
  crop: CropKind;
  phase: PlantPhase;
  method: 'seed' | 'seedling';
  startedAt: string;
  location: string;
  light: string;
  notes: string;
}

export interface CheckIn {
  id: string;
  plantId: string;
  photoId: string;
  analysisId: string;
  date: string;
  time: string;
}

export type CaptureSource = 'camera' | 'library';

export interface PlantPhoto {
  id: string;
  plantId: string;
  imageUri: string;
  date: string;
  time: string;
  source: CaptureSource;
  purpose: 'reference' | 'checkin';
  phase: PlantPhase;
}

export interface PlantAnalysisRecord {
  id: string;
  plantId: string;
  photoId: string;
  date: string;
  time: string;
  result: Analysis;
  mode: AiMode;
}

export interface PlantChibi {
  id: string;
  plantId: string;
  sourcePhotoId: string | null;
  imageUri: string | null;
  fallbackEmoji: string;
  updatedAt: string | null;
}

export interface Plant {
  id: string;
  name: string;
  species: string;
  plantedAt: string;
  stage: string;
  progress: number;
  health: string;
  mood: string;
  streak: number;
  bestStreak: number;
  lastCheckIn: string | null;
  journey: PlantJourney;
  archived?: boolean;
}

export interface PlantChatMessage {
  id: string;
  plantId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  mode: AiMode;
  photoId?: string;
}

export interface CareEvent {
  id: string;
  plantId: string;
  kind: 'water' | 'fertilize' | 'repot' | 'prune' | 'observe' | 'other';
  note: string;
  createdAt: string;
}

export interface DailyGardenRound {
  id: string;
  date: string;
  plantIds: string[];
  inspectedPlantIds: string[];
  createdAt: string;
  completedAt: string | null;
  packId: string | null;
}

export type CardRarity = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary';
export interface DailyPetPack {
  id: string;
  roundId: string;
  date: string;
  beastId: string;
  /** The exact instance delivered by this pack, once claimed. */
  petInstanceId?: string;
  /** New packs start at null; missing on legacy packs already delivered at earning. */
  creditedAt?: string | null;
  rarity: CardRarity;
  isNew: boolean;
  earnedAt: string;
  revealedAt: string | null;
  /** True when any inspection used an explicitly labelled demo analysis. */
  demo: boolean;
  /** Missing on legacy packs: never roll a bonus retroactively. */
  bonusFoodItemId?: string | null;
}

export interface LoginRewardClaim {
  date: string;
  cycleDay: number;
  itemId: string;
  claimedAt: string;
}

/** A visit earns a fixed reward, independent of when it is collected. */
export interface LoginGift {
  id: string;
  date: string;
  cycle: number;
  cycleDay: number;
  itemId: string;
  earnedAt: string;
  claimedAt: string | null;
  mailedAt: string | null;
}

export type MailAttachment = { kind: 'food'; itemId: string; quantity: number }
  | { kind: 'gold'; quantity: number };

/** Publisher delivery needs an authenticated backend; local code creates system mail only. */
export interface MailMessage {
  id: string;
  source: 'system' | 'publisher';
  sourceRef: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  claimedAt: string | null;
  attachments: MailAttachment[];
}

export interface InspectionGoldReward {
  plantId: string;
  date: string;
  gold: number;
}

export interface StreakFoodReward {
  plantId: string;
  milestone: number;
  itemId: string;
  claimedAt: string;
}

export interface FoodPurchase {
  requestId: string;
  itemId: string;
  quantity: number;
  unitPrice: number;
  totalGold: number;
  createdAt: string;
}

export type PetStars = 1 | 2 | 3;
export type PetRarity = 'Thường' | 'Không phổ biến' | 'Hiếm' | 'Sử thi' | 'Huyền thoại';
export type PetFoodLedger = Record<string, number>;
export type PetTransaction = {
  requestId: string;
  petId: string;
  createdAt: string;
} & ({
  kind: 'sell';
  quantity: number;
  unitGold: number;
  totalGold: number;
  /** Missing only on legacy aggregate receipts; never reinterpret them as new instance sales. */
  petIds?: string[];
  refundedFoods?: PetFoodLedger;
} | {
  kind: 'upgrade';
  fromStars: 1 | 2;
  toStars: 2 | 3;
  copies: number;
  gold: number;
  foodQuantity: number;
  foodItemIds: string[];
  materialPetIds?: string[];
  refundedFoods?: PetFoodLedger;
} | {
  kind: 'feed' | 'quick-feed';
  itemId?: string;
  foods: PetFoodLedger;
  experienceGain: number;
  levelBefore: number;
  levelAfter: number;
});

/** Local prototype ledger; authoritative payments require a backend later. */
export interface EconomyState {
  gold: number;
  /** Development-only receipt survives deletion of sample letters. Never auto-grants. */
  demoMailGrantedAt?: string;
  loginClaims: LoginRewardClaim[];
  loginVisits: LoginGift[];
  inspectionRewards: InspectionGoldReward[];
  streakRewards: StreakFoodReward[];
  purchases: FoodPurchase[];
  petTransactions: PetTransaction[];
}

export interface Beast {
  id: string;
  name: string;
  icon: string;
  rarity: PetRarity;
  element: string;
  role: 'Chiến' | 'Hỗ trợ';
  buff: string;
  hint: string;
}

export interface PetInstance {
  id: string;
  speciesId: string;
  level: number;
  experience: number;
  stars: PetStars;
  foodSpent: PetFoodLedger;
  upgradeFoodSpent: PetFoodLedger;
  upgradeGoldSpent: number;
  baseCopies: number;
}

export type PetView = Omit<Beast, 'id'> & PetInstance;

export interface InventoryItem {
  id: string;
  name: string;
  icon: string;
  rarity: PetRarity;
  category: 'Thức ăn' | 'Đồ chơi' | 'Phụ kiện';
  quantity: number;
  experienceGain: number;
  description: string;
}

export type GardenerOutfit = 'leaf' | 'sun' | 'rain';

export interface Profile {
  name: string;
  title: string;
  avatar: string;
  avatarImageUri: string | null;
  /** Mirrored server login email; account settings never edit it separately. */
  email: string;
  phone: string;
  outfit: GardenerOutfit;
}

export type AiTone = 'funny' | 'gentle' | 'expert' | 'minimal';

export interface Settings {
  notifications: boolean;
  /** Old prototype toggles never imply permission to send real reminders. */
  notificationConsent: boolean;
  reminderTime: string;
  lightAR: boolean;
  music: boolean;
  musicConsent: boolean;
  musicUri: string | null;
  musicName: string | null;
  aiTone: AiTone;
  giftDock: { edge: 'left' | 'right' | 'top' | 'bottom'; ratio: number } | null;
  quickSaleRarities: PetRarity[];
}

export interface AuthState {
  loggedIn: boolean;
  remember: boolean;
  identity: string;
  /** Server account ownership; access tokens are stored separately. */
  userId?: string;
}

export interface InventoryState {
  pets: PetInstance[];
  items: InventoryItem[];
}

export interface DailyState {
  lastCatchDate: string | null;
  lastCatchPlantId: string | null;
}

export interface AppState {
  version: 5;
  auth: AuthState;
  profile: Profile;
  plants: Plant[];
  checkIns: CheckIn[];
  plantPhotos: PlantPhoto[];
  plantAnalyses: PlantAnalysisRecord[];
  plantChibis: PlantChibi[];
  chatMessages: PlantChatMessage[];
  careEvents: CareEvent[];
  dailyRounds: DailyGardenRound[];
  dailyPacks: DailyPetPack[];
  economy: EconomyState;
  mailbox: MailMessage[];
  activePlantId: string;
  inventory: InventoryState;
  settings: Settings;
  daily: DailyState;
  battleNotify: boolean;
}
