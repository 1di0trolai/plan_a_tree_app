/** Kiểm tra màu thương hiệu, độ tương phản, màu phẩm chất và tính nhất quán của các thành phần giao diện. */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

// Exercise the real token module without loading the native runtime in Node.
// The only runtime dependency is Platform, used to guard Android shadows.
function loadTheme(os = "ios", version = 26) {
  const source = readFileSync(fileURLToPath(new URL("../src/theme.ts", import.meta.url)), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  runInNewContext(compiled.outputText, {
    exports,
    require: (id: string) => {
      assert.equal(id, "react-native");
      return { Platform: { OS: os, Version: version } };
    },
  });
  return exports as typeof import("../src/theme");
}

type RGB = [number, number, number];
function rgb(hex: string): RGB {
  assert.match(hex, /^#[\da-f]{6}$/i);
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255) as RGB;
}
function luminance(color: RGB) {
  const linear = color.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
function contrast(a: RGB, b: RGB) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
function mix(a: RGB, b: RGB, amount: number): RGB {
  return a.map((channel, i) => channel * amount + b[i] * (1 - amount)) as RGB;
}
function check(fg: string, bg: string, minimum = 4.5, name = `${fg}/${bg}`) {
  const ratio = contrast(rgb(fg), rgb(bg));
  assert.ok(ratio >= minimum, `${name}: ${ratio.toFixed(2)} < ${minimum}`);
}
const theme = loadTheme();
const { COLORS: c, GRADIENTS, INTERACTION, RARITY } = theme;
const surfaces = [c.background, c.surface, c.surfaceSoft, c.surfaceAlt, c.sage, c.ochreSoft, c.leafTint, c.waterTint, c.sunTint, c.epicTint, c.auroraLeaf, c.auroraSky];

test("PAT wordmark uses legible leaf-green ink rather than near-black heading ink", () => {
  assert.notEqual(c.brandWordmark, c.primaryDark);
  check(c.brandWordmark, c.background);
  check(c.brandWordmark, c.surface);
});

test("garden body, muted and functional labels are AA on supported light surfaces", () => {
  for (const fg of [c.text, c.textMuted, c.primary, c.primaryDark, c.danger, c.warning, c.success, c.blue, c.purple]) {
    for (const bg of surfaces) check(fg, bg);
  }
});

test("rarity labels meet AA on their own tint and white card", () => {
  for (const [name, rarity] of Object.entries(RARITY)) {
    check(rarity.color, rarity.background, 4.5, name);
    check(rarity.color, c.surface, 4.5, `${name} card`);
  }
});

test("reward halos follow green blue purple gold red while text keeps separate readable ink", () => {
  assert.deepEqual(Object.values(RARITY).map(rarity => rarity.glow), [c.glowGreen, c.glowBlue, c.glowPurple, c.glowGold, c.glowRed]);
  for (const rarity of Object.values(RARITY)) assert.notEqual(rarity.color, rarity.glow);
  check(c.text, c.rewardSilverTint);
  check(c.legendaryInk, c.legendaryTint);
});

test("all action gradient stops and interpolated pressed states retain AA text", () => {
  for (let i = 0; i < GRADIENTS.actionStops.length - 1; i++) {
    for (let step = 0; step <= 20; step++) {
      const bg = mix(rgb(GRADIENTS.actionStops[i]), rgb(GRADIENTS.actionStops[i + 1]), step / 20);
      for (const fg of [c.onAction, c.onActionMuted]) {
        assert.ok(contrast(rgb(fg), bg) >= 4.5, `${fg} on action step ${step}`);
        for (const underlay of surfaces) {
          const pressedLabel = mix(rgb(fg), rgb(underlay), INTERACTION.primaryPressedOpacity);
          const pressedBg = mix(bg, rgb(underlay), INTERACTION.primaryPressedOpacity);
          assert.ok(contrast(pressedLabel, pressedBg) >= 4.5, `pressed ${fg} on action step ${step}`);
        }
      }
    }
  }
  check(c.onPrimary, c.danger);
  check(c.onPrimary, c.primaryDark);
  check(c.onPrimaryMuted, c.primaryDark);
  check(c.onDisabled, c.disabled);
});

test("bright action surfaces use dark ink, while progress remains discernible", () => {
  assert.equal(c.actionSurface, "#8EDB3F");
  assert.ok(luminance(rgb(c.actionSurface)) > 0.5, "Apple Green should stay luminous");
  assert.ok(contrast(rgb(c.white), rgb(c.actionSurface)) < 3, "do not accidentally use white on Apple Green");
  check(c.onAction, c.actionSurface);
  check(c.onActionMuted, c.actionSurface);
  check(c.primary, c.surfaceAlt, 3, "progress fill against track");
});

test("pressed secondary labels and plant cards retain AA on light backgrounds", () => {
  for (const fg of [c.text, c.textMuted, c.primary, c.primaryDark]) {
    for (const bg of surfaces) {
      const pressedFg = mix(rgb(fg), rgb(bg), INTERACTION.pressedOpacity);
      assert.ok(contrast(pressedFg, rgb(bg)) >= 4.5, `pressed ${fg}/${bg}`);
    }
  }
});

test("dark scanner and worst-case white camera underlay retain readable labels", () => {
  for (const bg of [c.scannerBackground, c.scannerSurface]) {
    for (const fg of [c.white, c.scannerFrame, c.scannerMuted]) check(fg, bg);
  }
  const channels = c.scannerOverlay.match(/[\d.]+/g)!.map(Number);
  const composed = mix(channels.slice(0, 3).map((value) => value / 255) as RGB, rgb(c.white), channels[3]);
  for (const fg of [c.white, c.scannerFrame, c.scannerMuted]) {
    assert.ok(contrast(rgb(fg), composed) >= 4.5);
  }
});

test("focus and control boundaries have non-text contrast and stable geometry", () => {
  for (const bg of surfaces) check(c.focus, bg, 3);
  for (const bg of GRADIENTS.actionStops) check(c.focus, bg, 3);
  check(c.controlBorder, c.background, 3);
  check(c.focusInverse, c.scannerBackground, 3);
  check(c.focusInverse, c.scannerSurface, 3);
  assert.equal(INTERACTION.focus.outlineWidth, 2);
  assert.equal(INTERACTION.focus.outlineOffset, 2);
  assert.ok(theme.LAYOUT.touch >= 48);
  assert.ok(theme.LAYOUT.control >= theme.LAYOUT.touch);
  assert.ok(theme.LAYOUT.formMaxWidth <= theme.LAYOUT.contentMaxWidth);
});

test("native launch colors agree with the one light theme and old Android has shadow fallback", () => {
  const config = JSON.parse(readFileSync(fileURLToPath(new URL("../app.json", import.meta.url)), "utf8")).expo;
  assert.equal(config.userInterfaceStyle, "light");
  assert.equal(config.backgroundColor, c.background);
  assert.equal(config.android.adaptiveIcon.backgroundColor, c.background);
  const splash = config.plugins.find((plugin: unknown) => Array.isArray(plugin) && plugin[0] === "expo-splash-screen");
  assert.equal(splash[1].backgroundColor, c.background);
  assert.equal(Object.keys(loadTheme("android", 27).SHADOWS.card).length, 0);
  assert.ok(loadTheme("android", 28).SHADOWS.card.boxShadow);
});

test("routes and shared UI do not reintroduce literal colors or numeric text sizes", () => {
  const root = fileURLToPath(new URL("../src", import.meta.url));
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const name = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(name);
      else if (name.endsWith(".tsx")) files.push(name);
    }
  };
  visit(path.join(root, "app"));
  visit(path.join(root, "components"));
  visit(path.join(root, "screens"));
  assert.ok(files.length >= 17, "audit the actual source, not an absent directory");
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /#[\da-f]{3,8}\b|rgba?\(/i, file);
    assert.doesNotMatch(source, /fontSize:\s*\d+/, file);
  }
});
