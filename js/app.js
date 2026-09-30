// 戦術ボード画面。状態は logic.js の純粋関数で更新し、変わるたびに全体を描き直して自動保存する。
import * as B from './logic.js';
import { loadData } from './dataSource.js';
import { loadState, saveState } from './storage.js';
import { setupSvg, renderIcons, renderPng } from './render.js';
import { enableDrag } from './drag.js';
import { showStatus, hideStatus, initSettings } from './ui.js';

const SIDE_LABEL = { home: 'ホーム', away: 'アウェイ' };

const app = { players: [], formations: [], board: null, ui: {} };
const svg = document.getElementById('pitch');
let iconLayer;

function commit(next) {
  if (next !== app.board) {
    app.board = next;
    saveState(next);
  }
  render();
}

// ---- 描画 ----

function fillSelect(select, items, value, placeholder) {
  const options = [];
  if (placeholder != null) options.push(new Option(placeholder, ''));
  for (const it of items) options.push(new Option(it.label, it.value));
  select.replaceChildren(...options);
  select.value = value ?? '';
}

function buildPanel(side) {
  const panel = document.querySelector(`.panel[data-side="${side}"]`);
  panel.innerHTML = `
    <h2>${SIDE_LABEL[side]}</h2>
    <div class="fields">
      <label>リーグ<select data-field="league"></select></label>
      <label>チーム<select data-field="team"></select></label>
      <label>アイコンの色<select data-field="iconColor"></select></label>
      <label>背番号の色<select data-field="numberColor"></select></label>
      <div class="clear-row"><button type="button" data-action="clear">クリア</button></div>
    </div>
    <table class="lineup">
      <thead><tr><th>背番号</th><th>ポジション</th><th>選手名</th></tr></thead>
      <tbody></tbody>
    </table>`;
  const tbody = panel.querySelector('tbody');
  const rows = [];
  for (let i = 0; i < B.SLOT_COUNT; i++) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="num"></td><td class="pos"></td><td><select data-row="${i}" aria-label="${i + 1}行目の選手"></select></td>`;
    tbody.appendChild(tr);
    rows.push({ num: tr.children[0], pos: tr.children[1], select: tr.querySelector('select') });
  }
  const field = (name) => panel.querySelector(`[data-field="${name}"]`);
  const ctl = document.querySelector(`.formation-ctl[data-side="${side}"]`);
  app.ui[side] = {
    panel,
    league: field('league'),
    team: field('team'),
    iconColor: field('iconColor'),
    numberColor: field('numberColor'),
    rows,
    formation: ctl.querySelector('select'),
  };

  const ui = app.ui[side];
  ui.league.addEventListener('change', () => commit(B.setLeague(app.board, side, ui.league.value)));
  ui.team.addEventListener('change', () =>
    commit(B.setTeam(app.board, side, ui.team.value, app.players)),
  );
  ui.iconColor.addEventListener('change', () =>
    commit(B.setColor(app.board, side, 'icon', ui.iconColor.value)),
  );
  ui.numberColor.addEventListener('change', () =>
    commit(B.setColor(app.board, side, 'number', ui.numberColor.value)),
  );
  panel.querySelector('[data-action="clear"]').addEventListener('click', () =>
    commit(B.clearTeam(app.board, side, app.formations)),
  );
  rows.forEach((r, i) =>
    r.select.addEventListener('change', () =>
      commit(B.setPlayer(app.board, side, i, r.select.value || null)),
    ),
  );
  ui.formation.addEventListener('change', () =>
    commit(B.setFormation(app.board, side, ui.formation.value, app.formations)),
  );
  ctl.querySelector('[data-action="reset"]').addEventListener('click', () =>
    commit(B.resetPositions(app.board, side, app.formations)),
  );
}

function renderPanel(side) {
  const ui = app.ui[side];
  const t = app.board[side];
  const other = app.board[B.otherSide(side)];
  const asItems = (values) => values.map((v) => ({ value: v, label: v }));

  ui.panel.style.setProperty('--team-color', t.iconColor);
  fillSelect(ui.league, asItems(B.listLeagues(app.players)), t.league, 'リーグを選択');
  fillSelect(ui.team, asItems(t.league ? B.listTeams(app.players, t.league, other.team) : []), t.team, 'チームを選択');
  ui.team.disabled = !t.league;
  fillSelect(ui.iconColor, B.ICON_COLORS, t.iconColor);
  fillSelect(ui.numberColor, B.NUMBER_COLORS, t.numberColor);
  fillSelect(
    ui.formation,
    B.sortedFormationNames(app.formations).map((n) => ({ value: n, label: n })),
    t.formation,
  );

  ui.rows.forEach((r, i) => {
    const current = B.findPlayer(app.players, t.lineup[i]);
    const items = B.rowCandidates(app.players, t, i).map((p) => ({
      value: B.playerKey(p),
      label: B.playerLabel(p),
    }));
    fillSelect(r.select, items, t.lineup[i], t.team ? (i === 0 ? 'GK を選択' : '選手を選択') : '');
    r.select.disabled = !t.team;
    r.num.textContent = current?.number ?? '';
    r.pos.textContent = current?.position ?? '';
  });
}

function renderBoard() {
  renderIcons(
    iconLayer,
    // 後に描いた方が前面に出る。重なったときはホームを前面にするため、アウェイから描く。
    ['away', 'home'].map((side) => ({
      side,
      icons: B.visibleIcons(app.board[side], app.players),
      iconColor: app.board[side].iconColor,
      numberColor: app.board[side].numberColor,
    })),
  );
}

function render() {
  for (const side of B.SIDES) renderPanel(side);
  renderBoard();
}

// ---- 画像保存 ----

function fileName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `tactics_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.png`;
}

function showPreview(blob) {
  const box = document.getElementById('preview');
  const img = box.querySelector('img');
  if (img.src) URL.revokeObjectURL(img.src);
  img.src = URL.createObjectURL(blob);
  box.hidden = false;
}

async function saveImage() {
  const titles = { home: B.imageTitle(app.board.home), away: B.imageTitle(app.board.away) };
  let blob;
  try {
    blob = await renderPng(svg, titles);
  } catch (err) {
    showStatus('画像を作れませんでした');
    console.error(err);
    return;
  }
  const file = new File([blob], fileName(), { type: 'image/png' });
  const touch = matchMedia('(pointer: coarse)').matches;

  // iPhone: 共有シートから「写真に保存」。共有できないときは長押し保存用のプレビューを出す。
  if (touch) {
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    showPreview(blob);
    return;
  }

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  showStatus('画像を保存しました');
}

// ---- タブ (iPhone) ----

function enableTabs() {
  document.querySelectorAll('.tabs button').forEach((btn) =>
    btn.addEventListener('click', () => {
      document.body.dataset.tab = btn.dataset.tab;
      document
        .querySelectorAll('.tabs button')
        .forEach((b) => b.setAttribute('aria-current', String(b === btn)));
    }),
  );
}

async function init() {
  initSettings();
  iconLayer = setupSvg(svg);
  showStatus('読み込み中…', { sticky: true });
  try {
    const data = await loadData();
    app.players = data.players;
    app.formations = data.formations;
  } catch (err) {
    console.error(err);
    showStatus(`データを読み込めませんでした: ${err.message}`, { sticky: true });
    return;
  }
  hideStatus();
  const saved = loadState();
  app.board = saved
    ? B.reconcile(saved, app.players, app.formations)
    : B.createBoardState(app.formations);
  for (const side of B.SIDES) buildPanel(side);
  enableDrag(svg, iconLayer, {
    getPosition: (side, row) => app.board[side].positions[row],
    onDrop: (side, row, pos) => commit(B.movePlayer(app.board, side, row, pos)),
  });
  enableTabs();
  document.getElementById('save-image').addEventListener('click', saveImage);
  document
    .querySelector('[data-action="close-preview"]')
    .addEventListener('click', () => (document.getElementById('preview').hidden = true));
  render();
}

init();
