/** Kiểm thử ghi nhớ email/mật khẩu theo lựa chọn, không ghi đè nội dung đang nhập khi dữ liệu tải muộn. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as passwordPolicy from '../src/utils/passwordPolicy';
import { i18nFixture } from './fixtures/i18nFixture';

type Node = { type: unknown; props: Record<string, unknown> };
const compile = (file: string) => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const theme = {};
runInNewContext(compile('../src/theme.ts'), { exports: theme, require: () => ({ Platform: { OS: 'android', Version: 28 } }) });
const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };

function form(ready = true) {
  let cursor = 0; let tree: Node;
  const hooks: { value: unknown; deps?: readonly unknown[] }[] = [];
  const effects: (() => void)[] = [];
  const rememberChanges: boolean[] = [];
  const context = { ready, state: { auth: { loggedIn: false } }, rememberedEmail: 'thai@example.com',
    rememberedPassword: 'RememberThis1', rememberLogin: true,
    async updateRememberLogin(enabled: boolean) { rememberChanges.push(enabled); return { ok: true }; },
  };
  const sameDeps = (previous: readonly unknown[] | undefined, next: readonly unknown[]) =>
    previous !== undefined && previous.length === next.length && previous.every((value, index) => Object.is(value, next[index]));
  const jsx = (type: unknown, props: Record<string, unknown>): Node =>
    typeof type === 'function' ? (type as (props: Record<string, unknown>) => Node)(props) : { type, props };
  const exported = {} as { default: () => Node };
  runInNewContext(compile('../src/app/index.tsx'), { exports: exported, require: (id: string) => {
    switch (id) {
      case 'react': return {
        useState(initial: unknown) { const index = cursor++; hooks[index] ??= { value: initial }; return [hooks[index].value,
          (next: unknown) => { hooks[index].value = typeof next === 'function' ? (next as (previous: unknown) => unknown)(hooks[index].value) : next; }]; },
        useRef(initial: unknown) { const index = cursor++; hooks[index] ??= { value: { current: initial } }; return hooks[index].value; },
        useEffect(effect: () => void, deps: readonly unknown[]) { const index = cursor++;
          if (!hooks[index] || !sameDeps(hooks[index].deps, deps)) { hooks[index] = { value: null, deps }; effects.push(effect); } },
      };
      case 'react/jsx-runtime': return { jsx, jsxs: jsx };
      case 'react-native': return { ActivityIndicator: 'ActivityIndicator', KeyboardAvoidingView: 'KeyboardAvoidingView',
        Platform: { OS: 'android' }, Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput', View: 'View',
        StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 } };
      case 'react-native-safe-area-context': return { SafeAreaView: 'SafeAreaView' };
      case '@expo/vector-icons/Ionicons': return { __esModule: true, default: 'Icon' };
      case 'expo-router': return { router: { replace() {} } };
      case '@/components/BrandArtwork': return { BrandArtwork: 'BrandArtwork' };
      case '@/components/LanguageSelector': return { LanguageSelector: 'LanguageSelector' };
      case '@/i18n': return i18nFixture;
      case '@/components/PasswordRules': return { PasswordRules: 'PasswordRules' };
      case '@/components/SocialProviderButton': return { SocialProviderButton: 'SocialProviderButton' };
      case '@/hooks/useControlFocus': return { useControlFocus: () => ({ props: () => ({}), style: () => undefined }) };
      case '@/store/AppStore': return { useApp: () => context };
      case '@/theme': return theme;
      case '@/utils/passwordPolicy': return passwordPolicy;
      default: throw new Error(`Unexpected dependency ${id}`);
    }
  } });
  const nodes = (value: unknown): Node[] => Array.isArray(value) ? value.flatMap(nodes)
    : value && typeof value === 'object' && 'props' in value ? [value as Node, ...nodes((value as Node).props.children)] : [];
  const render = () => { cursor = 0; tree = exported.default(); while (effects.length) effects.shift()!(); return nodes(tree); };
  const control = (label: string) => nodes(tree).find(node => node.props.accessibilityLabel === label)!;
  const type = (label: string, value: string) => { (control(label).props.onChangeText as (value: string) => void)(value); render(); };
  render(); render();
  return { render, context, control, type, rememberChanges };
}

test('login form fills both opted-in fields and keeps native password-manager semantics', async () => {
  const ui = form();
  assert.equal(ui.control('Email đăng nhập').props.value, 'thai@example.com');
  assert.equal(ui.control('Mật khẩu').props.value, 'RememberThis1');
  assert.equal(ui.control('Mật khẩu').props.secureTextEntry, true);
  assert.equal(ui.control('Mật khẩu').props.autoComplete, 'current-password');
  assert.equal(ui.control('Mật khẩu').props.textContentType, 'password');
  (ui.control('Ghi nhớ đăng nhập').props.onPress as () => void)(); await flush(); ui.render();
  assert.deepEqual(ui.rememberChanges, [false]);
  assert.equal(ui.control('Mật khẩu').props.value, '');
});

test('editing email clears only the autofilled field, not the saved opt-in record', () => {
  const ui = form();
  ui.type('Email đăng nhập', 'another@example.com');
  assert.equal(ui.control('Mật khẩu').props.value, '');
  assert.deepEqual(ui.rememberChanges, []);
  assert.equal(ui.context.rememberedPassword, 'RememberThis1');
  ui.type('Mật khẩu', 'TypedForNewAccount2');
  ui.type('Email đăng nhập', 'another2@example.com');
  assert.equal(ui.control('Mật khẩu').props.value, 'TypedForNewAccount2', 'never erase a manually entered replacement password');
});

test('late hydration cannot overwrite a login field already being edited', () => {
  const ui = form(false);
  ui.context.ready = true; ui.render(); ui.render();
  assert.equal(ui.control('Mật khẩu').props.value, 'RememberThis1');
  ui.type('Mật khẩu', 'ManualPassword3');
  ui.context.rememberedPassword = 'DifferentSavedPassword4'; ui.render();
  assert.equal(ui.control('Mật khẩu').props.value, 'ManualPassword3');
});
