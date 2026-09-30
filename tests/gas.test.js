import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGas } from './gasHarness.js';
import { SAMPLE_PLAYERS, SAMPLE_FORMATIONS } from '../data/sample.js';

function setUp() {
  const gas = createGas();
  gas.call('setup');
  return gas;
}

const slots433 = SAMPLE_FORMATIONS.find((f) => f.name === '4-3-3').slots;

test('setup でシート・見出し・初期データが作られ、空のシートは消える', () => {
  const gas = setUp();
  assert.deepEqual(gas.ss.getSheets().map((s) => s.name), ['選手DB', 'フォーメーション']);
  const players = gas.ss.getSheetByName('選手DB');
  assert.deepEqual(players.cells[0], ['リーグ', 'チーム', 'ポジション', '背番号', '選手名', '略称']);
  assert.equal(players.cells.length, SAMPLE_PLAYERS.length + 1);
  assert.equal(players.frozenRows, 1);
  assert.ok(players.getMaxRows() >= 5000);
  const formations = gas.ss.getSheetByName('フォーメーション');
  assert.equal(formations.cells[0].length, 23);
  assert.equal(formations.cells[0][1], '枠1_横');
});

test('setup の入力規則: リーグ・チームは警告のみ、ポジションは4種類以外を拒否', () => {
  const players = setUp().ss.getSheetByName('選手DB');
  const rule = (col) => players.validations.find((v) => v.col === col).rule.calls;
  assert.deepEqual(rule(1).find((c) => c[0] === 'setAllowInvalid'), ['setAllowInvalid', true]);
  assert.deepEqual(rule(2).find((c) => c[0] === 'setAllowInvalid'), ['setAllowInvalid', true]);
  assert.deepEqual([...rule(3).find((c) => c[0] === 'requireValueInList')[1]], ['GK', 'DF', 'MF', 'FW']);
  assert.deepEqual(rule(3).find((c) => c[0] === 'setAllowInvalid'), ['setAllowInvalid', false]);
});

test('setup を二度実行しても、既存のデータは上書きしない', () => {
  const gas = setUp();
  gas.ss.getSheetByName('選手DB').appendRow(['セリエA', 'インテル', 'FW', 10, 'ラウタロ・マルティネス', 'ラウタロ']);
  gas.call('setup');
  assert.equal(gas.ss.getSheetByName('選手DB').cells.length, SAMPLE_PLAYERS.length + 2);
});

test('GET は選手とフォーメーションを返す。背番号の空欄は null', () => {
  const res = setUp().get();
  assert.equal(res.ok, true);
  assert.deepEqual(res.players, SAMPLE_PLAYERS);
  assert.deepEqual(res.formations, SAMPLE_FORMATIONS);
});

test('GET は必須項目の欠けた行や不正なポジションの行を読み飛ばし、略称が空なら選手名を使う', () => {
  const gas = setUp();
  const sheet = gas.ss.getSheetByName('選手DB');
  sheet.appendRow(['', 'X', 'FW', 9, '名前なしリーグ', '']);
  sheet.appendRow(['L', 'X', 'ST', 9, '不正ポジション', '']);
  sheet.appendRow([' L ', ' X ', 'fw', '', ' テスト太郎 ', '']);
  const added = gas.get().players.slice(SAMPLE_PLAYERS.length);
  assert.deepEqual(added, [{ league: 'L', team: 'X', position: 'FW', number: null, name: 'テスト太郎', short: 'テスト太郎' }]);
});

test('シートがないときは setup を促すエラーを返す', () => {
  const res = createGas().get();
  assert.equal(res.ok, false);
  assert.match(res.error, /setup/);
});

test('POST: 新規登録は追加され、座標は小数4桁に丸めて保存される', () => {
  const gas = setUp();
  const slots = slots433.map((s) => ({ x: s.x + 0.000012, y: s.y }));
  const res = gas.post({ action: 'saveFormation', formation: { name: '５－３－２', slots }, originalName: null });
  assert.equal(res.ok, true);
  const saved = res.formations.find((f) => f.name === '5-3-2');
  assert.equal(saved.slots[0].x, 0.05);
});

