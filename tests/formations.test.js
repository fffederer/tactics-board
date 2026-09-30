import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../js/formations.js';
import { SAMPLE_FORMATIONS as formations } from '../data/sample.js';

const slotsOf = (name) => formations.find((f) => f.name === name).slots;

test('名前は前後の空白を除き、全角の数字とハイフンを半角にそろえる', () => {
  assert.equal(F.normalizeName('  ４－４－２ '), '4-4-2');
  assert.equal(F.normalizeName(undefined), '');
});

test('空の名前、長すぎる名前は登録できない', () => {
  assert.match(F.validateName('', formations, null), /入力/);
  assert.match(F.validateName('x'.repeat(21), formations, null), /20文字/);
});

test('新規作成で登録済みの名前は使えない', () => {
  assert.match(F.validateName('4-3-3', formations, null), /登録済み/);
  assert.equal(F.validateName('5-3-2', formations, null), null);
});

test('既存の編集では、同じ名前のままなら登録でき、ほかの登録済みの名前には変えられない', () => {
  assert.equal(F.validateName('4-3-3', formations, '4-3-3'), null);
  assert.match(F.validateName('4-2-3-1', formations, '4-3-3'), /登録済み/);
  assert.equal(F.validateName('4-1-2-3', formations, '4-3-3'), null);
});

test('4-4-2 は編集できるが名前は変えられない', () => {
  assert.equal(F.validateName('4-4-2', formations, '4-4-2'), null);
  assert.match(F.validateName('4-4-1-1', formations, '4-4-2'), /変更できません/);
});

test('登録: 新規は追加、編集は同じ位置で置き換え (名前の変更を含む)', () => {
  const slots = slotsOf('4-3-3').map((s) => ({ ...s, x: s.x / 2 }));
  const added = F.upsertFormation(formations, { name: '5-3-2', slots }, null);
  assert.equal(added.length, formations.length + 1);
  assert.equal(added.at(-1).name, '5-3-2');

  const renamed = F.upsertFormation(formations, { name: '4-1-2-3', slots }, '4-3-3');
  assert.equal(renamed.length, formations.length);
  assert.ok(!renamed.some((f) => f.name === '4-3-3'));
  assert.deepEqual(renamed.find((f) => f.name === '4-1-2-3').slots, slots);
  // 元の一覧は変えない
  assert.ok(formations.some((f) => f.name === '4-3-3'));
});

test('削除: 4-4-2 は削除できず、ほかは削除できる', () => {
  assert.equal(F.canDelete('4-4-2'), false);
  assert.equal(F.removeFormation(formations, '4-4-2'), formations);
  assert.ok(!F.removeFormation(formations, '3-4-2-1').some((f) => f.name === '3-4-2-1'));
});

test('新規作成の下書きは名前が空で、4-4-2 の配置のコピー', () => {
  const d = F.draftFrom(formations, null);
  assert.equal(d.name, '');
  assert.deepEqual(d.slots, slotsOf('4-4-2'));
  d.slots[0].x = 0.9;
  assert.notEqual(slotsOf('4-4-2')[0].x, 0.9);
});

test('既存の編集の下書きは、そのフォーメーションの名前と配置', () => {
  const d = F.draftFrom(formations, '3-4-2-1');
  assert.equal(d.name, '3-4-2-1');
  assert.deepEqual(d.slots, slotsOf('3-4-2-1'));
});

test('保存データの検査: 11 枠そろい、座標が 0〜1 のものだけ有効', () => {
  assert.ok(formations.every(F.isValidFormation));
  assert.equal(F.isValidFormation({ name: 'x', slots: slotsOf('4-4-2').slice(0, 10) }), false);
  assert.equal(F.isValidFormation({ name: 'x', slots: [...slotsOf('4-4-2').slice(1), { x: 1.2, y: 0 }] }), false);
  assert.equal(F.isValidFormation({ name: ' ', slots: slotsOf('4-4-2') }), false);
});
