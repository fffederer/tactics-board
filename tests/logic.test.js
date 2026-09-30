import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../js/logic.js';
import { SAMPLE_PLAYERS as players, SAMPLE_FORMATIONS as formations } from '../data/sample.js';

const key = (team, name) => `${team}|${name}`;
const LIV = 'リバプール';
const MCI = 'マンチェスター・シティ';

function withTeam(side = 'home', team = LIV) {
  let b = B.createBoardState(formations);
  b = B.setLeague(b, side, 'プレミアリーグ');
  return B.setTeam(b, side, team, players);
}

test('アウェイの配置はホームの配置を点対称にしたもの', () => {
  const home = B.initialPositions('home', formations, '4-3-3');
  const away = B.initialPositions('away', formations, '4-3-3');
  home.forEach((h, i) => {
    assert.ok(Math.abs(away[i].x - (1 - h.x)) < 1e-9);
    assert.ok(Math.abs(away[i].y - (1 - h.y)) < 1e-9);
  });
  // ホームの上側にいる選手は、アウェイでは下側に来る
  assert.ok(home[1].y < 0.5 && away[1].y > 0.5);
});

test('初期状態は両チーム 4-4-2、既定の色、スタメン空', () => {
  const b = B.createBoardState(formations);
  assert.equal(b.home.formation, '4-4-2');
  assert.equal(b.home.iconColor, 'red');
  assert.equal(b.away.iconColor, 'blue');
  assert.equal(b.home.numberColor, 'white');
  assert.deepEqual(b.home.lineup, Array(11).fill(null));
  assert.equal(B.visibleIcons(b.home, players).length, 0);
});

test('フォーメーション選択欄は 4-4-2 が先頭で、残りは名前の降順', () => {
  assert.deepEqual(B.sortedFormationNames(formations), ['4-4-2', '4-3-3', '4-2-3-1', '3-4-2-1']);
  const more = [...formations, { name: '5-3-2', slots: formations[0].slots }];
  assert.deepEqual(B.sortedFormationNames(more), ['4-4-2', '5-3-2', '4-3-3', '4-2-3-1', '3-4-2-1']);
});

test('相手側で選択中のチームは選べない', () => {
  const b = withTeam('home', LIV);
  assert.ok(!B.listTeams(players, 'プレミアリーグ', b.home.team).includes(LIV));
  const b2 = B.setTeam(B.setLeague(b, 'away', 'プレミアリーグ'), 'away', LIV, players);
  assert.equal(b2.away.team, '');
});

test('1行目は GK だけ、2行目以降は GK 以外', () => {
  const b = withTeam();
  assert.ok(B.rowCandidates(players, b.home, 0).every((p) => p.position === 'GK'));
  assert.ok(B.rowCandidates(players, b.home, 1).every((p) => p.position !== 'GK'));
});

test('候補は DF→MF→FW、その中は背番号順、背番号なしは最後', () => {
  const names = B.rowCandidates(players, withTeam().home, 1).map((p) => p.name);
  assert.equal(names[0], 'ジョー・ゴメス');
  assert.equal(names.at(-1), 'テスト・プレーヤー');
  const positions = B.rowCandidates(players, withTeam().home, 1).map((p) => p.position);
  assert.deepEqual(positions, [...positions].sort((a, b) => B.POSITION_ORDER.indexOf(a) - B.POSITION_ORDER.indexOf(b)));
});

test('ほかの行で選んだ選手は候補から消え、二重には選べない', () => {
  const vvd = key(LIV, 'フィルジル・ファン・ダイク');
  let b = B.setPlayer(withTeam(), 'home', 1, vvd);
  assert.ok(!B.rowCandidates(players, b.home, 2).some((p) => B.playerKey(p) === vvd));
  assert.ok(B.rowCandidates(players, b.home, 1).some((p) => B.playerKey(p) === vvd));
  const again = B.setPlayer(b, 'home', 2, vvd);
  assert.equal(again, b);
});

test('表示ラベルは「ポジション 選手名」で背番号は出さない', () => {
  assert.equal(B.playerLabel({ number: 4, name: 'フィルジル・ファン・ダイク', position: 'DF' }), 'DF フィルジル・ファン・ダイク');
  assert.equal(B.playerLabel({ number: null, name: 'テスト・プレーヤー', position: 'FW' }), 'FW テスト・プレーヤー');
});

test('未選択の配置枠のアイコンは表示しない', () => {
  const b = B.setPlayer(withTeam(), 'home', 0, key(LIV, 'アリソン・ベッカー'));
  const icons = B.visibleIcons(b.home, players);
  assert.equal(icons.length, 1);
  assert.equal(icons[0].short, 'アリソン');
});

