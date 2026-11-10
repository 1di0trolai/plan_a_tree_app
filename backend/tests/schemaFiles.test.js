/** Kiểm tra tĩnh việc tách schema SQL: giữ nguyên đối tượng, cột, ràng buộc và nghiệp vụ; không kết nối hay thực thi SQL. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const database = new URL('../../database/', import.meta.url);
const parts = [
  '00_database.sql', '01_tables.sql', 'constraints/01_keys.sql', 'constraints/02_defaults.sql',
  'constraints/03_checks.sql', 'constraints/04_foreign_keys.sql', '03_indexes.sql', '04_types.sql',
  '05_auth_procedures.sql', '06_profile_procedures.sql', '07_plant_procedures.sql',
  '08_game_procedures.sql', '09_views.sql', '10_permissions.sql',
];
const read = name => readFileSync(new URL(name, database), 'utf8');
const normalize = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\r\n]*/g, '').replace(/\s+/g, ' ').trim();
const hash = source => createHash('sha256').update(normalize(source)).digest('hex');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const batches = source => source.split(/^\s*GO\s*$/gim).map(value => value.trim()).filter(Boolean);
// Các dấu vân tay lấy từ 01_pat_schema.sql trước khi tách, không lấy lại từ tệp đầu ra.
const baseline = {
  tables: [
    'auth.Users', 'auth.RefreshTokens', 'auth.UserActionTokens', 'app.UserProfiles', 'app.UserSettings',
    'plant.Plants', 'plant.PlantCheckIns', 'plant.PlantPhotos', 'plant.PlantAnalyses',
    'plant.PlantAnalysisActions', 'plant.PlantChibis', 'game.PetCatalog', 'game.PetLevelThresholds',
    'game.UserPets', 'game.ItemCatalog', 'game.UserItems', 'game.PetFeedEvents', 'game.ArHunts',
  ],
  columns: '6f1e5dc828b6eef0f386ca7aa1c9ed984b4b0f7e366fe4aa424641d4c01dc7f4',
  constraints: '08f2a7470787b91e9f21cb7cc26e250aadcc0d4cd6ffc873ce39982894aed992',
  groups: {
    types: [1, '0421423e0466b8b1ee4510187d2a5c5d34eb7fc0d78d3eaf1c7faf61a4f7c709'],
    procedures: [18, 'd9b48b94b75debfd0e289f2b1f13e8bd6d86aa7da5b98967aa19b7d0cc04bb2e'],
    views: [9, 'ae7d897d3dcc55b0b562d6d383d6f2eeb6cfe5b162b5e7009d56661f306904ed'],
    indexes: [14, 'e7157d5db28c84eff42b8e8f1041e2384ef40a21090eecea199144a872297a25'],
    permissions: [2, '852838c875ea345a0097bcb7a5d72005f3f1daa8af2afeb617530c7c9cbf8e72'],
  },
};

// Chỉ tách danh sách cột ở dấu phẩy ngoài ngoặc/chuỗi; giữ nguyên DECIMAL(5,4), IDENTITY(1,1).
function tableColumns(source) {
  const tables = {};
  for (const match of source.matchAll(/CREATE TABLE\s+(\w+\.\w+)\s*\(/g)) {
    const text = source.slice(match.index + match[0].length), columns = [];
    let start = 0, depth = 0, quoted = false;
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      if (quoted) {
        if (char === "'" && text[index + 1] === "'") index++;
        else if (char === "'") quoted = false;
        continue;
      }
      if (char === "'") { quoted = true; continue; }
      if (char === '(') depth++;
      if (char === ')' && depth === 0) { columns.push(normalize(text.slice(start, index))); break; }
      if (char === ')') depth--;
      if (char === ',' && depth === 0) { columns.push(normalize(text.slice(start, index))); start = index + 1; }
    }
    tables[match[1]] = columns;
  }
  return tables;
}

function copiedGroups(source) {
  const groups = { types: [], procedures: [], views: [], indexes: [], permissions: [] };
  for (const batch of batches(source)) {
    let match;
    if ((match = batch.match(/CREATE OR ALTER PROCEDURE\s+(\w+\.\w+)/i))) groups.procedures.push([match[1], hash(batch)]);
    else if ((match = batch.match(/CREATE OR ALTER VIEW\s+(\w+\.\w+)/i))) groups.views.push([match[1], hash(batch)]);
    else if ((match = batch.match(/CREATE TYPE\s+(\w+\.\w+)/i))) groups.types.push([match[1], hash(batch)]);
    else if ((match = batch.match(/CREATE\s+(?:UNIQUE\s+)?NONCLUSTERED INDEX\s+(\w+)/i))) groups.indexes.push([match[1], hash(batch)]);
    else if (/GRANT\s/i.test(batch) || /CREATE ROLE/i.test(batch)) groups.permissions.push([/CREATE ROLE/i.test(batch) ? 'role' : 'grants', hash(batch)]);
  }
  return groups;
}

