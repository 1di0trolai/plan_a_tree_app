/** Kiểm tra tài nguyên thương hiệu PAT, biểu tượng ứng dụng, màn hình khởi động và bố cục chữ trong logo. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { PNG } = require("pngjs") as {
  PNG: { sync: { read: (buffer: Buffer) => { width: number; height: number; data: Buffer } } };
};
const asset = (name: string) => new URL(`../assets/logo/${name}`, import.meta.url);
const readImage = (name: string) => PNG.sync.read(readFileSync(asset(name)));

test("native icon and splash use descriptive PAT files, not Expo starter graphics", () => {
  const config = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8")).expo;
  assert.equal(config.icon, "./assets/logo/pat-icon.png");
  assert.equal(config.android.adaptiveIcon.foregroundImage, "./assets/logo/pat-adaptive-foreground.png");
  assert.equal(config.android.adaptiveIcon.monochromeImage, "./assets/logo/pat-adaptive-monochrome.png");
  assert.equal(config.android.adaptiveIcon.backgroundImage, undefined);
  const splash = config.plugins.find((plugin: unknown) => Array.isArray(plugin) && plugin[0] === "expo-splash-screen");
  assert.equal(splash[1].image, "./assets/logo/pat-splash.png");
  for (const name of ["pat-icon.png", "pat-splash.png"]) {
    const image = readImage(name);
    assert.equal(image.width, 1024);
    assert.equal(image.height, 1024);
  }
  const icon = readImage("pat-icon.png");
  assert.ok(icon.data.every((alpha, index) => index % 4 !== 3 || alpha === 255), "iOS icon must be opaque");
});

test("adaptive layers have transparent safe margins and a nonempty monochrome alpha mask", () => {
  for (const name of ["pat-adaptive-foreground.png", "pat-adaptive-monochrome.png"]) {
    const image = readImage(name);
    assert.equal(image.width, 1080);
    assert.equal(image.height, 1080);
    let occupied = 0;
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const index: number = (y * image.width + x) * 4;
        if (image.data[index + 3] === 0) continue;
        occupied += 1;
        assert.ok(x >= 180 && x < 900 && y >= 180 && y < 900, "keep the mark inside the central safe square");
        if (name.includes("monochrome")) {
          assert.equal(image.data[index] + image.data[index + 1] + image.data[index + 2], 0);
        }
      }
    }
    assert.ok(occupied > 10000, "the adaptive mask must contain actual logo artwork");
  }
});

test("the bundled login PAT wordmark matches its semantic green token", () => {
  const compiled = ts.transpileModule(readFileSync(new URL("../src/theme.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const theme = {} as { COLORS: { brandWordmark: string } };
  runInNewContext(compiled, { exports: theme, require: (id: string) => {
    assert.equal(id, "react-native");
    return { Platform: { OS: "ios", Version: 26 } };
  } });
  const ink = theme.COLORS.brandWordmark;
  const image = readImage("pat-logo.png");
  const rgb = [1, 3, 5].map((start) => parseInt(ink.slice(start, start + 2), 16));
  let inkPixels = 0;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (image.data[offset] === rgb[0] && image.data[offset + 1] === rgb[1]
      && image.data[offset + 2] === rgb[2] && image.data[offset + 3] === 255) inkPixels++;
  }
  assert.ok(inkPixels > 8000, "the app's actual PNG must contain the updated wordmark, not an old cached raster");
  assert.equal(image.data[3], 0, "keep the background transparent");
});

test("the outlined handwritten PAT wordmark is centered inside the existing round emblem", () => {
  const image = readImage("pat-logo.png");
  const bounds = { minX: image.width, minY: image.height, maxX: 0, maxY: 0 };
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const offset = (y * image.width + x) * 4;
    if (image.data[offset] !== 63 || image.data[offset + 1] !== 127 || image.data[offset + 2] !== 34 || image.data[offset + 3] !== 255) continue;
    bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y);
  }
  // The leafy frame is intentionally asymmetric; center on its ring, not on the square canvas.
  assert.ok(Math.abs((bounds.minX + bounds.maxX) / 2 - 1300 * image.width / 2200) < 3);
  assert.ok(Math.abs((bounds.minY + bounds.maxY) / 2 - 1330 * image.height / 2200) < 3);
  assert.ok(bounds.maxX - bounds.minX > image.width * 0.4, "lettering remains readable at the login's 176dp logo size");
});

test("brand component uses the bundled transparent symbol decoratively", () => {
  const exports: { BrandArtwork?: (props: { size: number; variant?: "symbol" | "logo"; style?: Record<string, unknown> }) => { props: Record<string, unknown> } } = {};
  const jsx = (type: unknown, props: unknown) => ({ type, props });
  const compiled = ts.transpileModule(
    readFileSync(new URL("../src/components/BrandArtwork.tsx", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
  ).outputText;
  runInNewContext(compiled, { exports, require: (id: string) => {
    if (id === "react-native") return { Image: "Image" };
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (id === "../../assets/logo/pat-symbol.png") return "pat-symbol.png";
    if (id === "../../assets/logo/pat-logo.png") return "pat-logo.png";
    throw new Error(`Unexpected dependency: ${id}`);
  } });
  const image = exports.BrandArtwork!({ size: 64 });
  assert.equal(image.props.source, "pat-symbol.png");
  assert.equal(image.props.resizeMode, "contain");
  assert.equal(image.props.accessible, false);
  const style = { marginBottom: 12 };
  const completeLogo = exports.BrandArtwork!({ size: 176, variant: "logo", style });
  assert.equal(completeLogo.props.source, "pat-logo.png");
  assert.equal(completeLogo.props.resizeMode, "contain");
  assert.equal(completeLogo.props.accessible, false);
  const styles = completeLogo.props.style as Record<string, unknown>[];
  assert.equal(styles[0].width, 176);
  assert.equal(styles[0].height, 176);
  assert.equal(styles[1], style, "caller layout override remains last");
});
