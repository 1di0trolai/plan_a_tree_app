/** Xếp hàng cập nhật lịch nhắc chăm vườn và đối chiếu lịch đang có; hủy yêu cầu cũ để thao tác bật muộn không ghi đè thao tác tắt hoặc đặt lại. */

import {
  buildGardenReminderPlan,
  type GardenReminder,
  type ReminderGarden,
} from "./gardenReminderPlan";

export interface DailyReminderPort {
  /** Only PAT garden reminders, never unrelated notifications. */
  list: () => Promise<{ id: string; signature: string }[]>;
  allowed: () => Promise<boolean>;
  cancel: (id: string) => Promise<void>;
  schedule: (reminder: GardenReminder) => Promise<void>;
}

export interface DailyReminderRequest {
  enabled: boolean;
  time: string;
  garden?: ReminderGarden;
  now?: Date;
}
export interface DailyReminderResult {
  enabled: boolean;
  reason?: "permission" | "superseded";
}

/** Serialize native side effects so a late enable cannot undo disable/reset. */
export function createDailyReminderController(port: DailyReminderPort) {
  let queue: Promise<unknown> = Promise.resolve();
  let latest = 0;
  return (request: DailyReminderRequest): Promise<DailyReminderResult> => {
    const ticket = ++latest;
    const operation = queue.catch(() => {}).then(async (): Promise<DailyReminderResult> => {
      if (ticket !== latest) return { enabled: false, reason: "superseded" };
      // Validate and build before changing existing schedules.
      const plan = request.enabled
        ? buildGardenReminderPlan(request.garden ?? { plants: [], dailyRounds: [] }, request.time, request.now)
        : [];
      const current = await port.list();
      const allowed = request.enabled && await port.allowed();
      if (ticket !== latest) return { enabled: false, reason: "superseded" };
      const desired = new Map((allowed ? plan : []).map((entry) => [entry.id, entry]));
      const retained = new Set<string>();
      for (const reminder of current) {
        if (ticket !== latest) return { enabled: false, reason: "superseded" };
        if (desired.get(reminder.id)?.signature === reminder.signature) retained.add(reminder.id);
        else await port.cancel(reminder.id);
      }
      if (!allowed) return { enabled: false, ...(request.enabled ? { reason: "permission" as const } : {}) };
      for (const reminder of plan) {
        if (ticket !== latest) return { enabled: false, reason: "superseded" };
        if (!retained.has(reminder.id)) await port.schedule(reminder);
      }
      return ticket === latest ? { enabled: true } : { enabled: false, reason: "superseded" };
    });
    queue = operation;
    return operation;
  };
}
