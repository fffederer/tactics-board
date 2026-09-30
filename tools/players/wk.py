"""ウィキペディア API の小さなヘルパー (日本語版・英語版)。取得した記事はキャッシュする。"""
import json, urllib.request, urllib.parse, urllib.error, time, os, sys, hashlib

UA = {"User-Agent": "tactics-board-seed/0.2 (personal, non-commercial squad list builder)"}
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wiki")
os.makedirs(CACHE, exist_ok=True)


def api(lang="ja", **params):
    params.setdefault("format", "json")
    params.setdefault("maxlag", "5")
    url = f"https://{lang}.wikipedia.org/w/api.php?" + urllib.parse.urlencode(params)
    for attempt in range(8):
        try:
            time.sleep(1.2)
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code not in (429, 503):
                raise
            wait = int(e.headers.get("Retry-After") or 0) or 10 * (attempt + 1)
            print(f"  (429: {wait}秒待機)", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError("too many retries")


def raw(title, lang="ja"):
    """記事の wikitext (リダイレクトは解決)。"""
    key = hashlib.md5(title.encode()).hexdigest() if lang == "ja" else lang + "_" + hashlib.md5(title.encode()).hexdigest()
    fn = os.path.join(CACHE, key + ".txt")
    if os.path.exists(fn):
        return open(fn, encoding="utf-8").read()
    d = api(lang, action="query", prop="revisions", rvprop="content", rvslots="main", titles=title, redirects=1)
    page = next(iter(d["query"]["pages"].values()))
    text = page["revisions"][0]["slots"]["main"]["*"] if "revisions" in page else ""
    open(fn, "w", encoding="utf-8").write(text)
    return text


def langlinks(titles, src, dst):
    """src 版の記事名 → dst 版の記事名 (リダイレクト解決込み)。対応がなければ含まない。"""
    out = {}
    titles = list(dict.fromkeys(titles))
    for k in range(0, len(titles), 50):
        chunk = titles[k:k + 50]
        d = api(src, action="query", prop="langlinks", lllang=dst, lllimit="max", titles="|".join(chunk), redirects=1)
        q = d["query"]
        norm = {x["from"]: x["to"] for x in q.get("normalized", [])}
        red = {x["from"]: x["to"] for x in q.get("redirects", [])}
        by_title = {}
        for p in q["pages"].values():
            ll = p.get("langlinks")
            if ll:
                by_title[p["title"]] = ll[0]["*"]
        for t in chunk:
            n = norm.get(t, t)
            n = red.get(n, n)
            if n in by_title:
                out[t] = by_title[n]
    return out


def search(q, n=8, lang="ja"):
    return [x["title"] for x in api(lang, action="query", list="search", srsearch=q, srlimit=n)["query"]["search"]]
