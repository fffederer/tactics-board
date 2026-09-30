// GAS API (gas/Code.gs) との通信と、接続先 URL の管理。
// URL を知っていればフォーメーションを書き換えられるため、URL はコードに書かず、
// 端末ごとにこのブラウザへ保存する (ADR-0001)。
const API_KEY = 'tactics-board:api-url:v1';

const GAS_URL = /^https:\/\/script\.google\.com\/(macros|a\/macros\/[^/]+)\/s\/[\w-]+\/exec$/;
const LOCAL_URL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/\S*exec$/; // 開発・テスト用

export function isValidApiUrl(url) {
  return GAS_URL.test(url) || LOCAL_URL.test(url);
}

export function getApiUrl() {
  try {
    return localStorage.getItem(API_KEY) || '';
  } catch {
    return '';
  }
}

export function setApiUrl(url) {
  try {
    if (url) localStorage.setItem(API_KEY, url);
    else localStorage.removeItem(API_KEY);
  } catch {
    // 保存できない環境では、このページを開いている間だけ使えない
  }
}

// 「https://…/index.html#api=<URL>」で開くと、その URL を保存してアドレスから消す。
// iPhone に長い URL を入力しなくて済むようにするため。
export function importApiUrlFromHash() {
  const m = location.hash.match(/^#api=(.+)$/);
  if (!m) return false;
  history.replaceState(null, '', location.pathname + location.search);
  const url = decodeURIComponent(m[1]);
  if (!isValidApiUrl(url)) return false;
  setApiUrl(url);
  return true;
}

async function parse(res) {
  if (!res.ok) throw new Error(`通信に失敗しました (${res.status})`);
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error('スプレッドシートからの応答を読めませんでした。デプロイの設定を確認してください');
  }
  if (!body.ok) throw new Error(body.error || 'スプレッドシート側でエラーが起きました');
  return body;
}

export async function apiGet(url) {
  return parse(await fetch(url, { cache: 'no-store' }));
}

// GAS は CORS の事前確認 (preflight) に応えられないため、text/plain で JSON を送る。
export async function apiPost(url, payload) {
  return parse(
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    }),
  );
}
