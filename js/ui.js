// 両方の画面で使う UI 部品: 下部のお知らせ表示と、接続設定ダイアログ。
import { getApiUrl, setApiUrl, isValidApiUrl, importApiUrlFromHash } from './api.js';

export function showStatus(message, { sticky = false } = {}) {
  const el = document.getElementById('status');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(showStatus.timer);
  if (!sticky) showStatus.timer = setTimeout(() => el.classList.remove('show'), 2500);
}

export function hideStatus() {
  clearTimeout(showStatus.timer);
  document.getElementById('status').classList.remove('show');
}

function buildDialog() {
  const dialog = document.createElement('dialog');
  dialog.className = 'settings-dialog';
  dialog.innerHTML = `
    <form method="dialog">
      <h2>接続設定</h2>
      <p class="settings-state"></p>
      <label>GAS ウェブアプリの URL
        <input type="url" name="url" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off" spellcheck="false">
      </label>
      <p class="settings-note">URL はこの端末のブラウザにだけ保存されます。PC と iPhone でそれぞれ一度設定してください。</p>
      <p class="settings-error" role="alert"></p>
      <div class="settings-share" hidden>
        <button type="button" data-action="copy-link">iPhone 用のリンクをコピー</button>
        <span>このリンクを iPhone で開くと、URL の入力を省けます。</span>
      </div>
      <div class="settings-actions">
        <button type="button" data-action="sample">サンプルデータに戻す</button>
        <span class="spacer"></span>
        <button type="button" data-action="close">閉じる</button>
        <button type="submit" class="primary" value="save">保存して再読み込み</button>
      </div>
    </form>`;
  document.body.appendChild(dialog);
  return dialog;
}

function boardLink(url) {
  const base = new URL('index.html', location.href);
  return `${base.origin}${base.pathname}#api=${encodeURIComponent(url)}`;
}

// 接続設定ボタンとサンプルモードの表示を用意する。ページの読み込み処理より前に呼ぶ。
export function initSettings() {
  importApiUrlFromHash();
  const current = getApiUrl();
  const badge = document.querySelector('.mode-badge');
  if (badge) badge.hidden = !!current;

  const dialog = buildDialog();
  const form = dialog.querySelector('form');
  const input = form.elements.url;
  const error = dialog.querySelector('.settings-error');

  const open = () => {
    input.value = getApiUrl();
    error.textContent = '';
    dialog.querySelector('.settings-state').textContent = getApiUrl()
      ? '今はスプレッドシートのデータを表示しています。'
      : '今はサンプルデータを表示しています。フォーメーションはこのブラウザにだけ保存されます。';
    dialog.querySelector('.settings-share').hidden = !getApiUrl();
    dialog.showModal();
  };
  document.querySelectorAll('[data-action="settings"], .mode-badge').forEach((el) =>
    el.addEventListener('click', open),
  );

  form.addEventListener('submit', (e) => {
    const url = input.value.trim();
    if (!isValidApiUrl(url)) {
      e.preventDefault();
      error.textContent = 'URL の形が違います。「https://script.google.com/macros/s/…/exec」の形の URL を貼り付けてください。';
      return;
    }
    setApiUrl(url);
    location.reload();
  });
  dialog.querySelector('[data-action="close"]').addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-action="sample"]').addEventListener('click', () => {
    if (!confirm('スプレッドシートとの接続を解除して、サンプルデータに戻しますか?')) return;
    setApiUrl('');
    location.reload();
  });
  dialog.querySelector('[data-action="copy-link"]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(boardLink(getApiUrl()));
      showStatus('リンクをコピーしました');
    } catch {
      prompt('このリンクをコピーしてください', boardLink(getApiUrl()));
    }
  });
}
