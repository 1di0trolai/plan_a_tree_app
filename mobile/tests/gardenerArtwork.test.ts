/** Kiểm tra tài nguyên trang phục người làm vườn cùng hiệu ứng chuyển động và chế độ giảm chuyển động. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

import type { GardenerOutfit } from "../src/types/app";

type Node = { type: unknown; props: Record<string, unknown> };
type Outfit = { id: GardenerOutfit; name: string; color: string };
const compile = (path: string) => ts.transpileModule(
  readFileSync(resolve(__dirname, path), "utf8"),
  { compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  } },
).outputText;
const assetSource = compile("../assets/skins/gardener.tsx");
const avatarSource = compile("../src/screens/profile/GardenerAvatar.tsx");
const themeSource = compile("../src/theme.ts");

function gardener(options: { reduced?: boolean; background?: boolean } = {}) {
  const hooks: { value: unknown }[] = [];
  const effects: { dependencies: unknown[]; cleanup?: () => void }[] = [];
  const pending: (() => void)[] = [];
  const listeners = new Map<string, (value: unknown) => void>();
  const timing: { duration: number; useNativeDriver: boolean }[] = [];
  let cursor = 0;
  let effectCursor = 0;
  let starts = 0;
  let stops = 0;
  let removed = 0;
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const native = {
    Platform: { OS: "ios", select: (values: { ios: unknown }) => values.ios },
    StyleSheet: { create: (value: unknown) => value, absoluteFill: {} },
    View: "View",
    AccessibilityInfo: {
      isReduceMotionEnabled: async () => options.reduced ?? false,
      addEventListener: (name: string, callback: (value: unknown) => void) => {
        listeners.set(name, callback);
        return { remove() { removed++; } };
      },
    },
    AppState: {
      currentState: options.background ? "background" : "active",
      addEventListener: (name: string, callback: (value: unknown) => void) => {
        listeners.set(name, callback);
        return { remove() { removed++; } };
      },
    },
    Easing: { inOut: (value: unknown) => value, sin: "sin" },
    Animated: {
      View: "AnimatedView",
      Value: class {
        constructor(public value: number) {}
        setValue(value: number) { this.value = value; }
        interpolate(options: unknown) { return options; }
      },
      timing(_value: unknown, options: { duration: number; useNativeDriver: boolean }) {
        timing.push(options);
        return {};
      },
      delay: () => ({}),
      sequence: () => ({}),
      loop: () => ({}),
      parallel: () => ({ start() { starts++; }, stop() { stops++; } }),
    },
  };
  const theme = {} as { COLORS: Record<string, string>; MOTION: Record<string, number> };
  runInNewContext(themeSource, { exports: theme, require: () => native });
  const assets = {} as { OUTFITS: Outfit[] };
  const runtime = { jsx, jsxs: jsx, Fragment: "Fragment" };
  runInNewContext(assetSource, {
    exports: assets,
    require: (id: string) => {
      if (id === "react/jsx-runtime") return runtime;
      if (id === "@/theme") return theme;
      if (id === "react-native-svg") return {
        __esModule: true, default: "Svg", Circle: "Circle", Ellipse: "Ellipse", Path: "Path", Rect: "Rect",
      };
      throw new Error(`Unexpected asset dependency: ${id}`);
    },
  });
  const component = {} as { OUTFITS: Outfit[]; GardenerAvatar: (props: { outfit: GardenerOutfit; animated?: boolean; size?: number }) => Node };
  runInNewContext(avatarSource, {
    exports: component,
    require: (id: string) => {
      if (id === "react/jsx-runtime") return runtime;
      if (id === "react-native") return native;
      if (id === "@/theme") return theme;
      if (id === "../../../assets/skins/gardener") return assets;
      if (id === "react") return {
        useState(initial: unknown) {
          const index = cursor++;
          hooks[index] ??= { value: typeof initial === "function" ? initial() : initial };
          return [hooks[index].value, (value: unknown) => { hooks[index].value = value; }];
        },
        useEffect(callback: () => void | (() => void), dependencies: unknown[]) {
          const index = effectCursor++;
          if (effects[index]?.dependencies.every((value, offset) => Object.is(value, dependencies[offset]))) return;
          pending.push(() => {
            effects[index]?.cleanup?.();
            effects[index] = { dependencies, cleanup: callback() ?? undefined };
          });
        },
      };
      throw new Error(`Unexpected avatar dependency: ${id}`);
    },
  });
  const nodes = (value: unknown): Node[] => {
    if (Array.isArray(value)) return value.flatMap(nodes);
    if (!value || typeof value !== "object" || !("type" in value)) return [];
    const node = value as Node;
    if (typeof node.type === "function") return nodes(node.type(node.props));
    return [node, ...nodes(node.props.children)];
  };
  return {
    assets, component, theme, timing,
    starts: () => starts, stops: () => stops, removed: () => removed,
    emit: (name: string, value: unknown) => listeners.get(name)?.(value),
    unmount: () => effects.forEach(effect => effect.cleanup?.()),
    render(outfit: GardenerOutfit = "leaf", animated = true, size = 240) {
      cursor = effectCursor = 0;
      const result = nodes(component.GardenerAvatar({ outfit, animated, size }));
      pending.splice(0).forEach(effect => effect());
      return result;
    },
  };
}

test("all gardener outfits use shared vector assets without changing IDs, palette or public exports", () => {
  const app = gardener();
  assert.equal(app.assets.OUTFITS, app.component.OUTFITS);
  assert.deepEqual(Array.from(app.assets.OUTFITS, outfit => outfit.id), ["leaf", "sun", "rain"]);
  for (const outfit of app.assets.OUTFITS) {
    const tree = app.render(outfit.id, false, 120);
    assert.equal(tree.filter(node => node.type === "Svg").length, 4);
    assert.match(String(tree[0].props.accessibilityLabel), new RegExp(outfit.name));
    assert.equal((tree[0].props.style as { width: number }).width, 120);
    assert.equal((tree[0].props.style as { height: number }).height, 140);
    const shirt = tree.find(node => node.type === "Path" && String(node.props.d).startsWith("M88 152"));
    assert.equal(shirt?.props.fill, outfit.color);
  }
});

test("vector extraction preserves blink, body bob and waving animation with native driver", async () => {
  const app = gardener();
  app.render();
  assert.equal(app.starts(), 0, "no motion before the accessibility preference resolves");
  await Promise.resolve();
  app.render();
  assert.equal(app.starts(), 1);
  assert.equal(app.timing.length, 8);
  assert.ok(app.timing.every(value => value.useNativeDriver));
  app.emit("change", "background");
  app.render();
  assert.equal(app.stops(), 1);
  app.emit("change", "active");
  app.render();
  assert.equal(app.starts(), 2);
  app.emit("reduceMotionChanged", true);
  app.render();
  assert.equal(app.stops(), 2);
  app.unmount();
  assert.equal(app.removed(), 2);
});

test("reduced motion and static outfit previews remain motion-free", async () => {
  const reduced = gardener({ reduced: true });
  reduced.render();
  await Promise.resolve();
  reduced.render();
  assert.equal(reduced.starts(), 0);
  const preview = gardener();
  preview.render("sun", false);
  await Promise.resolve();
  preview.render("sun", false);
  assert.equal(preview.starts(), 0);
});
