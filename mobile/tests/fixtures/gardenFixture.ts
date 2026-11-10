/** Tạo dữ liệu khu vườn mẫu độc lập cho kiểm thử, không dùng làm dữ liệu khởi tạo của ứng dụng thật. */

import type { Analysis, AppState, CheckIn, Plant, PlantAnalysisRecord, PlantChibi, PlantPhoto } from '../../src/types/app';
import { createInitialState, offsetLocalDate } from '../../src/data/seed';
import { createPetInstance } from '../../src/store/petCollection';

// Historical demo data belongs to tests only, never the production initial state.
const GOOD_ANALYSIS: Analysis = {
  level: 'Tốt',
  title: 'Lá xanh và đều màu',
  summary: 'Chưa thấy dấu hiệu sâu bệnh trong ảnh gần nhất.',
  actions: [
    'Duy trì tưới vào buổi sáng',
    'Xoay chậu 1/4 vòng mỗi 3 ngày',
    'Tỉa lá già sát gốc',
  ],
};

const DRY_ANALYSIS: Analysis = {
  level: 'Chú ý',
  title: 'Đất đang hơi khô',
  summary: 'Cây vẫn khỏe nhưng nên được tưới trong hôm nay.',
  actions: [
    'Tưới 150–200 ml nước',
    'Đặt cây ở nơi có ánh sáng tán xạ',
    'Kiểm tra lại độ ẩm đất sau 6 giờ',
  ],
};

const CACTUS_ANALYSIS: Analysis = {
  level: 'Tốt',
  title: 'Thân cây căng khỏe',
  summary: 'Độ ẩm phù hợp, chưa cần tưới thêm.',
  actions: [
    'Chưa tưới thêm trong 3 ngày',
    'Đảm bảo chậu thoát nước tốt',
    'Cho cây nhận nắng sáng 2–3 giờ',
  ],
};

function copyAnalysis(analysis: Analysis): Analysis {
  return { ...analysis, actions: [...analysis.actions] };
}

function createPlantData(): {
  plants: Plant[];
  checkIns: CheckIn[];
  plantPhotos: PlantPhoto[];
  plantAnalyses: PlantAnalysisRecord[];
  plantChibis: PlantChibi[];
} {
  const plants: Plant[] = [
    {
      id: 'plant-map',
      name: 'Bé Mập',
      species: 'Monstera',
      plantedAt: offsetLocalDate(-32),
      stage: 'Cây non',
      progress: 62,
      health: 'Khỏe mạnh',
      mood: 'Hơi khát nước',
      streak: 16,
      bestStreak: 16,
      lastCheckIn: offsetLocalDate(-1),
      journey: { crop: 'other', phase: 'seedling', method: 'seedling', startedAt: offsetLocalDate(-32), location: '', light: '', notes: 'Cây mẫu để thử giao diện.' },
    },
    {
      id: 'plant-mint',
      name: 'Minty',
      species: 'Bạc hà',
      plantedAt: offsetLocalDate(-48),
      stage: 'Đang lớn',
      progress: 78,
      health: 'Tươi tốt',
      mood: 'Muốn tắm nắng',
      streak: 8,
      bestStreak: 12,
      lastCheckIn: offsetLocalDate(-1),
      journey: { crop: 'other', phase: 'growing', method: 'seedling', startedAt: offsetLocalDate(-48), location: '', light: '', notes: 'Cây mẫu để thử giao diện.' },
    },
    {
      id: 'plant-cactus',
      name: 'Gai Nhỏ',
      species: 'Xương rồng',
      plantedAt: offsetLocalDate(-75),
      stage: 'Trưởng thành',
      progress: 92,
      health: 'Ổn định',
      mood: 'Đủ nước rồi',
      streak: 4,
      bestStreak: 9,
      lastCheckIn: offsetLocalDate(-2),
      journey: { crop: 'other', phase: 'growing', method: 'seedling', startedAt: offsetLocalDate(-75), location: '', light: '', notes: 'Cây mẫu để thử giao diện.' },
    },
  ];

  const seededEntries = [
    { plantId: 'plant-map', prefix: 'map', time: '07:58', date: offsetLocalDate(-1), analysis: DRY_ANALYSIS },
    { plantId: 'plant-mint', prefix: 'mint', time: '07:35', date: offsetLocalDate(-1), analysis: GOOD_ANALYSIS },
    { plantId: 'plant-cactus', prefix: 'cactus', time: '09:02', date: offsetLocalDate(-2), analysis: CACTUS_ANALYSIS },
  ];
  const plantPhotos: PlantPhoto[] = seededEntries.map((entry) => ({
    id: `${entry.prefix}-photo-1`,
    plantId: entry.plantId,
    imageUri: '',
    date: entry.date,
    time: entry.time,
    source: 'library',
    purpose: 'checkin',
    phase: 'growing',
  }));
  const plantAnalyses: PlantAnalysisRecord[] = seededEntries.map((entry) => ({
    id: `${entry.prefix}-analysis-1`,
    plantId: entry.plantId,
    photoId: `${entry.prefix}-photo-1`,
    date: entry.date,
    time: entry.time,
    result: copyAnalysis(entry.analysis),
    mode: 'demo',
  }));
  const checkIns: CheckIn[] = seededEntries.map((entry) => ({
    id: `${entry.prefix}-checkin-1`,
    plantId: entry.plantId,
    photoId: `${entry.prefix}-photo-1`,
    analysisId: `${entry.prefix}-analysis-1`,
    date: entry.date,
    time: entry.time,
  }));
  const plantChibis: PlantChibi[] = [
    { id: 'chibi-map', plantId: 'plant-map', sourcePhotoId: null, imageUri: null, fallbackEmoji: '🌿', updatedAt: null },
    { id: 'chibi-mint', plantId: 'plant-mint', sourcePhotoId: null, imageUri: null, fallbackEmoji: '🪴', updatedAt: null },
    { id: 'chibi-cactus', plantId: 'plant-cactus', sourcePhotoId: null, imageUri: null, fallbackEmoji: '🌵', updatedAt: null },
  ];

  return { plants, checkIns, plantPhotos, plantAnalyses, plantChibis };
}

export function createGardenFixture(): AppState {
  const initial = createInitialState();
  const plantData = createPlantData();
  const stock: Record<string, number> = { 'berry-bites': 5, 'honey-cookie': 3, 'forest-milk': 2, 'star-snack': 1 };
  return {
    ...initial,
    auth: { loggedIn: false, remember: false, identity: 'demo@pat.vn' },
    profile: { ...createInitialState().profile, name: 'Lâm Chill', title: 'Nông dân Ban Công Lv.4', avatar: '🧑‍🌾', avatarImageUri: null },
    ...plantData,
    activePlantId: plantData.plants[0].id,
    inventory: {
      pets: [
        { ...createPetInstance('ladybug', 'ladybug'), level: 15, experience: 420 },
        { ...createPetInstance('caterpillar', 'caterpillar'), level: 8, experience: 75 },
        createPetInstance('caterpillar', 'caterpillar-copy'),
      ],
      items: initial.inventory.items.map((item) => ({ ...item, quantity: stock[item.id] ?? 0 })),
    },
  };
}
