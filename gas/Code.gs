/**
 * 戦術ボード API (Google Apps Script)
 *
 * スプレッドシートに紐づけ、ウェブアプリとしてデプロイして使う。設定手順は docs/setup-gas.md。
 *   GET  : 選手DBとフォーメーションを返す
 *   POST : フォーメーションの登録・削除 (本文は JSON。Content-Type は text/plain)
 * 最初に一度だけ setup() を実行すると、シートと入力規則と初期データが作られる。
 */

const SHEET_PLAYERS = '選手DB';
const SHEET_FORMATIONS = 'フォーメーション';
const PLAYER_HEADERS = ['リーグ', 'チーム', 'ポジション', '背番号', '選手名', '略称'];
const POSITIONS = ['GK', 'DF', 'MF', 'FW'];
const DEFAULT_FORMATION = '4-4-2';
const SLOT_COUNT = 11;
const MAX_NAME_LENGTH = 20;
const MIN_PLAYER_ROWS = 5000; // 入力規則をかけておく行数 (約2,500人 + 余裕)

// ---------------------------------------------------------------------------
// ウェブアプリの入口
// ---------------------------------------------------------------------------

function doGet() {
  try {
    return json_({ ok: true, players: readPlayers_(), formations: readFormations_() });
  } catch (err) {
    return json_({ ok: false, error: errorMessage_(err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const req = JSON.parse(e.postData.contents);
    if (req.action === 'saveFormation') {
      saveFormation_(req.formation, req.originalName || null);
    } else if (req.action === 'deleteFormation') {
      deleteFormation_(req.name);
    } else {
      throw new Error('不明な操作です: ' + req.action);
    }
    return json_({ ok: true, formations: readFormations_() });
  } catch (err) {
    return json_({ ok: false, error: errorMessage_(err) });
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function errorMessage_(err) {
  return String((err && err.message) || err);
}

// ---------------------------------------------------------------------------
// 変換と検査 (シートに触れない関数)
// ---------------------------------------------------------------------------

function normalizeName(raw) {
  return String(raw == null ? '' : raw).normalize('NFKC').trim();
}

function formationHeaders() {
  const headers = ['フォーメーション名'];
  for (let i = 1; i <= SLOT_COUNT; i++) headers.push('枠' + i + '_横', '枠' + i + '_縦');
  return headers;
}

// 選手DBの行 (見出し行を除く) を選手の一覧にする。必須項目が欠けた行やポジションが不正な行は読み飛ばす。
function parsePlayers(rows) {
  const players = [];
  rows.forEach(function (r) {
    const league = String(r[0]).trim();
    const team = String(r[1]).trim();
    const position = String(r[2]).trim().toUpperCase();
    const name = String(r[4]).trim();
    if (!league || !team || !name || POSITIONS.indexOf(position) < 0) return;
    const rawNumber = String(r[3]).trim();
    const number = rawNumber === '' || isNaN(Number(rawNumber)) ? null : Number(rawNumber);
    const short = String(r[5]).trim() || name;
    players.push({ league: league, team: team, position: position, number: number, name: name, short: short });
  });
  return players;
}

function isRatio_(v) {
  return typeof v === 'number' && isFinite(v) && v >= 0 && v <= 1;
}

function isValidSlots(slots) {
  return (
    Array.isArray(slots) &&
    slots.length === SLOT_COUNT &&
    slots.every(function (s) {
      return s && isRatio_(s.x) && isRatio_(s.y);
    })
  );
}

// 「4-4-2」のような名前は、スプレッドシートが日付 (2004/4/2) と解釈してしまう。
// そのため名前の列は「書式なしテキスト」にしてから書き込む。すでに日付になった値は元の名前に戻す。
function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]';
}

function formationNameFromCell(value, timeZone) {
  if (!isDate_(value)) return normalizeName(value);
  const parts = Utilities.formatDate(value, timeZone, 'yyyy-M-d').split('-').map(Number);
  return [parts[0] % 100, parts[1], parts[2]].join('-');
}

// フォーメーションの行 (見出し行を除く) を一覧にする。壊れた行は読み飛ばす。
function parseFormations(rows, timeZone) {
  const formations = [];
  rows.forEach(function (r) {
    const name = formationNameFromCell(r[0], timeZone);
    if (!name) return;
    const slots = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      slots.push({ x: Number(r[1 + i * 2]), y: Number(r[2 + i * 2]) });
    }
    if (isValidSlots(slots)) formations.push({ name: name, slots: slots });
  });
  return formations;
}

function formationToRow(f) {
  const row = [f.name];
  f.slots.forEach(function (s) {
    row.push(Math.round(s.x * 10000) / 10000, Math.round(s.y * 10000) / 10000);
  });
  return row;
}

// 登録できないならその理由を、できるなら null を返す。画面側 (js/formations.js) と同じ規則。
function checkFormationSave(formations, formation, originalName) {
  const name = formation.name;
  if (!name) return 'フォーメーション名を入力してください';
  if (name.length > MAX_NAME_LENGTH) return 'フォーメーション名は' + MAX_NAME_LENGTH + '文字以内にしてください';
  if (!isValidSlots(formation.slots)) return '配置枠の座標が正しくありません';
  if (originalName === DEFAULT_FORMATION && name !== DEFAULT_FORMATION) {
    return DEFAULT_FORMATION + ' の名前は変更できません';
  }
  const taken = formations.some(function (f) {
    return f.name === name;
  });
  if (name !== originalName && taken) return '「' + name + '」は登録済みです';
  return null;
}

// ---------------------------------------------------------------------------
// シートの読み書き
// ---------------------------------------------------------------------------

function sheet_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('シート「' + name + '」がありません。setup を実行してください');
  return sheet;
}

function bodyRows_(sheet) {
  return sheet.getDataRange().getValues().slice(1);
}

function readPlayers_() {
  return parsePlayers(bodyRows_(sheet_(SHEET_PLAYERS)));
}

function timeZone_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
}

