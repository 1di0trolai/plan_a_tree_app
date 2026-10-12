export type AnalysisLevel = 'Tốt' | 'Chú ý' | 'Cảnh báo';

export interface Analysis {
  level: AnalysisLevel;
  title: string;
  summary: string;
  actions: string[];
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
}

export interface PlantAnalysisRecord {
  id: string;
  plantId: string;
  photoId: string;
  date: string;
  time: string;
  result: Analysis;
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
}

export interface Beast {
  id: string;
  name: string;
  icon: string;
  rarity: 'Thường' | 'Hiếm' | 'Sử thi' | 'Huyền thoại';
  element: string;
  role: 'Chiến' | 'Hỗ trợ';
  level: number;
  experience: number;
  quantity: number;
  owned: boolean;
  buff: string;
  hint: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  icon: string;
  rarity: 'Thường' | 'Hiếm' | 'Sự kiện';
  category: 'Thức ăn' | 'Đồ chơi' | 'Phụ kiện';
  quantity: number;
  experienceGain: number;
  description: string;
}

export interface Profile {
  name: string;
  title: string;
  avatar: string;
  avatarImageUri: string | null;
}

export type AiTone = 'funny' | 'gentle' | 'expert' | 'minimal';

export interface Settings {
  notifications: boolean;
  reminderTime: string;
  lightAR: boolean;
  music: boolean;
  aiTone: AiTone;
}

export interface AuthState {
  loggedIn: boolean;
  remember: boolean;
  identity: string;
}

export interface InventoryState {
  beasts: Beast[];
  items: InventoryItem[];
  companionId: string | null;
}

export interface DailyState {
  lastCatchDate: string | null;
  lastCatchPlantId: string | null;
}

export interface AppState {
  version: 2;
  auth: AuthState;
  profile: Profile;
  plants: Plant[];
  checkIns: CheckIn[];
  plantPhotos: PlantPhoto[];
  plantAnalyses: PlantAnalysisRecord[];
  plantChibis: PlantChibi[];
  activePlantId: string;
  inventory: InventoryState;
  settings: Settings;
  daily: DailyState;
  battleNotify: boolean;
}
