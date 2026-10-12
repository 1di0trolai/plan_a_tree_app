import type {
  Analysis,
  AppState,
  Beast,
  CheckIn,
  InventoryItem,
  Plant,
  PlantAnalysisRecord,
  PlantChibi,
  PlantPhoto,
} from '../types/app';

export function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function offsetLocalDate(days: number, from = new Date()): string {
  const date = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

export function localTimeKey(date = new Date()): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function experienceForNextLevel(level: number): number {
  return 100 + Math.max(0, level - 1) * 25;
}

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
  }));
  const plantAnalyses: PlantAnalysisRecord[] = seededEntries.map((entry) => ({
    id: `${entry.prefix}-analysis-1`,
    plantId: entry.plantId,
    photoId: `${entry.prefix}-photo-1`,
    date: entry.date,
    time: entry.time,
    result: copyAnalysis(entry.analysis),
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

function createBeasts(): Beast[] {
  return [
    {
      id: 'ladybug',
      name: 'Bọ Rùa Lửa',
      icon: '🐞',
      rarity: 'Hiếm',
      element: 'Lửa',
      role: 'Chiến',
      level: 15,
      experience: 420,
      quantity: 1,
      owned: true,
      buff: '+12% sức mạnh',
      hint: 'Xuất hiện quanh cây khỏe mạnh',
    },
    {
      id: 'caterpillar',
      name: 'Sâu Phàm Ăn',
      icon: '🐛',
      rarity: 'Thường',
      element: 'Lá',
      role: 'Hỗ trợ',
      level: 8,
      experience: 75,
      quantity: 1,
      owned: true,
      buff: '+5% tăng trưởng',
      hint: 'Thích những tán lá xanh',
    },
    {
      id: 'hunter-bee',
      name: 'Ong Thợ Săn',
      icon: '🐝',
      rarity: 'Hiếm',
      element: 'Điện',
      role: 'Chiến',
      level: 12,
      experience: 190,
      quantity: 1,
      owned: true,
      buff: '+5% tốc độ',
      hint: 'Dễ gặp vào buổi sáng',
    },
    {
      id: 'moon-moth',
      name: 'Bướm Đêm Ánh Trăng',
      icon: '🦋',
      rarity: 'Sử thi',
      element: 'Gió',
      role: 'Hỗ trợ',
      level: 1,
      experience: 0,
      quantity: 0,
      owned: false,
      buff: '+15% may mắn',
      hint: 'Hãy quét AR cạnh cây vào chiều tối',
    },
    {
      id: 'dew-snail',
      name: 'Ốc Sên Giọt Sương',
      icon: '🐌',
      rarity: 'Thường',
      element: 'Nước',
      role: 'Hỗ trợ',
      level: 1,
      experience: 0,
      quantity: 0,
      owned: false,
      buff: '+8% hồi phục',
      hint: 'Có thể xuất hiện khi cây vừa được tưới',
    },
    {
      id: 'mantis',
      name: 'Bọ Ngựa Hộ Vệ',
      icon: '🦗',
      rarity: 'Huyền thoại',
      element: 'Lá',
      role: 'Chiến',
      level: 1,
      experience: 0,
      quantity: 0,
      owned: false,
      buff: '+20% phòng thủ',
      hint: 'Một sinh vật cực kỳ hiếm',
    },
  ];
}

function createItems(): InventoryItem[] {
  return [
    {
      id: 'berry-bites',
      name: 'Kẹo Quả Mọng',
      icon: '🍓',
      rarity: 'Thường',
      category: 'Thức ăn',
      quantity: 5,
      experienceGain: 25,
      description: 'Một phần ăn nhẹ thơm ngọt, phù hợp với mọi pet.',
    },
    {
      id: 'honey-cookie',
      name: 'Bánh Mật Ong',
      icon: '🍯',
      rarity: 'Hiếm',
      category: 'Thức ăn',
      quantity: 3,
      experienceGain: 60,
      description: 'Món bánh giàu năng lượng giúp pet lớn nhanh hơn.',
    },
    {
      id: 'forest-milk',
      name: 'Sữa Mầm Rừng',
      icon: '🥛',
      rarity: 'Hiếm',
      category: 'Thức ăn',
      quantity: 2,
      experienceGain: 90,
      description: 'Sữa dinh dưỡng đặc biệt dành cho những chuyến phiêu lưu dài.',
    },
    {
      id: 'star-snack',
      name: 'Bánh Sao',
      icon: '⭐',
      rarity: 'Sự kiện',
      category: 'Thức ăn',
      quantity: 1,
      experienceGain: 150,
      description: 'Món ăn giới hạn tỏa sáng, mang lại lượng lớn EXP cho pet.',
    },
  ];
}

export function createSeedState(): AppState {
  const plantData = createPlantData();

  return {
    version: 2,
    auth: {
      loggedIn: false,
      remember: false,
      identity: 'demo@pat.vn',
    },
    profile: {
      name: 'Lâm Chill',
      title: 'Nông dân Ban Công Lv.4',
      avatar: '🧑‍🌾',
      avatarImageUri: null,
    },
    ...plantData,
    activePlantId: plantData.plants[0].id,
    inventory: {
      beasts: createBeasts(),
      items: createItems(),
      companionId: 'ladybug',
    },
    settings: {
      notifications: true,
      reminderTime: '08:00',
      lightAR: false,
      music: true,
      aiTone: 'funny',
    },
    daily: {
      lastCatchDate: null,
      lastCatchPlantId: null,
    },
    battleNotify: false,
  };
}
