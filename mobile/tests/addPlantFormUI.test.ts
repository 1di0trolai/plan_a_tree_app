/** Kiểm thử biểu mẫu thêm cây luôn hiển thị, chỉnh sửa thủ công và chọn ảnh trên các kích thước màn hình. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { t } from '../src/i18n/core';

type Node = { type: unknown; props: Record<string, unknown> };
const compile = (file: string) => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const theme = {};
runInNewContext(compile('../src/theme.ts'), { exports: theme, require: () => ({ Platform: { OS: 'ios', Version: 26 } }) });
function form({ width = 375, fontScale = 1 }: { width?: number; fontScale?: number } = {}) {
  let cursor = 0, tree: Node;
  const hooks: unknown[] = [], created: Record<string, unknown>[] = [], routes: unknown[] = [];
  const exports = {} as { default: () => Node }, jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const react = { useState: (initial: unknown) => { const index = cursor++; if (!(index in hooks)) hooks[index] = initial; return [hooks[index], (value: unknown) => { hooks[index] = value; }]; },
    useRef: (initial: unknown) => { const index = cursor++; hooks[index] ??= { current: initial }; return hooks[index]; }, useCallback: (fn: unknown) => fn,
  };
  runInNewContext(compile('../src/app/add-plant.tsx'), { exports, AbortController, require: (id: string) => {
    switch (id) {
      case '@/i18n': return { t, useI18n: () => ({ locale: 'vi', t }) };
      case 'react': return react;
      case 'react/jsx-runtime': return { jsx, jsxs: jsx };
      case 'react-native': return { Image: 'Image', KeyboardAvoidingView: 'KeyboardAvoidingView', ScrollView: 'ScrollView', Text: 'Text', View: 'View', Platform: { OS: 'ios' }, useWindowDimensions: () => ({ width, height: 812, fontScale, scale: 1 }), StyleSheet: { create: (value: unknown) => value } };
      case 'react-native-safe-area-context': return { SafeAreaView: 'SafeAreaView' };
      case '@expo/vector-icons/Ionicons': return { __esModule: true, default: 'Icon' };
      case 'expo-router': return { router: { replace: (route: unknown) => routes.push(route) }, useFocusEffect: () => {} };
      case '@/components/AiProgress': return { AiProgress: 'AiProgress' };
      case '@/components/journeyUI': return { JourneyButton: 'JourneyButton', JourneyCard: 'JourneyCard', JourneyChoices: 'JourneyChoices', JourneyDisclosure: 'JourneyDisclosure', JourneyField: 'JourneyField', JourneyHeader: 'JourneyHeader', cropEmoji: { other: 'leaf' }, phaseLabels: {}, ui: {}, selectJourneyPhoto: async () => 'file:///picked.jpg' };
      case '@/services/plantAi': return { cropGuide: () => ['Manual guide'], isAiConfigured: () => false };
      case '@/store/AppStore': return { useApp: () => ({ createJourney: (input: Record<string, unknown>) => { created.push(input); return { id: 'new-tree' }; }, persistNow: async () => {} }) };
      case '@/theme': return theme;
      case '@/utils/checkInPhotos': return { persistCheckInPhoto: async () => 'file:///private.jpg', deleteCheckInPhoto() {} };
      case '@/utils/plantDraft': return { starterCrop: () => 'other' };
      default: throw new Error(`Unexpected dependency ${id}`);
    }
  } });
  const nodes = (value: unknown): Node[] => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' && 'props' in value ? [value as Node, ...nodes((value as Node).props.children)] : [];
  const render = () => { cursor = 0; tree = exports.default(); return nodes(tree); };
  const all = () => nodes(tree), field = (label: string) => all().find(node => node.type === 'JourneyField' && node.props.label === label)!;
  render();
  return { render, all, field, created, routes, save: () => (all().find(node => node.props.testID === 'create-journey')!.props.onPress as () => Promise<void>)(),
    photo: () => (all().find(node => node.type === 'JourneyButton' && node.props.title === 'Thư viện')!.props.onPress as () => Promise<void>)(),
    fill: (name: string, species: string) => { (field('Tên riêng').props.onChangeText as (value: string) => void)(name); (field('Loài cây').props.onChangeText as (value: string) => void)(species); render(); },
  };
}
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
test('new plant profile is present immediately without manual-mode toggle or an image', async () => {
  const ui = form(); assert.ok(ui.field('Tên riêng')); assert.ok(ui.field('Loài cây'));
  assert.equal(ui.all().some(node => node.props.children === 'Hoặc nhập thủ công'), false);
  ui.fill('Cây mới', 'Khế'); ui.save(); await flush();
  assert.equal(ui.created.length, 1); assert.equal(ui.created[0].mode, 'demo'); assert.equal(ui.created[0].photo, undefined);
  assert.deepEqual(ui.routes, ['/(tabs)/garden']);
});
test('choosing a photo keeps the form editable and permits manual save without AI recognition', async () => {
  const ui = form(); ui.photo(); await flush(); ui.render(); assert.ok(ui.field('Tên riêng'));
  ui.fill('Khế nhỏ', 'Khế'); ui.save(); await flush();
  assert.equal(ui.created.length, 1); assert.equal(ui.created[0].mode, 'demo');
  assert.equal((ui.created[0].photo as { imageUri: string }).imageUri, 'file:///private.jpg');
});
test('manual default still validates name and species before storing any plant', async () => {
  const ui = form(); ui.save(); await flush(); ui.render(); assert.equal(ui.created.length, 0);
  assert.ok(ui.all().some(node => node.props.accessibilityRole === 'alert'));
});

test('photo heading and controls stack on narrow screens or large text without hiding the initial form', () => {
  for (const [width, fontScale, direction] of [[375, 1, 'row'], [320, 1, 'column'], [375, 1.8, 'column']] as const) {
    const ui = form({ width, fontScale });
    const photoRows = ui.all().filter(node => node.type === 'View' && Array.isArray(node.props.style)
      && (node.props.style[0] as { flexDirection?: string })?.flexDirection === 'row');
    assert.equal(photoRows.length, 2, 'Photo heading and button row are both responsive');
    for (const row of photoRows) {
      const style = Object.assign({}, ...(row.props.style as unknown[]).filter(Boolean));
      assert.equal(style.flexDirection, direction, `${width}px at ${fontScale}×`);
    }
    assert.ok(ui.field('Tên riêng')); assert.ok(ui.field('Loài cây'));
    assert.ok(ui.all().some(node => node.type === 'JourneyButton' && node.props.title === 'Chụp ảnh'));
    assert.ok(ui.all().some(node => node.type === 'JourneyButton' && node.props.title === 'Thư viện'));
  }
});
