/** Chạy provider và các hook kho trạng thái thật trong cùng VM, chỉ thay các cổng nền tảng do bài kiểm thử cung cấp. */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';

const storeDirectory = resolve(__dirname, '../../src/store');
const realModules = new Set([
  'AppStore.tsx',
  'useAppRuntime.ts',
  'useAppPersistence.ts',
  'useAppHydration.ts',
  'useAccountActions.ts',
  'usePlantActions.ts',
].map(file => resolve(storeDirectory, file)));
const compiledModules = new Map<string, string>();

type Module = { exports: unknown };
type RequirePort = (id: string) => unknown;
type ModuleBody = (exports: unknown, require: RequirePort, module: Module, filename: string, directory: string) => void;

/** Không dùng require thật làm fallback: mọi phụ thuộc ngoài nhóm hook phải qua cùng bộ cổng giả lập. */
export function loadStoreModule<T>(options: {
  globals: Record<string, unknown>;
  require: RequirePort;
}): T {
  const context = createContext({ ...options.globals });
  const cache = new Map<string, Module>();

  function load(filename: string): unknown {
    if (!realModules.has(filename)) throw new Error(`Store module is not allowlisted: ${filename}`);
    const cached = cache.get(filename);
    if (cached) return cached.exports;

    let compiled = compiledModules.get(filename);
    if (!compiled) {
      compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
        fileName: filename,
      }).outputText;
      compiledModules.set(filename, compiled);
    }

    const module: Module = { exports: {} };
    cache.set(filename, module);
    const requireModule: RequirePort = id => {
      if (id.startsWith('.')) {
        const base = resolve(dirname(filename), id);
        const dependency = [base, `${base}.ts`, `${base}.tsx`].find(candidate => realModules.has(candidate));
        if (dependency) return load(dependency);
      }
      return options.require(id);
    };

    try {
      const execute = runInContext(`(function(exports, require, module, __filename, __dirname) {\n${compiled}\n})`, context,
        { filename }) as ModuleBody;
      execute(module.exports, requireModule, module, filename, dirname(filename));
      return module.exports;
    } catch (error) {
      cache.delete(filename);
      throw error;
    }
  }

  return load(resolve(storeDirectory, 'AppStore.tsx')) as T;
}