function readFormations_() {
  return parseFormations(bodyRows_(sheet_(SHEET_FORMATIONS)), timeZone_());
}

// シート上の行番号 (1 始まり)。見つからなければ -1。
function findFormationRow_(sheet, name) {
  const rows = bodyRows_(sheet);
  const tz = timeZone_();
  for (let i = 0; i < rows.length; i++) {
    if (formationNameFromCell(rows[i][0], tz) === name) return i + 2;
  }
  return -1;
}

// 名前の列を書式なしテキストにしてから行を書き込む (日付への自動変換を防ぐ)。
function writeFormationRows_(sheet, row, rows) {
  sheet.getRange(row, 1, rows.length, 1).setNumberFormat('@');
  sheet.getRange(row, 1, rows.length, rows[0].length).setValues(rows);
}

// 名前の列全体を書式なしテキストにし、日付になってしまった名前を元に戻す。
function repairFormationNames_(sheet) {
  sheet.getRange(1, 1, sheet.getMaxRows(), 1).setNumberFormat('@');
  const rows = bodyRows_(sheet);
  const tz = timeZone_();
  rows.forEach(function (r, i) {
    if (isDate_(r[0])) sheet.getRange(i + 2, 1).setValue(formationNameFromCell(r[0], tz));
  });
}

function saveFormation_(input, originalName) {
  const formation = {
    name: normalizeName(input && input.name),
    slots: (input && input.slots) || [],
  };
  const error = checkFormationSave(readFormations_(), formation, originalName);
  if (error) throw new Error(error);
  const sheet = sheet_(SHEET_FORMATIONS);
  const row = originalName ? findFormationRow_(sheet, originalName) : -1;
  writeFormationRows_(sheet, row > 0 ? row : sheet.getLastRow() + 1, [formationToRow(formation)]);
}

