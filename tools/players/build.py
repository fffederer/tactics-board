"""選手DB (2026-27) を作る。

- 在籍選手・背番号・ポジション: 英語版ウィキペディアのクラブ記事の現所属メンバー (更新が速い)
- カタカナの選手名: 英語版の選手記事から日本語版記事へのリンク。日本語版クラブ記事の表示名があればそれを優先
- 英語版にメンバー表がないクラブは、日本語版のメンバー表を使う
"""
import sys, re, json, csv, collections
sys.path.insert(0, sys.argv[1])
from wk import raw, langlinks, api
from romaji import same_person_strict as same_person
import os

WORK, OUT = sys.argv[1], sys.argv[2]
NL = chr(10)
clubs = json.load(open(WORK + "/clubs.json", encoding="utf-8"))

TEAM_OVERRIDE = {
    "マンチェスター・シティFC": "マンチェスター・シティ",
    "マンチェスター・ユナイテッドFC": "マンチェスター・ユナイテッド",
    "ノッティンガム・フォレストFC": "ノッティンガム・フォレスト",
    "パリ・サンジェルマンFC": "パリ・サンジェルマン",
    "RCランス": "ランス",
    "ル・マンFC": "ル・マン",
}

LINK = re.compile(r"\[\[([^\]|#]+)(?:\|([^\]]*))?\]\]")
BLOCK_START = re.compile(r"\{\{\s*(サッカークラブチーム選手一覧 開始|Fs start|Football squad start)[^}]*\}\}", re.I)
BLOCK_END = re.compile(r"\{\{\s*(サッカークラブチーム選手一覧 終了|Fs end|Football squad end)[^}]*\}\}", re.I)
PLAYER_START = re.compile(r"\{\{\s*(サッカークラブチーム選手一覧 選手|Fs player|Football squad player)\s*\|", re.I)
JA_HEAD = re.compile(r"^(==+)\s*(現所属メンバー|現在の所属メンバー|現所属選手|所属選手|現在の所属選手|トップチーム|現行メンバー|選手一覧|現メンバー)[^=\n]*==+\s*$", re.M)
EN_HEAD = re.compile(r"^(==+)\s*(Players|Current squad|First[- ]team squad|First team|Squad|Current players|Team)\s*==+\s*$", re.M | re.I)
IMG_LABEL = re.compile(r"text\s*=\s*\[\[([^\]|]+)\|.*?'''(.+?)'''", re.S)
ASOF = re.compile(r"(\d{4})年(\d{1,2})月(\d{1,2})日現在")


def template_bodies(text, start_re):
    """start_re で始まるテンプレートの中身 ({{ と }} の対応を取って) を順に返す。"""
    for m in start_re.finditer(text):
        depth, i = 1, m.end()
        while i < len(text):
            if text.startswith("{{", i):
                depth += 1; i += 2; continue
            if text.startswith("}}", i):
                depth -= 1
                if depth == 0:
                    yield text[m.end():i]
                    break
                i += 2; continue
            i += 1


def split_params(body):
    out, depth, cur, i = [], 0, "", 0
    while i < len(body):
        two = body[i:i + 2]
        if two in ("[[", "{{"):
            depth += 1; cur += two; i += 2; continue
        if two in ("]]", "}}"):
            depth -= 1; cur += two; i += 2; continue
        if body[i] == "|" and depth == 0:
            out.append(cur); cur = ""; i += 1; continue
        cur += body[i]; i += 1
    out.append(cur)
    params = {}
    for p in out:
        if "=" in p:
            k, v = p.split("=", 1)
            params[k.strip().lower() if k.strip().isascii() else k.strip()] = v.strip()
    return params


def strip_paren(s):
    return re.sub(r"\s*[\(（][^\)）]*[\)）]\s*$", "", s).strip()


def parse_link(v):
    """(表示名, 記事名)。リンクがなければ記事名は None。"""
    m = LINK.search(v)
    if m:
        target = m.group(1).strip()
        display = re.sub(r"'''?|<[^>]+>", "", m.group(2) or "").strip()
        return strip_paren(display or target), target
    text = re.sub(r"\{\{[^}]*\}\}|<[^>]+>|'''?", "", v).strip()
    return strip_paren(text), None


