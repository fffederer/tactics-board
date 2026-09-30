// フォーメーションの登録・削除のルール。DOM に依存しない純粋な関数だけを置く。
import { DEFAULT_FORMATION, SLOT_COUNT } from './logic.js';

const MAX_NAME_LENGTH = 20;

// 全角の数字やハイフン (４－４－２) も半角にそろえる。
export function normalizeName(raw) {
  return String(raw ?? '').normalize('NFKC').trim();
}

const isRatio = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

export function isValidFormation(f) {
  return (
    !!f &&
    typeof f.name === 'string' &&
    f.name.trim() !== '' &&
    Array.isArray(f.slots) &&
    f.slots.length === SLOT_COUNT &&
    f.slots.every((s) => s && isRatio(s.x) && isRatio(s.y))
  );
}

// 登録できない名前ならその理由を、登録できるなら null を返す。
// originalName は編集中の既存フォーメーションの名前 (新規作成なら null)。
export function validateName(name, formations, originalName) {
  if (!name) return 'フォーメーション名を入力してください';
  if (name.length > MAX_NAME_LENGTH) return `フォーメーション名は${MAX_NAME_LENGTH}文字以内にしてください`;
  if (originalName === DEFAULT_FORMATION && name !== DEFAULT_FORMATION) {
    return `${DEFAULT_FORMATION} の名前は変更できません`;
  }
  if (name !== originalName && formations.some((f) => f.name === name)) {
    return `「${name}」は登録済みです`;
  }
  return null;
}

// 既存の編集なら置き換え (名前の変更も含む)、新規なら末尾に追加する。
export function upsertFormation(formations, formation, originalName) {
  const copy = { name: formation.name, slots: formation.slots.map((s) => ({ x: s.x, y: s.y })) };
  const index = originalName ? formations.findIndex((f) => f.name === originalName) : -1;
  if (index < 0) return [...formations, copy];
  const next = [...formations];
  next[index] = copy;
  return next;
}

// 4-4-2 はクリア時の戻り先なので削除できない。
export function canDelete(name) {
  return name !== DEFAULT_FORMATION;
}

export function removeFormation(formations, name) {
  if (!canDelete(name)) return formations;
  return formations.filter((f) => f.name !== name);
}

// 編集用の下書き。新規作成は 4-4-2 の配置から始める。
export function draftFrom(formations, name) {
  const source =
    formations.find((f) => f.name === name) ??
    formations.find((f) => f.name === DEFAULT_FORMATION) ??
    formations[0];
  return {
    name: name && source.name === name ? source.name : '',
    slots: source.slots.map((s) => ({ x: s.x, y: s.y })),
  };
}

export function sameSlots(a, b) {
  return a.length === b.length && a.every((s, i) => s.x === b[i].x && s.y === b[i].y);
}
