import sys, re, json
sys.path.insert(0, sys.argv[1])
from wk import *

LEAGUES = [
    ("プレミアリーグ", "プレミアリーグ", 20),
    ("ラ・リーガ", "プリメーラ・ディビシオン", 20),
    ("セリエA", "セリエA (サッカー)", 20),
    ("ブンデスリーガ", "サッカー・ブンデスリーガ (ドイツ)", 18),
    ("リーグ・アン", "リーグ・アン", 18),
]
LINK = re.compile(r"\[\[([^\]|#]+)(?:\|([^\]]*))?\]\]")
NL = chr(10)
FILE = re.compile(r"^(ファイル|File|Image|画像):")


def section(txt, head="== 所属クラブ =="):
    i = txt.index(head)
    j = txt.find("\n== ", i + len(head))
    return txt[i: j if j > 0 else None]


def resolve(titles):
    """リダイレクトを解決して正式な記事名にする。"""
    out = {}
    for k in range(0, len(titles), 40):
        d = api(action="query", titles="|".join(titles[k:k + 40]), redirects=1)
        norm = {x["from"]: x["to"] for x in d["query"].get("normalized", [])}
        red = {x["from"]: x["to"] for x in d["query"].get("redirects", [])}
        for t in titles[k:k + 40]:
            n = norm.get(t, t)
            out[t] = red.get(n, n)
    return out


result = {}
for league, article, expected in LEAGUES:
    sec = section(raw(article))
    t0 = sec.index("{|")
    t1 = sec.index("|}", t0)
    rows = sec[t0:t1].split("\n|-")[1:]
    # 各行の先頭2セルを取り出し、テンプレートを展開してから、最初に記事リンクがあるセルをクラブとする
    per_row = []
    for r in rows:
        lines = [ln for ln in r.strip(NL).split(NL) if ln.startswith("|")][:2]
        per_row.append([ln.lstrip("|") for ln in lines])
    flat = [c for cells in per_row for c in cells]
    sep = NL + "@@@" + NL
    expanded = api(action="expandtemplates", text=sep.join(flat), prop="wikitext")["expandtemplates"]["wikitext"].split(sep)
    clubs, k = [], 0
    for cells in per_row:
        found = None
        for cell in expanded[k:k + len(cells)]:
            for lk in LINK.finditer(cell):
                target = lk.group(1).strip()
                if not FILE.match(target):
                    found = target
                    break
            if found:
                break
        k += len(cells)
        if found:
            clubs.append(found)
    canon = resolve(clubs)
    # 地図ラベル (記事名 → 通称)
    labels = {}
    for lk in LINK.finditer(sec[:t0]):
        if not FILE.match(lk.group(1)):
            labels[lk.group(1).strip()] = re.sub(r"'''|<[^>]+>", "", lk.group(2) or lk.group(1)).strip()
    lab_canon = resolve(list(labels))
    labels = {lab_canon[k]: v for k, v in labels.items()}
    result[league] = [{"article": canon[c], "label": labels.get(canon[c])} for c in clubs]
    print(f"== {league}: {len(clubs)} (期待 {expected})")
    for c in result[league]:
        print("   ", c["article"], "|", c["label"])

json.dump(result, open(sys.argv[1] + "/clubs.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