def first_block(text, head_re):
    """見出しの直後から最初のメンバー表を探す。"""
    for h in head_re.finditer(text):
        s = BLOCK_START.search(text, h.end())
        if not s:
            continue
        nxt = re.compile(r"^={1,%d}[^=]" % len(h.group(1)), re.M).search(text, h.end())
        if nxt and nxt.start() < s.start():
            continue  # この見出しの節には表がない
        e = BLOCK_END.search(text, s.end())
        return text[h.end():s.start()], text[s.end(): e.start() if e else None]
    return None, None


def read_squad(text, head_re):
    before, block = first_block(text, head_re)
    if block is None:
        return None, None, {}
    players = []
    for body in template_bodies(block, PLAYER_START):
        p = split_params(body)
        no = p.get("no", p.get("背番号", "")).strip()
        pos = p.get("pos", p.get("ポジション", "")).strip().upper()[:2]
        nat = p.get("nat", p.get("国籍", "")).strip().upper()
        display, target = parse_link(p.get("name", p.get("名前", "")))
        players.append({"no": no, "pos": pos, "nat": nat, "display": display, "target": target})
    asof = ASOF.search(before)
    labels = {t.strip(): re.sub(r"<[^>]+>", "", s).strip() for t, s in IMG_LABEL.findall(before)}
    return players, (asof.groups() if asof else None), labels


# ---- 略称 ----
PARTICLES = {"ファン", "ヴァン", "フォン", "デ", "デル", "ダ", "ディ", "ドス", "ダス", "テル", "テン", "ル", "ラ", "エル", "アル", "ベン", "マック", "マク"}
SUFFIX = {"ジュニオール", "ジュニオル", "ジュニア", "フィーリョ", "ネト", "ソブリーニョ"}
SURNAME_FIRST = {"HUN", "CHN", "PRK", "VIE"}
KATAKANA = re.compile(r"[゠-ヿ一-鿿]")


def tokens_ja(name):
    return [t for t in re.split(r"[・･]", name) if t]


def short_name(ja_name, nat, en_title, en_display):
    """略称と、要確認の理由 (なければ None)。"""
    toks = tokens_ja(ja_name)
    if not KATAKANA.search(ja_name):  # カタカナ名がない (英語表記のまま)
        parts = ja_name.split()
        return (parts[-1] if parts else ja_name), None
    if len(toks) <= 1:
        if nat == "JPN" and re.fullmatch(r"[一-鿿々]{3,5}", ja_name):
            return ja_name[:2], "日本人の姓を先頭2文字と推定"
        return ja_name, None
    if nat == "KOR":
        return ja_name, None
    if nat in SURNAME_FIRST:
        return toks[0], None
    # 通称: 英語版の表示名が記事名の1語だけ (例: Alisson Becker → Alisson) なら、その位置のカタカナを使う
    if en_title and en_display:
        et = strip_paren(en_title).split()
        ed = en_display.split()
        if len(ed) == 1 and len(et) == len(toks) and ed[0] in et and et.index(ed[0]) != len(et) - 1:
            return toks[et.index(ed[0])], None
    i = len(toks) - 1
    if toks[i] in SUFFIX and i >= 1:
        return toks[i - 1], None
    while i - 1 >= 1 and toks[i - 1] in PARTICLES:
        i -= 1
    return "・".join(toks[i:]), None


