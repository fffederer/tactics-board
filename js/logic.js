// 戦術ボードの状態とルール。DOM に依存しない純粋な関数だけを置く。
// 座標はコートの長さ・幅に対する割合 (0〜1)。x=0 がホームのゴールライン、y=0 がコート上側。

export const PITCH_LENGTH = 105;
export const PITCH_WIDTH = 68;
export const SLOT_COUNT = 11;
export const DEFAULT_FORMATION = '4-4-2';
export const SIDES = ['home', 'away'];
export const POSITION_ORDER = ['GK', 'DF', 'MF', 'FW'];

export const DEFAULT_COLORS = {
  home: { icon: 'red', number: 'white' },
  away: { icon: 'blue', number: 'white' },
};

// HTML 基本16色
export const ICON_COLORS = [
  { value: 'red', label: '赤' },
  { value: 'maroon', label: 'えんじ' },
  { value: 'fuchsia', label: 'ピンク' },
  { value: 'purple', label: '紫' },
  { value: 'blue', label: '青' },
  { value: 'navy', label: '紺' },
  { value: 'aqua', label: '水色' },
  { value: 'teal', label: '青緑' },
  { value: 'lime', label: '黄緑' },
  { value: 'green', label: '緑' },
  { value: 'olive', label: 'オリーブ' },
  { value: 'yellow', label: '黄' },
  { value: 'white', label: '白' },
  { value: 'silver', label: '銀' },
  { value: 'gray', label: '灰' },
  { value: 'black', label: '黒' },
];

export const NUMBER_COLORS = [
  { value: 'white', label: '白' },
  { value: 'black', label: '黒' },
];

export const otherSide = (side) => (side === 'home' ? 'away' : 'home');

// 選手DBに ID 列はないため、チーム名と選手名の組で選手を識別する。
export const playerKey = (p) => `${p.team}|${p.name}`;

export const clampRatio = (v) => Math.min(1, Math.max(0, v));

// フォーメーションはホームが右へ攻める向きで保存されている。
// アウェイはコート中心を軸に 180 度回転 (点対称) させる。ADR-0002 参照。
export function toBoard(side, slot) {
  return side === 'home' ? { x: slot.x, y: slot.y } : { x: 1 - slot.x, y: 1 - slot.y };
}

export function findFormation(formations, name) {
  return formations.find((f) => f.name === name) ?? null;
}

export function initialPositions(side, formations, name) {
  const f =
    findFormation(formations, name) ??
    findFormation(formations, DEFAULT_FORMATION) ??
    formations[0];
  return f.slots.map((s) => toBoard(side, s));
}

// フォーメーション選択欄の並び: 4-4-2 を先頭に固定し、残りは名前の降順
export function sortedFormationNames(formations) {
  const rest = formations
    .map((f) => f.name)
    .filter((n) => n !== DEFAULT_FORMATION)
    .sort((a, b) => b.localeCompare(a, 'ja', { numeric: true }));
  return formations.some((f) => f.name === DEFAULT_FORMATION) ? [DEFAULT_FORMATION, ...rest] : rest;
}

const uniqueSorted = (values) => [...new Set(values)].sort((a, b) => a.localeCompare(b, 'ja'));

export function listLeagues(players) {
  return uniqueSorted(players.map((p) => p.league));
}

// 相手側で選ばれているチームは選べない。
export function listTeams(players, league, excludedTeam) {
  return uniqueSorted(
    players.filter((p) => p.league === league && p.team !== excludedTeam).map((p) => p.team),
  );
}

export function comparePlayers(a, b) {
  const pos = POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position);
  if (pos !== 0) return pos;
  const na = a.number ?? Infinity;
  const nb = b.number ?? Infinity;
  if (na !== nb) return na - nb;
  return a.name.localeCompare(b.name, 'ja');
}

// 1 行目 (配置枠1) は GK だけ、2〜11 行目は GK 以外。ほかの行で選択済みの選手は除く。
export function rowCandidates(players, teamState, row) {
  const taken = new Set(teamState.lineup.filter((k, i) => k && i !== row));
  return players
    .filter(
      (p) =>
        p.team === teamState.team &&
        (row === 0 ? p.position === 'GK' : p.position !== 'GK') &&
        !taken.has(playerKey(p)),
    )
    .sort(comparePlayers);
}

// 選手プルダウンの表示。例: 「DF フィルジル・ファン・ダイク」
export function playerLabel(p) {
  return `${p.position} ${p.name}`;
}

export function findPlayer(players, key) {
  return key ? players.find((p) => playerKey(p) === key) ?? null : null;
}

export function createTeamState(side, formations) {
  return {
    league: '',
    team: '',
    formation: DEFAULT_FORMATION,
    lineup: Array(SLOT_COUNT).fill(null),
    iconColor: DEFAULT_COLORS[side].icon,
    numberColor: DEFAULT_COLORS[side].number,
    positions: initialPositions(side, formations, DEFAULT_FORMATION),
  };
}

export function createBoardState(formations) {
  return { home: createTeamState('home', formations), away: createTeamState('away', formations) };
}

