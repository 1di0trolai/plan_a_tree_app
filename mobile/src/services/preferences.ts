/** Kết nối quyền và lịch thông báo chăm vườn với hệ điều hành; quản lý dọn các bản nhạc riêng cũ và tạm dừng tác vụ khi đặt lại tùy chọn. */

import { Directory, File, Paths } from "expo-file-system";
import * as Notifications from "expo-notifications";
import { AndroidImportance, IosAuthorizationStatus } from "expo-notifications";
import { Platform } from "react-native";

import {
  GARDEN_REMINDER_OWNER,
  hasPendingGardenCare,
} from "./gardenReminderPlan";
import {
  createDailyReminderController,
  type DailyReminderRequest,
} from "./reminderController";
import { setPreferenceEffectsSuspended } from "./preferenceStatus";

export const DAILY_REMINDER_ID = GARDEN_REMINDER_OWNER;
const REMINDER_CHANNEL = "pat-garden-reminders";
// Read-only legacy cleanup: new versions play the bundled track instead of copies.
const MUSIC_FILE_PATTERN =
  /^\d+-[a-z0-9]+\.(mp3|m4a|aac|wav|ogg|opus|flac|caf)$/i;
const musicDirectory = new Directory(Paths.document, "pat-music");
let resetLocked = false;
let currentReminderRequest: DailyReminderRequest | null = null;

function ownsReminder(identifier: string, data?: Record<string, unknown> | null) {
  return identifier === DAILY_REMINDER_ID || data?.patReminder === DAILY_REMINDER_ID;
}

function permissionAllowed(
  permission: Notifications.NotificationPermissionsStatus,
): boolean {
  return (
    permission.granted ||
    permission.ios?.status === IosAuthorizationStatus.PROVISIONAL
  );
}

async function ensureReminderChannel() {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL, {
      name: "Nhắc thăm vườn",
      importance: AndroidImportance.DEFAULT,
      sound: "default",
    });
  }
}

/** Must only be called after an explicit tap, never by the background effect. */
export async function requestReminderPermission(): Promise<boolean> {
  await ensureReminderChannel();
  let permission = await Notifications.getPermissionsAsync();
  if (!permissionAllowed(permission) && permission.canAskAgain) {
    permission = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    });
  }
  return permissionAllowed(permission);
}

const synchronize = createDailyReminderController({
  list: async () =>
    (await Notifications.getAllScheduledNotificationsAsync())
      .filter(
        (entry) => ownsReminder(entry.identifier, entry.content.data),
      )
      .map((entry) => ({
        id: entry.identifier,
        signature: String(entry.content.data?.signature ?? ""),
      })),
  allowed: async () => {
    const allowed = permissionAllowed(await Notifications.getPermissionsAsync());
    if (allowed) await ensureReminderChannel();
    return allowed;
  },
  cancel: (id) => Notifications.cancelScheduledNotificationAsync(id),
  schedule: async (reminder) => {
    await Notifications.scheduleNotificationAsync({
      identifier: reminder.id,
      content: {
        title: reminder.title,
        body: reminder.body,
        sound: "default",
        data: { patReminder: DAILY_REMINDER_ID, date: reminder.date, signature: reminder.signature },
      },
      // Best effort deliberately avoids exact-alarm special access. Delivery may
      // be delayed by battery-saving or Do Not Disturb settings on the device.
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(reminder.at),
        channelId: REMINDER_CHANNEL,
        delivery: "bestEffort",
      },
    });
  },
});

export function syncDailyReminder(request: DailyReminderRequest) {
  currentReminderRequest = { ...request, enabled: request.enabled && !resetLocked };
  return synchronize(currentReminderRequest);
}

export async function cancelDailyReminders(): Promise<void> {
  currentReminderRequest = { enabled: false, time: "08:00" };
  await synchronize(currentReminderRequest);
  const presented = await Notifications.getPresentedNotificationsAsync();
  await Promise.all(
    presented
      .filter(
        (entry) => ownsReminder(entry.request.identifier, entry.request.content.data),
      )
      .map((entry) =>
        Notifications.dismissNotificationAsync(entry.request.identifier),
      ),
  );
}

export function installReminderPresentationHandler(): () => void {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const ours =
        notification.request.content.data?.patReminder === DAILY_REMINDER_ID;
      // A just-completed check may race a notification already handed to the OS.
      const pending = Boolean(currentReminderRequest?.enabled &&
        currentReminderRequest.garden && hasPendingGardenCare(currentReminderRequest.garden));
      return {
        shouldShowBanner: ours && !resetLocked && pending,
        shouldShowList: ours && !resetLocked && pending,
        shouldPlaySound: false,
        shouldSetBadge: false,
      };
    },
  });
  return () => Notifications.setNotificationHandler(null);
}

export function isOwnedMusicUri(uri: string): boolean {
  const prefix = `${musicDirectory.uri.replace(/\/$/, "")}/`;
  return (
    uri.startsWith(prefix) && MUSIC_FILE_PATTERN.test(uri.slice(prefix.length))
  );
}

export function listBackgroundMusicUris(): string[] {
  if (!musicDirectory.exists) return [];
  return musicDirectory
    .list()
    .filter((entry): entry is File => entry instanceof File && entry.exists)
    .map((file) => file.uri)
    .filter(isOwnedMusicUri);
}

/** Only generated filenames within PAT's private music directory are removable. */
export function deleteBackgroundMusicFile(uri: string): void {
  if (!isOwnedMusicUri(uri)) return;
  const file = new File(uri);
  if (file.exists) file.delete();
}

/** Suspend playback and reminder changes throughout the durable data reset. */
export async function withPreferenceReset<T>(
  operation: () => Promise<T>,
  cancelReminders = true,
): Promise<T> {
  if (resetLocked) throw new Error("PAT đang đặt lại dữ liệu. Vui lòng đợi.");
  resetLocked = true;
  setPreferenceEffectsSuspended(true);
  try {
    if (cancelReminders) await cancelDailyReminders();
    return await operation();
  } finally {
    resetLocked = false;
    setPreferenceEffectsSuspended(false);
  }
}
