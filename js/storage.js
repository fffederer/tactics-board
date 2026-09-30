// 最後のボードの状態をブラウザに自動保存する。使えない環境では黙って何もしない。
const KEY = 'tactics-board:board:v1';

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveState(board) {
  try {
    localStorage.setItem(KEY, JSON.stringify(board));
  } catch {
    // 保存できなくても操作は続けられる
  }
}