function deleteFormation_(rawName) {
  const name = normalizeName(rawName);
  if (name === DEFAULT_FORMATION) throw new Error(DEFAULT_FORMATION + ' は削除できません');
  const sheet = sheet_(SHEET_FORMATIONS);
  const row = findFormationRow_(sheet, name);
  if (row > 0) sheet.deleteRow(row);
}

// ---------------------------------------------------------------------------
// 初期設定 (Apps Script エディタから一度だけ実行する)
// ---------------------------------------------------------------------------

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const players = ss.getSheetByName(SHEET_PLAYERS) || ss.insertSheet(SHEET_PLAYERS);
  if (players.getLastRow() === 0) {
    players.getRange(1, 1, 1, PLAYER_HEADERS.length).setValues([PLAYER_HEADERS]);
    if (SEED_PLAYERS.length) {
      players.getRange(2, 1, SEED_PLAYERS.length, PLAYER_HEADERS.length).setValues(SEED_PLAYERS);
    }
  }
  players.setFrozenRows(1);
  players.getRange(1, 1, 1, PLAYER_HEADERS.length).setFontWeight('bold');
  if (players.getMaxRows() < MIN_PLAYER_ROWS) {
    players.insertRowsAfter(players.getMaxRows(), MIN_PLAYER_ROWS - players.getMaxRows());
  }
  const rows = players.getMaxRows() - 1;
  // リーグ・チーム: 既存の値をプルダウンの候補にしつつ、新しい値の手入力も許す (警告表示)
  [1, 2].forEach(function (col) {
    const column = players.getRange(2, col, rows, 1);
    column.setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInRange(column, true).setAllowInvalid(true).build(),
    );
  });
  // ポジション: GK/DF/MF/FW のみ (それ以外は拒否)
  players
    .getRange(2, 3, rows, 1)
    .setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(POSITIONS, true).setAllowInvalid(false).build(),
    );
  // 背番号: 0〜999 の数字。未定なら空欄
  players
    .getRange(2, 4, rows, 1)
    .setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireNumberBetween(0, 999)
        .setAllowInvalid(false)
        .setHelpText('背番号は 0〜999 の数字です。未定なら空欄にします。')
        .build(),
    );

  const formations = ss.getSheetByName(SHEET_FORMATIONS) || ss.insertSheet(SHEET_FORMATIONS);
  const headers = formationHeaders();
  if (formations.getLastRow() === 0) {
    formations.getRange(1, 1, 1, headers.length).setValues([headers]);
    writeFormationRows_(formations, 2, SEED_FORMATIONS.map(formationToRow));
  }
  repairFormationNames_(formations);
  formations.setFrozenRows(1);
  formations.getRange(1, 1, 1, headers.length).setFontWeight('bold');

  // 新規作成時にできる空のシートは消す
  ss.getSheets().forEach(function (s) {
    const name = s.getName();
    if (name !== SHEET_PLAYERS && name !== SHEET_FORMATIONS && s.getLastRow() === 0) ss.deleteSheet(s);
  });
}

// ---------------------------------------------------------------------------
// 初期データ (setup で空のシートにだけ書き込む)
// 選手は動作確認用のサンプル (3チーム)。本番のデータは手順4で入れ替える。
// ---------------------------------------------------------------------------

