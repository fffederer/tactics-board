// フォーメーション作成画面 (PC のみ)。
// 左の一覧から選ぶと編集、「新規作成」は 4-4-2 の配置から始める。
import { DEFAULT_COLORS, sortedFormationNames } from './logic.js';
import {
  normalizeName,
  validateName,
  canDelete,
  draftFrom,
  sameSlots,
} from './formations.js';
import { loadFormations, saveFormation, deleteFormation } from './dataSource.js';
import { setupSvg, renderIcons } from './render.js';
import { enableDrag } from './drag.js';
import { showStatus, hideStatus, initSettings } from './ui.js';

const svg = document.getElementById('pitch');
const form = document.querySelector('.editor-bar');
const nameInput = form.elements.name;
const errorEl = form.querySelector('.editor-error');
const modeEl = form.querySelector('.editor-mode');
const listEl = document.querySelector('.formation-list ul');

const state = {
  formations: [],
  original: null, // 編集中の既存フォーメーション名。新規作成なら null
  draft: null, // { name, slots }
  saved: null, // 最後に登録 (または読み込み) した時点の下書き。未保存の変更の判定に使う
};
let iconLayer;

const isDirty = () =>
  normalizeName(nameInput.value) !== state.saved.name || !sameSlots(state.draft.slots, state.saved.slots);

function confirmDiscard() {
  return !isDirty() || confirm('編集中の内容は登録されていません。破棄しますか?');
}

// ---- 描画 ----

function renderList() {
  listEl.replaceChildren(
    ...sortedFormationNames(state.formations).map((name) => {
      const li = document.createElement('li');
      li.classList.toggle('selected', name === state.original);
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'open-btn';
      open.textContent = name;
      open.addEventListener('click', () => {
        if (name !== state.original && confirmDiscard()) startEdit(name);
      });
      li.appendChild(open);
      if (canDelete(name)) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'delete-btn';
        del.textContent = '削除';
        del.setAttribute('aria-label', `${name} を削除`);
        del.addEventListener('click', () => remove(name));
        li.appendChild(del);
      }
      return li;
    }),
  );
}

function renderPitch() {
  renderIcons(iconLayer, [
    {
      side: 'home',
      iconColor: DEFAULT_COLORS.home.icon,
      numberColor: DEFAULT_COLORS.home.number,
      icons: state.draft.slots.map((s, i) => ({
        row: i,
        x: s.x,
        y: s.y,
        number: i + 1,
        short: i === 0 ? 'GK' : '',
      })),
    },
  ]);
}

function renderForm() {
  modeEl.textContent = state.original ? `「${state.original}」を編集中` : '新規作成';
  // 4-4-2 はクリア時の戻り先なので、名前は変えられない
  nameInput.readOnly = !canDelete(state.original ?? '');
  errorEl.textContent = '';
}

function render() {
  renderList();
  renderForm();
  renderPitch();
}

// ---- 操作 ----

function startEdit(name) {
  state.original = name;
  state.draft = draftFrom(state.formations, name);
  state.saved = { name: state.draft.name, slots: state.draft.slots.map((s) => ({ ...s })) };
  nameInput.value = state.draft.name;
  render();
  if (!name) nameInput.focus();
}

async function register(e) {
  e.preventDefault();
  const name = normalizeName(nameInput.value);
  nameInput.value = name;
  const error = validateName(name, state.formations, state.original);
  if (error) {
    errorEl.textContent = error;
    return;
  }
  const formation = { name, slots: state.draft.slots };
  const submit = form.querySelector('button[type=submit]');
  submit.disabled = true;
  showStatus('登録中…', { sticky: true });
  try {
    state.formations = await saveFormation(formation, state.original);
  } catch (err) {
    console.error(err);
    hideStatus();
    errorEl.textContent = `登録できませんでした: ${err.message}`;
    return;
  } finally {
    submit.disabled = false;
  }
  const wasNew = !state.original;
  startEdit(name);
  showStatus(wasNew ? `「${name}」を登録しました` : `「${name}」を更新しました`);
}

async function remove(name) {
  if (!confirm(`「${name}」を削除しますか?この操作は元に戻せません。`)) return;
  showStatus('削除中…', { sticky: true });
  try {
    state.formations = await deleteFormation(name);
  } catch (err) {
    console.error(err);
    showStatus(`削除できませんでした: ${err.message}`, { sticky: true });
    return;
  }
  if (state.original === name) startEdit(null);
  else renderList();
  showStatus(`「${name}」を削除しました`);
}

async function init() {
  initSettings();
  iconLayer = setupSvg(svg);
  showStatus('読み込み中…', { sticky: true });
  try {
    state.formations = await loadFormations();
  } catch (err) {
    console.error(err);
    showStatus(`フォーメーションを読み込めませんでした: ${err.message}`, { sticky: true });
    return;
  }
  hideStatus();
  enableDrag(svg, iconLayer, {
    getPosition: (_side, row) => state.draft.slots[row],
    onDrop: (_side, row, pos) => {
      state.draft.slots[row] = pos;
      renderPitch();
    },
  });
  form.addEventListener('submit', register);
  nameInput.addEventListener('input', () => (errorEl.textContent = ''));
  document.querySelector('[data-action="new"]').addEventListener('click', () => {
    if (confirmDiscard()) startEdit(null);
  });
  window.addEventListener('beforeunload', (e) => {
    if (isDirty()) e.preventDefault();
  });
  startEdit(null);
}

init();
