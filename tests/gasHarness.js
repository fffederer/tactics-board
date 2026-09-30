// gas/Code.gs を Node 上で動かすためのテスト用ハーネス。
// SpreadsheetApp などの Google のサービスを、メモリ上の簡易な偽物に置き換える。
import fs from 'node:fs';
import vm from 'node:vm';

const CODE = fs.readFileSync(new URL('../gas/Code.gs', import.meta.url), 'utf8');

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.cells = [];
    this.maxRows = 1000;
    this.frozenRows = 0;
    this.validations = [];
    this.formats = new Map(); // "行,列" → 表示形式
  }
  // 本物のスプレッドシートと同じく、書式なしテキストでないセルに「4-4-2」を書くと日付になる。
  store(r, c, v) {
    while (this.cells.length < r) this.cells.push([]);
    const m = typeof v === 'string' && v.match(/^(\d{1,4})-(\d{1,2})-(\d{1,2})$/);
    if (m && this.formats.get(`${r},${c}`) !== '@') {
      const y = Number(m[1]);
      v = new Date(Date.UTC(y < 100 ? 2000 + y : y, Number(m[2]) - 1, Number(m[3])));
    }
    this.cells[r - 1][c - 1] = v;
  }
  getName() { return this.name; }
  getLastRow() { return this.cells.length; }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(_after, n) { this.maxRows += n; }
  setFrozenRows(n) { this.frozenRows = n; }
  width() { return Math.max(0, ...this.cells.map((r) => r.length)); }
  getDataRange() {
    const w = this.width();
    const values = this.cells.length
      ? this.cells.map((r) => Array.from({ length: w }, (_, i) => r[i] ?? ''))
      : [['']];
    return { getValues: () => values.map((r) => [...r]) };
  }
  getRange(row, col, numRows = 1, numCols = 1) {
    const sheet = this;
    const range = {
      setValues(values) {
        values.forEach((r, i) => r.forEach((v, j) => sheet.store(row + i, col + j, v)));
        return range;
      },
      setValue(v) {
        sheet.store(row, col, v);
        return range;
      },
      setNumberFormat(format) {
        for (let i = 0; i < numRows; i++) {
          for (let j = 0; j < numCols; j++) sheet.formats.set(`${row + i},${col + j}`, format);
        }
        return range;
      },
      setFontWeight() { return range; },
      setDataValidation(rule) {
        sheet.validations.push({ row, col, numRows, numCols, rule });
        return range;
      },
    };
    return range;
  }
  appendRow(values) {
    const r = this.cells.length + 1;
    values.forEach((v, j) => this.store(r, j + 1, v));
  }
  deleteRow(row) { this.cells.splice(row - 1, 1); }
}

class FakeSpreadsheet {
  constructor() { this.sheets = [new FakeSheet('シート1')]; }
  getSheetByName(name) { return this.sheets.find((s) => s.name === name) ?? null; }
  insertSheet(name) {
    const s = new FakeSheet(name);
    this.sheets.push(s);
    return s;
  }
  getSheets() { return [...this.sheets]; }
  getSpreadsheetTimeZone() { return 'UTC'; }
  deleteSheet(sheet) { this.sheets = this.sheets.filter((s) => s !== sheet); }
}

// 入力規則のビルダー。呼ばれたメソッドを記録するだけ。
function validationBuilder() {
  const calls = [];
  const builder = new Proxy({}, {
    get: (_t, prop) => (prop === 'build'
      ? () => ({ calls })
      : (...args) => { calls.push([prop, ...args]); return builder; }),
  });
  return builder;
}

export function createGas() {
  const ss = new FakeSpreadsheet();
  const context = vm.createContext({
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      newDataValidation: validationBuilder,
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (content) => ({ content, setMimeType() { return this; } }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      // テストではタイムゾーンを UTC に固定する
      formatDate: (d, _tz, _fmt) => `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`,
    },
  });
  vm.runInContext(CODE, context, { filename: 'Code.gs' });

  const call = (fn, ...args) => context[fn](...args);
  return {
    ss,
    call,
    get: () => JSON.parse(call('doGet').content),
    post: (body) => JSON.parse(call('doPost', { postData: { contents: JSON.stringify(body) } }).content),
  };
}
