/** Tự ẩn phản hồi thành công trong khu vườn sau một khoảng ngắn và cho phép hủy bộ hẹn giờ. */
export function scheduleGardenNoticeDismiss(dismiss: () => void) {
  const timer = setTimeout(dismiss, 3000);
  return () => clearTimeout(timer);
}