const SEED_PLAYERS = [
  ["プレミアリーグ","リバプール","GK",1,"アリソン・ベッカー","アリソン"],
  ["プレミアリーグ","リバプール","GK",25,"ギオルギ・ママルダシュヴィリ","ママルダシュヴィリ"],
  ["プレミアリーグ","リバプール","DF",2,"ジョー・ゴメス","ゴメス"],
  ["プレミアリーグ","リバプール","DF",4,"フィルジル・ファン・ダイク","ファン・ダイク"],
  ["プレミアリーグ","リバプール","DF",5,"イブラヒマ・コナテ","コナテ"],
  ["プレミアリーグ","リバプール","DF",6,"ミロシュ・ケルケズ","ケルケズ"],
  ["プレミアリーグ","リバプール","DF",12,"コナー・ブラッドリー","ブラッドリー"],
  ["プレミアリーグ","リバプール","DF",26,"アンドリュー・ロバートソン","ロバートソン"],
  ["プレミアリーグ","リバプール","DF",30,"ジェレミー・フリンポン","フリンポン"],
  ["プレミアリーグ","リバプール","MF",3,"遠藤航","遠藤"],
  ["プレミアリーグ","リバプール","MF",7,"フロリアン・ヴィルツ","ヴィルツ"],
  ["プレミアリーグ","リバプール","MF",8,"ドミニク・ソボスライ","ソボスライ"],
  ["プレミアリーグ","リバプール","MF",10,"アレクシス・マク・アリスター","マク・アリスター"],
  ["プレミアリーグ","リバプール","MF",17,"カーティス・ジョーンズ","ジョーンズ"],
  ["プレミアリーグ","リバプール","MF",38,"ライアン・グラフェンベルフ","グラフェンベルフ"],
  ["プレミアリーグ","リバプール","FW",9,"アレクサンデル・イサク","イサク"],
  ["プレミアリーグ","リバプール","FW",11,"モハメド・サラー","サラー"],
  ["プレミアリーグ","リバプール","FW",18,"コーディ・ガクポ","ガクポ"],
  ["プレミアリーグ","リバプール","FW",22,"ウーゴ・エキティケ","エキティケ"],
  ["プレミアリーグ","リバプール","FW","","テスト・プレーヤー","テスト"],
  ["プレミアリーグ","マンチェスター・シティ","GK",1,"ジェームズ・トラッフォード","トラッフォード"],
  ["プレミアリーグ","マンチェスター・シティ","GK",25,"ジャンルイジ・ドンナルンマ","ドンナルンマ"],
  ["プレミアリーグ","マンチェスター・シティ","DF",3,"ルベン・ディアス","ディアス"],
  ["プレミアリーグ","マンチェスター・シティ","DF",5,"ジョン・ストーンズ","ストーンズ"],
  ["プレミアリーグ","マンチェスター・シティ","DF",6,"ナタン・アケ","アケ"],
  ["プレミアリーグ","マンチェスター・シティ","DF",24,"ヨシュコ・グヴァルディオル","グヴァルディオル"],
  ["プレミアリーグ","マンチェスター・シティ","DF",27,"マテウス・ヌネス","ヌネス"],
  ["プレミアリーグ","マンチェスター・シティ","DF",45,"アブドゥコディル・フサノフ","フサノフ"],
  ["プレミアリーグ","マンチェスター・シティ","DF",82,"リコ・ルイス","ルイス"],
  ["プレミアリーグ","マンチェスター・シティ","MF",4,"ティジャニ・ラインデルス","ラインデルス"],
  ["プレミアリーグ","マンチェスター・シティ","MF",10,"ラヤン・チェルキ","チェルキ"],
  ["プレミアリーグ","マンチェスター・シティ","MF",14,"ニコ・ゴンサレス","ゴンサレス"],
  ["プレミアリーグ","マンチェスター・シティ","MF",16,"ロドリ","ロドリ"],
  ["プレミアリーグ","マンチェスター・シティ","MF",20,"ベルナルド・シウバ","B・シウバ"],
  ["プレミアリーグ","マンチェスター・シティ","MF",47,"フィル・フォーデン","フォーデン"],
  ["プレミアリーグ","マンチェスター・シティ","FW",7,"オマル・マルムシュ","マルムシュ"],
  ["プレミアリーグ","マンチェスター・シティ","FW",9,"アーリング・ハーランド","ハーランド"],
  ["プレミアリーグ","マンチェスター・シティ","FW",11,"ジェレミー・ドク","ドク"],
  ["プレミアリーグ","マンチェスター・シティ","FW",26,"サヴィーニョ","サヴィーニョ"],
  ["ラ・リーガ","レアル・マドリード","GK",1,"ティボー・クルトワ","クルトワ"],
  ["ラ・リーガ","レアル・マドリード","GK",13,"アンドリー・ルニン","ルニン"],
  ["ラ・リーガ","レアル・マドリード","DF",2,"ダニエル・カルバハル","カルバハル"],
  ["ラ・リーガ","レアル・マドリード","DF",3,"エデル・ミリトン","ミリトン"],
  ["ラ・リーガ","レアル・マドリード","DF",12,"トレント・アレクサンダー＝アーノルド","アーノルド"],
  ["ラ・リーガ","レアル・マドリード","DF",18,"アルバロ・カレーラス","カレーラス"],
  ["ラ・リーガ","レアル・マドリード","DF",22,"アントニオ・リュディガー","リュディガー"],
  ["ラ・リーガ","レアル・マドリード","DF",24,"ディーン・ハイセン","ハイセン"],
  ["ラ・リーガ","レアル・マドリード","MF",5,"ジュード・ベリンガム","ベリンガム"],
  ["ラ・リーガ","レアル・マドリード","MF",6,"エドゥアルド・カマヴィンガ","カマヴィンガ"],
  ["ラ・リーガ","レアル・マドリード","MF",8,"フェデリコ・バルベルデ","バルベルデ"],
  ["ラ・リーガ","レアル・マドリード","MF",14,"オーレリアン・チュアメニ","チュアメニ"],
  ["ラ・リーガ","レアル・マドリード","MF",15,"アルダ・ギュレル","ギュレル"],
  ["ラ・リーガ","レアル・マドリード","FW",7,"ヴィニシウス・ジュニオール","ヴィニシウス"],
  ["ラ・リーガ","レアル・マドリード","FW",10,"キリアン・エムバペ","エムバペ"],
  ["ラ・リーガ","レアル・マドリード","FW",11,"ロドリゴ・ゴエス","ロドリゴ"],
  ["ラ・リーガ","レアル・マドリード","FW",30,"フランコ・マスタントゥオーノ","マスタントゥオーノ"],
];