const withSide = (board, side, patch) => ({ ...board, [side]: { ...board[side], ...patch } });
const emptyLineup = () => Array(SLOT_COUNT).fill(null);

// リーグを選び直すと、チームとスタメン表は空になる。
export function setLeague(board, side, league) {
  if (board[side].league === league) return board;
  return withSide(board, side, { league, team: '', lineup: emptyLineup() });
}

// チームを切り替えるとスタメン表は空になる。動かした位置は残す。
export function setTeam(board, side, team, players) {
  if (board[side].team === team) return board;
  if (team && board[otherSide(side)].team === team) return board;
  const league = team
    ? players.find((p) => p.team === team)?.league ?? board[side].league
    : board[side].league;
  return withSide(board, side, { league, team, lineup: emptyLineup() });
}

// フォーメーションを変更すると、そのチームのアイコンは新しい初期位置へ移動する。
export function setFormation(board, side, name, formations) {
  if (!findFormation(formations, name)) return board;
  return withSide(board, side, {
    formation: name,
    positions: initialPositions(side, formations, name),
  });
}

// 配置リセット: 今のフォーメーションの初期位置に戻す。
export function resetPositions(board, side, formations) {
  return withSide(board, side, {
    positions: initialPositions(side, formations, board[side].formation),
  });
}

export function setPlayer(board, side, row, key) {
  const lineup = [...board[side].lineup];
  if (key && lineup.some((k, i) => k === key && i !== row)) return board;
  lineup[row] = key || null;
  return withSide(board, side, { lineup });
}

export function movePlayer(board, side, row, pos) {
  const positions = [...board[side].positions];
  positions[row] = { x: clampRatio(pos.x), y: clampRatio(pos.y) };
  return withSide(board, side, { positions });
}

export function setColor(board, side, kind, value) {
  const list = kind === 'icon' ? ICON_COLORS : NUMBER_COLORS;
  if (!list.some((c) => c.value === value)) return board;
  return withSide(board, side, kind === 'icon' ? { iconColor: value } : { numberColor: value });
}

// クリア: リーグ・チーム・スタメン表を空にし、フォーメーションを 4-4-2、色を初期値に戻す。
export function clearTeam(board, side, formations) {
  return { ...board, [side]: createTeamState(side, formations) };
}

const isRatio = (v) => typeof v === 'number' && v >= 0 && v <= 1;

function isWellFormedTeam(t) {
  return (
    !!t &&
    typeof t.league === 'string' &&
    typeof t.team === 'string' &&
    typeof t.formation === 'string' &&
    Array.isArray(t.lineup) &&
    t.lineup.length === SLOT_COUNT &&
    Array.isArray(t.positions) &&
    t.positions.length === SLOT_COUNT &&
    t.positions.every((p) => p && isRatio(p.x) && isRatio(p.y))
  );
}

// 自動保存した状態を、最新の選手DBとフォーメーションに合わせる。
// 消えた選手の行は空欄、チームごと消えていればクリア。背番号・略称の変更は描画時に最新値を使う。
export function reconcile(saved, players, formations) {
  let board = createBoardState(formations);
  for (const side of SIDES) {
    const t = saved?.[side];
    if (!isWellFormedTeam(t)) continue;
    const teamPlayers = t.team ? players.filter((p) => p.team === t.team) : [];
    if (t.team && teamPlayers.length === 0) continue;
    if (t.team && side === 'away' && board.home.team === t.team) continue;
    const keys = new Set(teamPlayers.map(playerKey));
    const league = t.team
      ? teamPlayers[0].league
      : players.some((p) => p.league === t.league)
        ? t.league
        : '';
    const formationExists = !!findFormation(formations, t.formation);
    board = withSide(board, side, {
      league,
      team: t.team,
      lineup: t.lineup.map((k) => (k && keys.has(k) ? k : null)),
      formation: formationExists ? t.formation : DEFAULT_FORMATION,
      positions: formationExists
        ? t.positions
        : initialPositions(side, formations, DEFAULT_FORMATION),
      iconColor: ICON_COLORS.some((c) => c.value === t.iconColor)
        ? t.iconColor
        : DEFAULT_COLORS[side].icon,
      numberColor: NUMBER_COLORS.some((c) => c.value === t.numberColor)
        ? t.numberColor
        : DEFAULT_COLORS[side].number,
    });
  }
  return board;
}

// フォーメーション図に描くアイコン。選手が未選択の配置枠は描かない。
export function visibleIcons(teamState, players) {
  return teamState.lineup.flatMap((key, row) => {
    const p = findPlayer(players, key);
    if (!p) return [];
    const pos = teamState.positions[row];
    return [{ row, x: pos.x, y: pos.y, number: p.number, short: p.short }];
  });
}

// 画像に入れる「チーム名 フォーメーション名」。チーム未選択ならフォーメーション名だけ。
export function imageTitle(teamState) {
  return teamState.team ? `${teamState.team} ${teamState.formation}` : teamState.formation;
}