test('チームを切り替えるとスタメンは空になるが、動かした位置は残る', () => {
  let b = B.setPlayer(withTeam(), 'home', 1, key(LIV, 'ジョー・ゴメス'));
  b = B.movePlayer(b, 'home', 1, { x: 0.4, y: 0.2 });
  b = B.setTeam(b, 'home', MCI, players);
  assert.deepEqual(b.home.lineup, Array(11).fill(null));
  assert.deepEqual(b.home.positions[1], { x: 0.4, y: 0.2 });
});

test('フォーメーションを変更すると初期位置に戻り、スタメンは残る', () => {
  let b = B.setPlayer(withTeam(), 'home', 1, key(LIV, 'ジョー・ゴメス'));
  b = B.movePlayer(b, 'home', 1, { x: 0.4, y: 0.2 });
  b = B.setFormation(b, 'home', '4-3-3', formations);
  assert.equal(b.home.lineup[1], key(LIV, 'ジョー・ゴメス'));
  assert.deepEqual(b.home.positions, B.initialPositions('home', formations, '4-3-3'));
});

test('配置リセットは今のフォーメーションの初期位置に戻す', () => {
  let b = B.setFormation(withTeam(), 'home', '4-2-3-1', formations);
  b = B.movePlayer(b, 'home', 5, { x: 0.9, y: 0.9 });
  b = B.resetPositions(b, 'home', formations);
  assert.deepEqual(b.home.positions, B.initialPositions('home', formations, '4-2-3-1'));
  assert.equal(b.home.formation, '4-2-3-1');
});

test('ドラッグ位置はコートのライン内に制限される', () => {
  const b = B.movePlayer(withTeam(), 'home', 3, { x: 1.3, y: -0.2 });
  assert.deepEqual(b.home.positions[3], { x: 1, y: 0 });
});

test('クリアはそのチームだけを初期状態に戻す', () => {
  let b = withTeam('home', LIV);
  b = B.setTeam(B.setLeague(b, 'away', 'プレミアリーグ'), 'away', MCI, players);
  b = B.setColor(b, 'home', 'icon', 'green');
  b = B.setColor(b, 'home', 'number', 'black');
  b = B.setFormation(b, 'home', '4-3-3', formations);
  b = B.clearTeam(b, 'home', formations);
  assert.deepEqual(b.home, B.createTeamState('home', formations));
  assert.equal(b.away.team, MCI);
});

test('画像のタイトルは「チーム名 フォーメーション名」、未選択ならフォーメーション名だけ', () => {
  const b = withTeam();
  assert.equal(B.imageTitle(b.home), 'リバプール 4-4-2');
  assert.equal(B.imageTitle(b.away), '4-4-2');
});

test('復元: 消えた選手は空欄、消えたチームはクリア、背番号の変更は新しい値', () => {
  let b = withTeam('home', LIV);
  b = B.setPlayer(b, 'home', 1, key(LIV, 'ジョー・ゴメス'));
  b = B.setPlayer(b, 'home', 2, key(LIV, 'フィルジル・ファン・ダイク'));
  b = B.setTeam(B.setLeague(b, 'away', 'プレミアリーグ'), 'away', MCI, players);
  b = B.setColor(b, 'away', 'icon', 'navy');

  const updated = players
    .filter((p) => p.name !== 'ジョー・ゴメス' && p.team !== MCI)
    .map((p) => (p.name === 'フィルジル・ファン・ダイク' ? { ...p, number: 44 } : p));
  const r = B.reconcile(JSON.parse(JSON.stringify(b)), updated, formations);

  assert.equal(r.home.lineup[1], null);
  assert.equal(r.home.lineup[2], key(LIV, 'フィルジル・ファン・ダイク'));
  assert.equal(B.visibleIcons(r.home, updated)[0].number, 44);
  assert.deepEqual(r.away, B.createTeamState('away', formations));
});

test('復元: 壊れた保存データや消えたフォーメーションは既定に戻す', () => {
  assert.deepEqual(B.reconcile({ home: { team: 1 } }, players, formations), B.createBoardState(formations));
  let b = B.setFormation(withTeam(), 'home', '4-3-3', formations);
  const r = B.reconcile(b, players, formations.filter((f) => f.name !== '4-3-3'));
  assert.equal(r.home.formation, '4-4-2');
  assert.deepEqual(r.home.positions, B.initialPositions('home', formations, '4-4-2'));
});
