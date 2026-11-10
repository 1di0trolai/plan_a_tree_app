/** Cung cấp dữ liệu loài thú nuôi, vật phẩm và trạng thái khởi tạo; dùng chung quy tắc kinh nghiệm cùng ngày, giờ theo múi giờ Việt Nam. */

import type { AppState, Beast, InventoryItem } from '../types/app';

export function localDateKey(date = new Date()): string {
  return new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function offsetLocalDate(days: number, from = new Date()): string {
  return localDateKey(new Date(from.getTime() + days * 24 * 60 * 60 * 1000));
}

export function localTimeKey(date = new Date()): string {
  return new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(11, 16);
}

export function experienceForNextLevel(level: number): number {
  return 100 + Math.max(0, level - 1) * 25;
}

/** Species metadata is not an owned pet. Individual pets live in inventory.pets. */
export const PET_SPECIES: readonly Beast[] = [
  {
    id: 'ladybug',
    name: 'Bọ Rùa Lửa',
    icon: '🐞',
    rarity: 'Không phổ biến',
    element: 'Lửa',
    role: 'Chiến',
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
    buff: '+5% tốc độ',
    hint: 'Dễ gặp vào buổi sáng',
  },
  {
    id: 'moon-moth',
    name: 'Bướm Ánh Trăng',
    icon: '🦋',
    rarity: 'Sử thi',
    element: 'Gió',
    role: 'Hỗ trợ',
    buff: '+15% may mắn',
    hint: 'Thẻ Sử thi từ phần thưởng kiểm tra cả vườn',
  },
  {
    id: 'dew-snail',
    name: 'Ốc Sên Giọt Sương',
    icon: '🐌',
    rarity: 'Thường',
    element: 'Nước',
    role: 'Hỗ trợ',
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
    buff: '+20% phòng thủ',
    hint: 'Thẻ Huyền thoại từ phần thưởng kiểm tra cả vườn',
  },
];

function createItems(): InventoryItem[] {
  return [
    {
      id: 'berry-bites',
      name: 'Quả Mọng',
      icon: '🍓',
      rarity: 'Thường',
      category: 'Thức ăn',
      quantity: 0,
      experienceGain: 25,
      description: 'Một phần ăn nhẹ thơm ngọt, phù hợp với mọi thú nuôi.',
    },
    {
      id: 'rice-bowl',
      name: 'Cơm Trắng',
      icon: '🍚',
      rarity: 'Không phổ biến',
      category: 'Thức ăn',
      quantity: 0,
      experienceGain: 45,
      description: 'Một bát cơm ấm, tiếp thêm năng lượng cho thú nuôi.',
    },
    {
      id: 'honey-cookie',
      name: 'Bánh Ngọt',
      icon: '🍯',
      rarity: 'Hiếm',
      category: 'Thức ăn',
      quantity: 0,
      experienceGain: 60,
      description: 'Món bánh giàu năng lượng giúp thú nuôi lớn nhanh hơn.',
    },
    {
      id: 'forest-milk',
      name: 'Sữa Tươi',
      icon: '🥛',
      rarity: 'Hiếm',
      category: 'Thức ăn',
      quantity: 0,
      experienceGain: 90,
      description: 'Sữa dinh dưỡng đặc biệt dành cho những chuyến phiêu lưu dài.',
    },
    {
      id: 'ramen-bowl',
      name: 'Mì Ramen',
      icon: '🍜',
      rarity: 'Sử thi',
      category: 'Thức ăn',
      quantity: 0,
      experienceGain: 120,
      description: 'Tô mì đầy đặn cho thú nuôi nạp năng lượng sau chuyến phiêu lưu.',
    },
    {
      id: 'star-snack',
      name: 'Bánh Sao',
      icon: '⭐',
      rarity: 'Huyền thoại',
      category: 'Thức ăn',
      quantity: 0,
      experienceGain: 150,
      description: 'Bánh hình ngôi sao, mang lại nhiều kinh nghiệm cho thú nuôi.',
    },
  ];
}

export function createInitialState(): AppState {
  return {
    version: 5,
    auth: {
      loggedIn: false,
      remember: false,
      identity: '',
    },
    profile: {
      name: 'Người trồng cây',
      title: 'Bắt đầu hành trình',
      avatar: '🧑‍🌾',
      avatarImageUri: null,
      email: '',
      phone: '',
      outfit: 'leaf',
    },
    plants: [],
    checkIns: [],
    plantPhotos: [],
    plantAnalyses: [],
    plantChibis: [],
    chatMessages: [],
    careEvents: [],
    dailyRounds: [],
    dailyPacks: [],
    economy: { gold: 0, loginClaims: [], loginVisits: [], inspectionRewards: [], streakRewards: [], purchases: [], petTransactions: [] },
    mailbox: [],
    activePlantId: '',
    inventory: {
      pets: [],
      items: createItems(),
    },
    settings: {
      notifications: false,
      notificationConsent: false,
      reminderTime: '08:00',
      lightAR: false,
      music: false,
      musicConsent: false,
      musicUri: null,
      musicName: null,
      aiTone: 'funny',
      giftDock: null,
      quickSaleRarities: ['Thường'],
    },
    daily: {
      lastCatchDate: null,
      lastCatchPlantId: null,
    },
    battleNotify: false,
  };
}
