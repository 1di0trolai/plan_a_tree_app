/** Kiểm tra ảnh của từng loài thú nuôi và lựa chọn ngoại hình theo cấp sao, độc lập với độ hiếm. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { PET_SPECIES } from "../src/data/seed";

const require = createRequire(import.meta.url);
const { PNG } = require("pngjs") as {
  PNG: { sync: { read: (buffer: Buffer) => { width: number; height: number; data: Buffer } } };
};

test("the five illustrated pet species resolve to their bundled PNG assets", () => {
  const catalogUrl = new URL("../assets/pets/index.ts", import.meta.url);
  const exports = {} as {
    PET_IMAGES: Record<string, string>;
    PET_EVOLUTION_IMAGES: Record<string, Record<2 | 3, string>>;
  };
  runInNewContext(ts.transpileModule(readFileSync(catalogUrl, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, {
    exports,
    require: (path: string) => {
      assert.match(path, /^\.\/([a-z0-9-]+)\/\1(?:-[23]-star)?\.png$/);
      const imageUrl = new URL(path, catalogUrl);
      const png = readFileSync(imageUrl);
      assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      assert.ok(png.readUInt32BE(16) >= 128);
      assert.ok(png.readUInt32BE(20) >= 128);
      assert.equal(png[25], 6, "pet sprites preserve RGBA transparency");
      const image = PNG.sync.read(png);
      const lastPixel = image.width * image.height - 1;
      for (const corner of [0, image.width - 1, lastPixel - image.width + 1, lastPixel]) {
        // Generators may leave an imperceptible 1/255 alpha fringe at a corner.
        assert.ok(image.data[corner * 4 + 3] <= 2, "sprite corners must be transparent, not a baked background");
      }
      return imageUrl.href;
    },
  });
  const species = PET_SPECIES.map(pet => pet.id);
  // The legacy dew-snail has no supplied illustration and retains its fallback.
  assert.deepEqual(Object.keys(exports.PET_IMAGES).sort(), species.filter(id => id !== "dew-snail").sort());
  assert.deepEqual(Object.keys(exports.PET_EVOLUTION_IMAGES).sort(), Object.keys(exports.PET_IMAGES).sort());
  for (const id of Object.keys(exports.PET_IMAGES)) {
    const forms = exports.PET_EVOLUTION_IMAGES[id];
    assert.ok(exports.PET_IMAGES[id].endsWith(`/${id}/${id}.png`));
    assert.match(forms[2], new RegExp(`${id}-2-star\\.png$`));
    assert.match(forms[3], new RegExp(`${id}-3-star\\.png$`));
    assert.equal(new Set([exports.PET_IMAGES[id], forms[2], forms[3]]).size, 3);
  }
});

test("pet art selects physical forms by stars, independently from rarity", () => {
  const jsx = { jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: (type: unknown, props: unknown) => ({ type, props }) };
  const exports = {} as { PetArtwork: (props: { petId: string; stars?: 1 | 2 | 3 }) => { props: { children: { props: { source: string } } } } };
  runInNewContext(ts.transpileModule(readFileSync(new URL("../src/components/PetArtwork.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports,
    require: (path: string) => {
      if (path === "react/jsx-runtime") return jsx;
      if (path === "react-native") return { Image: "Image", View: "View", Text: "Text" };
      if (path === "@/theme") return { LAYOUT: { artwork: 120 } };
      if (path === "../../assets/pets") return {
        PET_IMAGES: { caterpillar: "base" },
        PET_EVOLUTION_IMAGES: { caterpillar: { 2: "evolved-2", 3: "evolved-3" } },
      };
      throw new Error(path);
    },
  });
  for (const [stars, expected] of [[undefined, "base"], [1, "base"], [2, "evolved-2"], [3, "evolved-3"]] as const) {
    assert.equal(exports.PetArtwork({ petId: "caterpillar", stars }).props.children.props.source, expected);
  }
});
