/** Hợp đồng công khai của useApp; tách riêng để các module nghiệp vụ không phụ thuộc vòng vào AppStore. */
import type { AuthUser, SocialProvider } from '../services/accountAuth';
import type { AccountProfileInput } from '../utils/profilePreferences';
import type { AppState, CareEvent, DailyPetPack, Plant, PlantChatMessage, PlantJourney, Profile, Settings } from '../types/app';
import type { SyncStatus } from './cloudStorage';
import type { FoodPurchaseInput } from './economyActions';
import type { PurchaseResult, ClaimLoginResult, PetTransactionResult } from './economyTransactions';
import type { CareEventInput, ChatMessageInput, CreateJourneyInput, InspectionInput, InspectionResult } from './journeyActions';
import type { MessageResult, PetTransactionInput, SellPetCopiesInput, UpgradePetInput, FeedPetInput, QuickFeedPetInput } from './petActions';

export type ActionResult = { ok: boolean; message?: string; cancelled?: boolean };

export interface AppContextValue {
  ready: boolean;
  storageError: string | null;
  syncStatus: SyncStatus;
  retrySync: () => Promise<MessageResult>;
  reloadCloud: () => Promise<MessageResult>;
  retryStorage: () => void;
  state: AppState;
  activePlant: Plant | null;
  setActivePlantIndex: (index: number) => void;
  login: (identity: string, password: string, remember: boolean) => Promise<ActionResult>;
  loginSocial: (provider: SocialProvider, remember: boolean) => Promise<ActionResult>;
  linkSocial: (provider: SocialProvider) => Promise<ActionResult>;
  account: AuthUser | null;
  rememberedEmail: string;
  /** Chỉ ở trong bộ nhớ/SecureStore, không nằm trong AppState hoặc bản lưu máy chủ. */
  rememberedPassword: string;
  rememberLogin: boolean;
  updateRememberLogin: (enabled: boolean) => Promise<ActionResult>;
  register: (name: string, email: string, password: string) => Promise<ActionResult>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<MessageResult>;
  requestPasswordReset: (email: string) => Promise<MessageResult>;
  resetPassword: (token: string, newPassword: string) => Promise<MessageResult>;
  logout: () => void;
  removePlant: (id: string) => MessageResult;
  restorePlant: (id: string) => MessageResult;
  createJourney: (input: CreateJourneyInput) => Plant;
  updateJourney: (plantId: string, updates: Partial<PlantJourney>) => MessageResult;
  saveInspection: (input: InspectionInput) => InspectionResult;
  appendChatMessage: (input: ChatMessageInput) => PlantChatMessage;
  recordCareEvent: (input: CareEventInput) => CareEvent;
  openDailyPack: (packId: string) => DailyPetPack | null;
  /** Chờ ghi toàn bộ trạng thái xuống SQLite trước khi hiện kết quả nhận quà. */
  persistNow: () => Promise<void>;
  feedPet: (input: FeedPetInput) => Promise<PetTransactionResult>;
  quickFeedPet: (input: QuickFeedPetInput) => Promise<PetTransactionResult>;
  sellPetCopies: (input: SellPetCopiesInput) => Promise<PetTransactionResult>;
  upgradePet: (input: UpgradePetInput) => Promise<PetTransactionResult>;
  pendingPetTransaction: PetTransactionInput | null;
  purchaseFood: (input: FoodPurchaseInput) => Promise<PurchaseResult>;
  pendingFoodPurchase: FoodPurchaseInput | null;
  claimLoginReward: (giftId?: string) => Promise<ClaimLoginResult>;
  syncLoginVisit: () => Promise<PurchaseResult>;
  markMailRead: (id: string) => Promise<PurchaseResult>;
  markAllMailRead: () => Promise<PurchaseResult>;
  claimMail: (id: string) => Promise<PurchaseResult>;
  claimAllMail: () => Promise<PurchaseResult>;
  deleteMail: (id: string) => Promise<PurchaseResult>;
  deleteAllMail: () => Promise<PurchaseResult>;
  retryRewardAction: () => Promise<PurchaseResult>;
  pendingRewardAction: boolean;
  updateProfile: (updates: Partial<Profile>) => void;
  updateAccountProfile: (updates: AccountProfileInput) => Promise<ActionResult>;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}