def wikidata_ja_labels(en_titles):
    """英語版の記事名 → Wikidata の日本語ラベル (カタカナを含むものだけ)。"""
    en_titles = list(dict.fromkeys(en_titles))
    title_to_q = {}
    for k in range(0, len(en_titles), 50):
        chunk = en_titles[k:k + 50]
        d = api("en", action="query", prop="pageprops", ppprop="wikibase_item", titles="|".join(chunk), redirects=1)
        q = d["query"]
        norm = {x["from"]: x["to"] for x in q.get("normalized", [])}
        red = {x["from"]: x["to"] for x in q.get("redirects", [])}
        by_title = {p["title"]: p.get("pageprops", {}).get("wikibase_item") for p in q["pages"].values()}
        for t in chunk:
            n = red.get(norm.get(t, t), norm.get(t, t))
            if by_title.get(n):
                title_to_q[t] = by_title[n]
    ids = list(dict.fromkeys(title_to_q.values()))
    labels = {}
    for k in range(0, len(ids), 50):
        d = api_wikidata(ids[k:k + 50])
        for qid, ent in d.get("entities", {}).items():
            lab = ent.get("labels", {}).get("ja", {}).get("value")
            if lab and re.search(r"[゠-ヿ]", lab):
                labels[qid] = lab
    return {t: labels[q] for t, q in title_to_q.items() if q in labels}


def api_wikidata(ids):
    import urllib.request, urllib.parse, json, time
    from wk import UA
    url = "https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode(
        {"action": "wbgetentities", "ids": "|".join(ids), "props": "labels", "languages": "ja", "format": "json"})
    for attempt in range(8):
        try:
            time.sleep(1.2)
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                return json.load(r)
        except Exception as e:
            print("  (wikidata 再試行)", e, file=sys.stderr)
            time.sleep(10 * (attempt + 1))
    return {}


# カタカナの最初の音と、英語表記の頭文字が矛盾しないか (同じ背番号の別人を取り違えないための確認)
KANA_LETTERS = [
    ("アイウエオ", "AEIOUHYJW"), ("カキクケコ", "CKQXG"), ("ガギグゲゴ", "GJ"), ("サスセソ", "SCZXT"), ("シ", "SCX"),
    ("ザズゼゾ", "ZSX"), ("ジ", "JGYZH"), ("タテト", "TD"), ("チ", "CTZ"), ("ツ", "TZ"), ("ダデド", "DT"),
    ("ナニヌネノ", "NK"), ("ハヒヘホ", "HJG"), ("フ", "FHJP"), ("バビブベボ", "BVW"), ("ヴ", "VWB"),
    ("パピプペポ", "PB"), ("マミムメモ", "M"), ("ヤユヨ", "YJI"), ("ラリルレロ", "RL"), ("ワ", "WVUO"),
]
import unicodedata


def plausible(ja, en):
    ja, en = ja.strip(), unicodedata.normalize("NFKD", en.strip())
    if not ja or not en:
        return False
    for chars, letters in KANA_LETTERS:
        if ja[0] in chars:
            return en[0].upper() in letters
    return False


MANUAL_FILE = os.path.join(WORK, "manual_kana.json")
MANUAL = json.load(open(MANUAL_FILE, encoding="utf-8")) if os.path.exists(MANUAL_FILE) else {}