test('schema manifest includes every part once in dependency order, never demo or smoke data', () => {
  assert.equal(existsSync(new URL('03_seed_demo.sql', database)), false, 'Persistent demo seed must not remain in the project');
  for (const name of ['04_smoke_test.sql', '06_journey_smoke_test.sql']) {
    assert.equal(existsSync(new URL(name, database)), false, 'SQL checks must not remain beside installation scripts');
    assert.ok(existsSync(new URL(`tests/${name}`, database)), name);
  }
  const manifest = read('01_pat_schema.sql');
  const directory = manifest.match(/^\s*:setvar\s+SchemaDir\s+"([^"]+)"\s*$/im)?.[1];
  assert.ok(directory?.replaceAll('\\', '/').endsWith('/database/schema'), 'Explicit schema directory is documented in the manifest');
  const includes = [...manifest.matchAll(/^\s*:r\s+"?([^"\r\n]+)"?\s*$/gim)]
    .map(match => match[1].trim().replaceAll('\\', '/'));
  assert.deepEqual(includes, parts.map(name => `$(SchemaDir)/${name}`));
  assert.match(manifest, /^\s*:on error exit\s*$/im);
  const files = readdirSync(new URL('schema/', database), { recursive: true })
    .filter(name => name.endsWith('.sql')).map(name => name.replaceAll('\\', '/'));
  assert.deepEqual(files.sort(), [...parts].sort());
  assert.doesNotMatch(normalize(manifest), /\b(?:CREATE|ALTER|INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/i);
  for (const part of parts) assert.ok(read(`schema/${part}`).trim(), part);
});

test('bootstrap retains SQL session options, database creation and namespace definitions', () => {
  assert.deepEqual(batches(read('schema/00_database.sql')).map(hash), [
    '0b87c3c2d5fd7bd4a36046f0f8341f0dfe8226f1394f82a1d6071b73354b408c',
    'edee12cb189e7adc789983e3d2abb4e512f9d3599f42c2ebf427a84f13351de8',
    '92860c7a77542023628fd856411482f268e4764c4f7c10af8c0c8aba192c4388',
  ]);
});

test('table split preserves all 18 tables, column order, SQL types and nullability', () => {
  const source = read('schema/01_tables.sql');
  const tables = tableColumns(source);
  assert.deepEqual(Object.keys(tables), baseline.tables);
  assert.equal(digest(tables), baseline.columns);
  assert.doesNotMatch(normalize(source), /\bCONSTRAINT\b/);
});

test('constraint split preserves all 166 definitions, with referenced keys before foreign keys', () => {
  const source = parts.filter(name => name.startsWith('constraints/')).map(name => read(`schema/${name}`)).join('\n');
  const definitions = [...source.matchAll(/ALTER TABLE\s+(\w+\.\w+)(?:\s+WITH\s+CHECK)?\s+ADD\s+CONSTRAINT\s+(\w+)\s+([^;]+);/gim)]
    .map(match => {
      let definition = normalize(match[3]), column = null;
      if (/^DEFAULT\b/i.test(definition)) {
        const target = definition.match(/\s+FOR\s+\[?(\w+)\]?$/i);
        assert.ok(target, `Default column missing: ${match[2]}`);
        column = target[1]; definition = definition.slice(0, target.index);
      }
      return [match[1], match[2], column, definition];
    });
  assert.equal(definitions.length, 166);
  assert.equal(new Set(definitions.map(item => item[1])).size, 166);
  const guards = [...source.matchAll(/IF OBJECT_ID\(N'(\w+)\.(\w+)'\) IS NULL/g)].map(match => match[2]);
  assert.deepEqual(guards.sort(), definitions.map(item => item[1]).sort());
  const firstForeign = definitions.findIndex(item => /^FOREIGN KEY/.test(item[3]));
  assert.ok(firstForeign >= 0);
  assert.ok(definitions.slice(firstForeign).every(item => !/^(?:PRIMARY KEY|UNIQUE)\b/.test(item[3])));
  assert.equal(digest(definitions.sort((left, right) => left[1].localeCompare(right[1]))), baseline.constraints);
});

test('type and procedure batches retain original names, definitions and GO boundaries', () => {
  const source = ['04_types.sql', '05_auth_procedures.sql', '06_profile_procedures.sql', '07_plant_procedures.sql', '08_game_procedures.sql']
    .map(name => read(`schema/${name}`)).join('\n');
  const groups = copiedGroups(source);
  for (const name of ['types', 'procedures']) {
    assert.equal(groups[name].length, baseline.groups[name][0], name);
    assert.equal(digest(groups[name]), baseline.groups[name][1], name);
  }
});

test('views, indexes and permission batches remain unchanged by file organization', () => {
  const source = ['03_indexes.sql', '09_views.sql', '10_permissions.sql'].map(name => read(`schema/${name}`)).join('\n');
  const groups = copiedGroups(source);
  for (const name of ['views', 'indexes', 'permissions']) {
    assert.equal(groups[name].length, baseline.groups[name][0], name);
    assert.equal(digest(groups[name]), baseline.groups[name][1], name);
  }
});
