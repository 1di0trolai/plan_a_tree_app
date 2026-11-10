/** Quản lý trạng thái và kiểu hiển thị khi điều khiển được tập trung bằng bàn phím; giữ nguyên cơ chế di chuyển và kích hoạt của hệ điều hành. */

import { useState } from "react";
import { INTERACTION } from "@/theme";

// Presentation-only focus state: leaves native traversal and activation intact.
// IDs let mapped controls retain the same component tree and business handlers.
export function useControlFocus() {
  const [focused, setFocused] = useState<string | null>(null);
  return {
    props: (id: string) => ({
      onFocus: () => setFocused(id),
      onBlur: () => setFocused((current) => current === id ? null : current),
    }),
    style: (id: string, inverse = false) => focused === id
      ? inverse ? INTERACTION.focusInverse : INTERACTION.focus
      : undefined,
  };
}
