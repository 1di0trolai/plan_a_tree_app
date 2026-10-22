import type { Analysis } from '../types/app';

function cloneAnalysis(analysis: Analysis): Analysis {
  return { ...analysis, actions: [...analysis.actions] };
}

export function hashText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function fakeAnalysis(plantId: string, date: string): Analysis {
  const results: Analysis[] = [
    {
      level: 'Tốt',
      title: 'Cây trông rất khỏe',
      summary: 'Lá có màu đồng đều và chưa thấy dấu hiệu sâu bệnh rõ ràng.',
      actions: ['Giữ lịch tưới hiện tại', 'Tiếp tục đặt cây ở nơi sáng tán xạ'],
    },
    {
      level: 'Chú ý',
      title: 'Cây có dấu hiệu thiếu nước nhẹ',
      summary: 'Một vài mép lá hơi rũ. Đây là kết quả mô phỏng từ ảnh bạn chọn.',
      actions: ['Kiểm tra độ ẩm đất', 'Tưới chậm nếu 2–3 cm mặt đất đã khô'],
    },
    {
      level: 'Chú ý',
      title: 'Nên bổ sung ánh sáng',
      summary: 'Tán lá có vẻ đang hướng về một phía để tìm nguồn sáng.',
      actions: ['Đưa cây gần cửa sổ hơn', 'Xoay chậu 1/4 vòng sau mỗi 3 ngày'],
    },
    {
      level: 'Cảnh báo',
      title: 'Phát hiện đốm lá cần theo dõi',
      summary: 'Ảnh có vùng màu bất thường. Hãy kiểm tra trực tiếp trước khi xử lý.',
      actions: ['Cách ly lá có đốm nếu lan rộng', 'Giữ lá khô và tăng thông thoáng'],
    },
  ];
  return cloneAnalysis(results[hashText(`${plantId}:${date}`) % results.length]);
}

export function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function stageForProgress(progress: number): string {
  if (progress >= 90) return 'Trưởng thành';
  if (progress >= 65) return 'Đang lớn';
  return 'Cây non';
}
