/** Kiểm thử lớp tích hợp thông báo gốc, cấp quyền và dọn tài nguyên nhạc chỉ trong phạm vi PAT. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

import { createDailyReminderController } from "../src/services/reminderController";
import * as gardenReminderPlan from "../src/services/gardenReminderPlan";
import { createGardenFixture } from "./fixtures/gardenFixture";
import { localDateKey } from "../src/data/seed";
import { viI18n } from "./fixtures/i18nFixture";

const compiled = ts.transpileModule(
  readFileSync(resolve(__dirname, "../src/services/preferences.ts"), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;

function adapter() {
  const source = "file:///picker-cache/track.mp3";
  const directory = "file:///documents/pat-music";
  const files = new Map<string, number>([[source, 1024]]);
  const deleted: string[] = [];
  const canceled: string[] = [];
  const dismissed: string[] = [];
  const scheduled: Record<string, unknown>[] = [];
  let requests = 0;
  let granted = false;
  let canAskAgain = true;
  type Presented = { request: { identifier: string; content: { data: Record<string, unknown> } } };
  let presentation: { handleNotification: (notification: Presented) => Promise<Record<string, boolean>> } | null = null;
  const pending = [
    {
      identifier: "unrelated",
      content: { data: { patReminder: "something-else", time: "08:00" } },
    },
    {
      identifier: "pat-daily-garden-v1",
      content: { data: { patReminder: "pat-daily-garden-v1", time: "08:00" } },
    },
  ];
  class NativeDirectory {
    uri: string;
    constructor(parent: string, name: string) {
      this.uri = `${parent}/${name}`;
    }
    get exists() {
      return true;
    }
    list() {
      return [...files.keys()]
        .filter((uri) => uri.startsWith(`${this.uri}/`))
        .map((uri) => new NativeFile(uri));
    }
  }
  class NativeFile {
    uri: string;
    constructor(parent: string | NativeDirectory, name?: string) {
      this.uri = name
        ? `${(parent as NativeDirectory).uri}/${name}`
        : (parent as string);
    }
    get exists() {
      return files.has(this.uri);
    }
    get size() {
      return files.get(this.uri) ?? 0;
    }
    delete() {
      deleted.push(this.uri);
      files.delete(this.uri);
    }
  }
  const notifications = {
    IosAuthorizationStatus: { PROVISIONAL: 3 },
    AndroidImportance: { DEFAULT: 5 },
    SchedulableTriggerInputTypes: { DATE: "date" },
    setNotificationChannelAsync: async () => {},
    getPermissionsAsync: async () => ({ granted, canAskAgain }),
    requestPermissionsAsync: async () => {
      requests++;
      granted = true;
      return { granted, canAskAgain };
    },
    getAllScheduledNotificationsAsync: async () => pending,
    cancelScheduledNotificationAsync: async (id: string) => {
      canceled.push(id);
    },
    scheduleNotificationAsync: async (value: Record<string, unknown>) => {
      scheduled.push(value);
    },
    getPresentedNotificationsAsync: async () =>
      pending.map((request) => ({ request })),
    dismissNotificationAsync: async (id: string) => {
      dismissed.push(id);
    },
    setNotificationHandler: (handler: typeof presentation) => { presentation = handler; },
  };
  const exports = {} as typeof import("../src/services/preferences");
  runInNewContext(compiled, {
    exports,
    require: (id: string) => {
      switch (id) {
        case "../i18n/core":
          return viI18n;
        case "expo-file-system":
          return {
            Directory: NativeDirectory,
            File: NativeFile,
            Paths: { document: "file:///documents" },
          };
        case "expo-notifications":
          return notifications;
        case "react-native":
          return { Platform: { OS: "android" } };
        case "./gardenReminderPlan":
          return gardenReminderPlan;
        case "./reminderController":
          return { createDailyReminderController };
        case "./preferenceStatus":
          return {
            setPreferenceEffectsSuspended: () => {},
          };
        default:
          throw new Error(`Unexpected dependency: ${id}`);
      }
    },
  });
  return {
    api: exports,
    files,
    source,
    directory,
    deleted,
    canceled,
    dismissed,
    scheduled,
    pending,
    requests: () => requests,
    present: (owner: string) => presentation!.handleNotification({ request: { identifier: "queued", content: { data: { patReminder: owner } } } }),
    grant: () => {
      granted = true;
    },
    denyPermanently: () => {
      canAskAgain = false;
    },
  };
}

test("native reminder cancellation touches only PAT daily-garden notifications, never unrelated notifications", async () => {
  const s = adapter();
  await s.api.cancelDailyReminders();
  assert.deepEqual(s.canceled, ["pat-daily-garden-v1"]);
  assert.deepEqual(s.dismissed, ["pat-daily-garden-v1"]);
  assert.equal(s.requests(), 0);
});

test("reminder permission prompt occurs only through the explicit request helper", async () => {
  const s = adapter();
  await s.api.syncDailyReminder({ enabled: true, time: "08:00" });
  assert.equal(s.requests(), 0);
  assert.equal(await s.api.requestReminderPermission(), true);
  assert.equal(s.requests(), 1);
  assert.equal(await s.api.requestReminderPermission(), true);
  assert.equal(s.requests(), 1);
  const blocked = adapter();
  blocked.denyPermanently();
  assert.equal(await blocked.api.requestReminderPermission(), false);
  assert.equal(blocked.requests(), 0);
});

test("native schedules dated three-hour reminders without exact-alarm access and migrates the old repeating reminder", async () => {
  const s = adapter();
  s.grant();
  await s.api.syncDailyReminder({ enabled: true, time: "18:35", garden: createGardenFixture(), now: new Date("2026-10-29T00:00:00Z") });
  assert.equal(s.scheduled.length, 14);
  assert.equal(s.scheduled[0].identifier, "pat-daily-garden-v1:2026-10-29:1115");
  assert.deepEqual(s.canceled, ["pat-daily-garden-v1"]);
  assert.deepEqual(JSON.parse(JSON.stringify(s.scheduled[0].trigger)), {
    type: "date",
    date: "2026-10-29T11:35:00.000Z",
    channelId: "pat-garden-reminders",
    delivery: "bestEffort",
  });
  assert.equal(s.requests(), 0);
});

test("foreground delivery suppresses a queued reminder after completing care and ignores unrelated notifications", async () => {
  const s = adapter();
  const garden = createGardenFixture();
  s.grant();
  s.api.installReminderPresentationHandler();
  await s.api.syncDailyReminder({ enabled: true, time: "08:00", garden });
  assert.equal((await s.present("pat-daily-garden-v1")).shouldShowBanner, true);
  assert.equal((await s.present("unrelated")).shouldShowBanner, false);
  garden.plants = garden.plants.map((plant) => ({ ...plant, lastCheckIn: localDateKey() }));
  await s.api.syncDailyReminder({ enabled: true, time: "08:00", garden });
  assert.equal((await s.present("pat-daily-garden-v1")).shouldShowBanner, false);
  await s.api.syncDailyReminder({ enabled: false, time: "08:00" });
  assert.equal((await s.present("pat-daily-garden-v1")).shouldShowList, false);
});

test("legacy music cleanup removes only PAT copies, never external or traversal paths", () => {
  const s = adapter();
  const uri = `${s.directory}/100-abc.mp3`;
  s.files.set(uri, 1024);
  assert.deepEqual([...s.api.listBackgroundMusicUris()], [uri]);
  for (const rejected of [
    s.source,
    "https://example.test/100-abc.mp3",
    `${s.directory}/../100-abc.mp3`,
    `${s.directory}/folder/100-abc.mp3`,
    `${s.directory}/original.mp3`,
    `${s.directory}-other/100-abc.mp3`,
  ]) {
    s.files.set(rejected, 50);
    s.api.deleteBackgroundMusicFile(rejected);
    assert.equal(s.files.has(rejected), true);
  }
  assert.deepEqual(s.deleted, []);
  s.api.deleteBackgroundMusicFile(uri);
  assert.deepEqual(s.deleted, [uri]);
  assert.equal(s.files.has(s.source), true);
});
