// 選手DBとフォーメーションの読み書き口。画面はこのファイルの関数だけを使う。
//
// 接続先 URL が設定されていれば、スプレッドシート (GAS API) を読み書きする。
// 未設定なら「サンプルモード」: 選手はサンプルデータ、フォーメーションはこのブラウザに保存する。
import { SAMPLE_PLAYERS, SAMPLE_FORMATIONS } from '../data/sample.js';
import { isValidFormation, upsertFormation, removeFormation } from './formations.js';
import { POSITION_ORDER } from './logic.js';
import { getApiUrl, apiGet, apiPost } from './api.js';

export const isSampleMode = () => !getApiUrl();

// ---- サンプルモード ----

const FORMATIONS_KEY = 'tactics-board:formations:v1';

function readLocalFormations() {
  try {
    const list = JSON.parse(localStorage.getItem(FORMATIONS_KEY));
    if (Array.isArray(list) && list.length && list.every(isValidFormation)) return list;
  } catch {
    // 壊れていればサンプルに戻す
  }
  return SAMPLE_FORMATIONS;
}

function writeLocalFormations(list) {
  localStorage.setItem(FORMATIONS_KEY, JSON.stringify(list));
  return list;
}

// ---- スプレッドシート ----

const isValidPlayer = (p) =>
  !!p &&
  ['league', 'team', 'name', 'short'].every((k) => typeof p[k] === 'string' && p[k]) &&
  POSITION_ORDER.includes(p.position) &&
  (p.number === null || typeof p.number === 'number');

function checkFormations(list) {
  const valid = (list ?? []).filter(isValidFormation);
  if (!valid.length) {
    throw new Error('フォーメーションが1つも登録されていません。GAS の setup を実行してください');
  }
  return valid;
}

// ---- 公開する関数 ----

export async function loadData() {
  const url = getApiUrl();
  if (!url) return { players: SAMPLE_PLAYERS, formations: readLocalFormations() };
  const body = await apiGet(url);
  return {
    players: (body.players ?? []).filter(isValidPlayer),
    formations: checkFormations(body.formations),
  };
}

export async function loadFormations() {
  return (await loadData()).formations;
}

// 登録 (originalName があればその行を上書き、なければ追加)。更新後の一覧を返す。
export async function saveFormation(formation, originalName) {
  const url = getApiUrl();
  if (!url) return writeLocalFormations(upsertFormation(readLocalFormations(), formation, originalName));
  const body = await apiPost(url, { action: 'saveFormation', formation, originalName });
  return checkFormations(body.formations);
}

// 削除。4-4-2 は削除できない。更新後の一覧を返す。
export async function deleteFormation(name) {
  const url = getApiUrl();
  if (!url) return writeLocalFormations(removeFormation(readLocalFormations(), name));
  const body = await apiPost(url, { action: 'deleteFormation', name });
  return checkFormations(body.formations);
}
