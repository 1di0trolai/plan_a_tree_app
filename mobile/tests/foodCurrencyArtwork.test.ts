/** Kiểm tra ảnh thức ăn và tiền tệ được đóng gói đúng, giữ nguyên mã vật phẩm và cách hiển thị. */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

type Node = { type: unknown; props: Record<string, unknown> };
const compile = (path: string) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });

function registry(path: string) {
  const exports: Record<string, unknown> = {};
  runInNewContext(compile(path), { exports, require: (id: string) => {
    if (id === "./star-snack") return { StarSnackArtwork: "StarSnackArtwork" };
    const url = new URL(id, new URL(path, import.meta.url));
    assert.ok(id.endsWith(".png") && existsSync(url), `Missing bundled art: ${url}`);
    return url.href;
  } });
  return exports;
}

const foods = registry("../assets/food/index.ts");
const money = registry("../assets/money/index.ts");
const compileComponent = (path: string, assetImport: string, assets: Record<string, unknown>) => {
  const exports: Record<string, (props: Record<string, unknown>) => Node> = {};
  runInNewContext(compile(path), { exports, require: (id: string) => {
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (id === "react-native") return { Image: "Image", View: "View" };
    if (id === "@/theme") return { LAYOUT: { thumbnail: 64, smallIcon: 20 } };
    if (id === assetImport) return assets;
    throw new Error(`Unexpected artwork dependency: ${id}`);
  } });
  return exports;
};

test("food PNGs replace matching inventory artwork without changing existing food IDs", () => {
  const { FoodArtwork } = compileComponent("../src/components/FoodArtwork.tsx", "../../assets/food", foods);
  for (const [id, filename] of [
    ["berry-bites", "berry-bites.png"], ["honey-cookie", "honey-cake.png"],
    ["forest-milk", "forest-milk.png"], ["rice-bowl", "rice-bowl.png"], ["ramen-bowl", "ramen-bowl.png"],
    ["star-snack", "star-snack.png"],
  ]) {
    const art = FoodArtwork({ itemId: id, size: 96 });
    const image = art.props.children as Node;
    assert.equal(art.props.accessible, false);
    assert.deepEqual(JSON.parse(JSON.stringify(art.props.style)), [{ width: 96, height: 96 }, null]);
    assert.equal(image.type, "Image");
    assert.ok(String(image.props.source).endsWith(`/food/${filename}`));
    assert.equal(image.props.resizeMode, "contain");
    assert.equal(image.props.accessible, false);
  }
  for (const id of ["legacy-unrecognized-id"]) {
    assert.equal((FoodArtwork({ itemId: id }).props.children as Node).type, "StarSnackArtwork");
  }
});

test("all new food and currency PNGs remain bundled-ready 512px transparent assets", () => {
  const paths = [
    ...Object.values(foods.FOOD_IMAGES as Record<string, string>),
    ...Object.values(money.CURRENCY_ARTWORK as Record<string, string>),
  ];
  assert.equal(paths.length, 8);
  for (const path of paths) {
    const bytes = readFileSync(new URL(path));
    assert.equal(bytes.toString("ascii", 1, 4), "PNG");
    assert.equal(bytes.readUInt32BE(16), 512);
    assert.equal(bytes.readUInt32BE(20), 512);
    assert.equal(bytes[25], 6, "Keep RGBA transparency");
  }
  assert.deepEqual(Object.keys(foods.FOOD_ARTWORK as object).sort(), ["berry-bites", "forest-milk", "honey-cookie", "ramen-bowl", "rice-bowl", "star-snack"]);
});

test("currency art stays decorative, contained, and supports both supplied currencies", () => {
  const { CurrencyArtwork } = compileComponent("../src/components/CurrencyArtwork.tsx", "../../assets/money", money);
  for (const [currency, filename] of [["gold", "gold-coin.png"], ["diamond", "diamond.png"]]) {
    const art = CurrencyArtwork({ currency });
    assert.equal(art.type, "Image");
    assert.ok(String(art.props.source).endsWith(`/money/${filename}`));
    assert.equal(art.props.accessible, false);
    assert.equal(art.props.resizeMode, "contain");
    assert.deepEqual(JSON.parse(JSON.stringify(art.props.style)), [{ width: 20, height: 20 }, null]);
  }
});