test('POST: 登録済みの名前での新規登録、4-4-2 の改名、座標の不正は拒否される', () => {
  const gas = setUp();
  const dup = gas.post({ action: 'saveFormation', formation: { name: '4-3-3', slots: slots433 } });
  assert.match(dup.error, /登録済み/);
  const rename = gas.post({ action: 'saveFormation', formation: { name: '4-4-1-1', slots: slots433 }, originalName: '4-4-2' });
  assert.match(rename.error, /変更できません/);
  const bad = gas.post({ action: 'saveFormation', formation: { name: 'X', slots: slots433.slice(1) } });
  assert.match(bad.error, /座標/);
  assert.equal(gas.get().formations.length, SAMPLE_FORMATIONS.length);
});

test('POST: 編集は同じ行を上書きし、名前の変更もできる', () => {
  const gas = setUp();
  const slots = slots433.map((s) => ({ x: s.x / 2, y: s.y }));
  const res = gas.post({ action: 'saveFormation', formation: { name: '4-1-2-3', slots }, originalName: '4-3-3' });
  assert.equal(res.ok, true);
  assert.deepEqual(res.formations.map((f) => f.name), ['4-4-2', '4-1-2-3', '4-2-3-1', '3-4-2-1']);
});

test('POST: 削除。4-4-2 は削除できない', () => {
  const gas = setUp();
  assert.match(gas.post({ action: 'deleteFormation', name: '4-4-2' }).error, /削除できません/);
  const res = gas.post({ action: 'deleteFormation', name: '3-4-2-1' });
  assert.deepEqual(res.formations.map((f) => f.name), ['4-4-2', '4-3-3', '4-2-3-1']);
});

test('POST: 不明な操作や壊れた本文はエラーを返す', () => {
  const gas = setUp();
  assert.equal(gas.post({ action: 'dropTable' }).ok, false);
  const broken = JSON.parse(gas.call('doPost', { postData: { contents: '{' } }).content);
  assert.equal(broken.ok, false);
});

test('偽のシートは本物と同じく「4-4-2」を日付に変える (再現の確認)', () => {
  const gas = setUp();
  const sheet = gas.ss.getSheetByName('選手DB');
  sheet.appendRow(['4-4-2']);
  assert.equal(Object.prototype.toString.call(sheet.cells.at(-1)[0]), '[object Date]');
});

test('setup と登録では、フォーメーション名が日付にならずテキストのまま保存される', () => {
  const gas = setUp();
  gas.post({ action: 'saveFormation', formation: { name: '3-5-2', slots: slots433 } });
  gas.post({ action: 'saveFormation', formation: { name: '4-4-2', slots: slots433 }, originalName: '4-4-2' });
  const names = gas.ss.getSheetByName('フォーメーション').cells.slice(1).map((r) => r[0]);
  assert.deepEqual(names, ['4-4-2', '4-3-3', '4-2-3-1', '3-4-2-1', '3-5-2']);
});

test('日付になってしまった名前も、読み込み時は元の名前として扱い、編集・削除できる', () => {
  const gas = setUp();
  const cells = gas.ss.getSheetByName('フォーメーション').cells;
  cells[1][0] = new Date(Date.UTC(2004, 3, 2)); // 4-4-2
  cells[2][0] = new Date(Date.UTC(2004, 2, 3)); // 4-3-3
  assert.deepEqual(gas.get().formations.map((f) => f.name), ['4-4-2', '4-3-3', '4-2-3-1', '3-4-2-1']);
  assert.equal(gas.post({ action: 'saveFormation', formation: { name: '4-3-3', slots: slots433 }, originalName: '4-3-3' }).ok, true);
  assert.equal(cells.length, 5);
  assert.equal(gas.post({ action: 'deleteFormation', name: '4-3-3' }).ok, true);
  assert.deepEqual(gas.get().formations.map((f) => f.name), ['4-4-2', '4-2-3-1', '3-4-2-1']);
});

test('setup を再実行すると、日付になってしまった名前がテキストに戻る', () => {
  const gas = setUp();
  const sheet = gas.ss.getSheetByName('フォーメーション');
  sheet.formats.clear();
  sheet.cells[1][0] = new Date(Date.UTC(2004, 3, 2));
  sheet.cells[2][0] = new Date(Date.UTC(2004, 2, 3));
  gas.call('setup');
  assert.deepEqual(sheet.cells.slice(1, 3).map((r) => r[0]), ['4-4-2', '4-3-3']);
  assert.equal(sheet.formats.get('50,1'), '@');
});