def main():
    ja_to_en_club = langlinks([c["article"] for items in clubs.values() for c in items], "ja", "en")
    teams = []
    for league, items in clubs.items():
        for c in items:
            team = TEAM_OVERRIDE.get(c["article"]) or c["label"] or strip_paren(c["article"])
            en_article = ja_to_en_club.get(c["article"])
            en_players = read_squad(raw(en_article, "en"), EN_HEAD)[0] if en_article else None
            ja_players, ja_asof, ja_labels = read_squad(raw(c["article"]), JA_HEAD)
            teams.append({"league": league, "team": team, "ja_article": c["article"], "en_article": en_article,
                          "en": en_players, "ja": ja_players, "ja_asof": ja_asof, "ja_labels": ja_labels})

    # 英語版の選手記事 → 日本語版の記事名
    en_titles = [p["target"] for t in teams for p in (t["en"] or []) if p["target"]]
    en_to_ja = langlinks(en_titles, "en", "ja")
    wd_labels = wikidata_ja_labels([x for x in en_titles if x not in en_to_ja])

    rows, report = [], collections.defaultdict(list)
    for t in teams:
        # 日本語版クラブ記事の表示名 (記事名 → 表示名)
        ja_display = {p["target"]: p["display"] for p in (t["ja"] or []) if p["target"]}
        entries, source = [], None
        if t["en"] and len(t["en"]) >= 15:
            source = "英語版"
            for p in t["en"]:
                ja_title = en_to_ja.get(p["target"]) if p["target"] else None
                if ja_title:
                    name = ja_display.get(ja_title) or strip_paren(ja_title)
                elif p["target"] in wd_labels and same_person(wd_labels[p["target"]], p["display"]):
                    name = strip_paren(wd_labels[p["target"]])
                    report["カタカナ名をWikidataから補った"].append(f"{t['team']}: {p['display']} → {name}")
                else:
                    match = [q for q in (t["ja"] or []) if q["no"] and q["no"] == p["no"] and q["pos"] == p["pos"]
                             and same_person(q["display"], p["display"])]
                    if match:
                        name = match[0]["display"]
                        report["カタカナ名を日本語版メンバー表の同じ背番号から補った"].append(f"{t['team']}: {p['display']} → {name}")
                    elif p["display"] in MANUAL:
                        name = MANUAL[p["display"]]
                        report["カタカナ名を推定で補った (要確認)"].append(f"{t['team']}: {p['display']} → {name}")
                    else:
                        name = p["display"]
                        report["カタカナ名が見つからず英語表記のまま"].append(f"{t['team']}|{p['nat']}|{name}")
                label = t["ja_labels"].get(ja_title or "", None)
                entries.append({**p, "name": name, "label": label, "en_title": p["target"], "en_display": p["display"]})
        elif t["ja"]:
            source = "日本語版"
            asof = t["ja_asof"]
            report["英語版にメンバー表がなく日本語版を使用"].append(
                f"{t['team']} ({'%s年%s月%s日現在' % asof if asof else '更新日の記載なし'})")
            for p in t["ja"]:
                entries.append({**p, "name": p["display"], "label": t["ja_labels"].get(p["target"] or ""), "en_title": None, "en_display": None})
        else:
            report["メンバー表を読めなかったクラブ"].append(f"{t['league']} / {t['team']}")
            continue

        kept = []
        for e in entries:
            if e["pos"] not in ("GK", "DF", "MF", "FW"):
                report["ポジション不明で除外"].append(f"{t['team']}: {e['name']} ({e['pos']})")
                continue
            short, note = short_name(e["name"], e["nat"], e["en_title"], e["en_display"])
            if e["label"]:
                short, note = e["label"], None
            if note:
                report[note].append(f"{t['team']}: {e['name']} → {short}")
            e["short"] = short
            kept.append(e)

        # 同じチームで略称がかぶる選手は、名前の頭文字を付ける (頭文字は英語表記から)
        counts = collections.Counter(e["short"] for e in kept)
        for e in kept:
            if counts[e["short"]] > 1:
                given = (e["en_display"] or e["en_title"] or "").split()
                if given and len(tokens_ja(e["name"])) > 1:
                    new = f"{given[0][0].upper()}・{e['short']}"
                    report["略称がかぶる選手に頭文字を付けた"].append(f"{t['team']}: {e['name']} → {new}")
                    e["short"] = new
        # 頭文字を付けてもかぶる場合は、選手名をそのまま使う
        counts = collections.Counter(e["short"] for e in kept)
        for e in kept:
            if counts[e["short"]] > 1:
                report["頭文字でもかぶるため選手名を略称にした"].append(f"{t['team']}: {e['name']}")
                e["short"] = e["name"]

        if not 20 <= len(kept) <= 40:
            report["人数が20〜40人の範囲外"].append(f"{t['team']}: {len(kept)}人 ({source})")
        for e in kept:
            rows.append([t["league"], t["team"], e["pos"], e["no"] if e["no"].isdigit() else "", e["name"], e["short"]])

    with open(OUT + "/players-2026-27.csv", "w", encoding="utf-8", newline="") as f:
        csv.writer(f).writerows(rows)
    json.dump(report, open(WORK + "/report.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("選手数:", len(rows), " チーム数:", len({(r[0], r[1]) for r in rows}))
    for k, v in report.items():
        print(f"## {k}: {len(v)}")


main()