// 配置枠の並び: 1=GK、以降は後ろのラインから前へ、各ライン内は上 (そのチームの左サイド) から下へ
const SEED_FORMATIONS = [
  { name: "4-4-2", slots: [{"x":0.05,"y":0.5},{"x":0.26,"y":0.12},{"x":0.22,"y":0.37},{"x":0.22,"y":0.63},{"x":0.26,"y":0.88},{"x":0.46,"y":0.12},{"x":0.42,"y":0.37},{"x":0.42,"y":0.63},{"x":0.46,"y":0.88},{"x":0.64,"y":0.37},{"x":0.64,"y":0.63}] },
  { name: "4-3-3", slots: [{"x":0.05,"y":0.5},{"x":0.26,"y":0.12},{"x":0.22,"y":0.37},{"x":0.22,"y":0.63},{"x":0.26,"y":0.88},{"x":0.46,"y":0.3},{"x":0.38,"y":0.5},{"x":0.46,"y":0.7},{"x":0.62,"y":0.15},{"x":0.66,"y":0.5},{"x":0.62,"y":0.85}] },
  { name: "4-2-3-1", slots: [{"x":0.05,"y":0.5},{"x":0.26,"y":0.12},{"x":0.22,"y":0.37},{"x":0.22,"y":0.63},{"x":0.26,"y":0.88},{"x":0.38,"y":0.37},{"x":0.38,"y":0.63},{"x":0.54,"y":0.15},{"x":0.54,"y":0.5},{"x":0.54,"y":0.85},{"x":0.68,"y":0.5}] },
  { name: "3-4-2-1", slots: [{"x":0.05,"y":0.5},{"x":0.22,"y":0.25},{"x":0.2,"y":0.5},{"x":0.22,"y":0.75},{"x":0.46,"y":0.08},{"x":0.4,"y":0.37},{"x":0.4,"y":0.63},{"x":0.46,"y":0.92},{"x":0.56,"y":0.33},{"x":0.56,"y":0.67},{"x":0.68,"y":0.5}] },
];
