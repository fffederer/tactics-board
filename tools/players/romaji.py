"""カタカナを大まかなローマ字にし、英語表記との近さを測る (同一人物かどうかの確認用)。"""
import re, unicodedata, difflib

DIGRAPHS = {
    "キャ": "kya", "キュ": "kyu", "キョ": "kyo", "シャ": "sha", "シュ": "shu", "ショ": "sho", "シェ": "she",
    "チャ": "cha", "チュ": "chu", "チョ": "cho", "チェ": "che", "ニャ": "nya", "ニュ": "nyu", "ニョ": "nyo",
    "ヒャ": "hya", "ヒュ": "hyu", "ヒョ": "hyo", "ミャ": "mya", "ミュ": "myu", "ミョ": "myo", "リャ": "rya",
    "リュ": "ryu", "リョ": "ryo", "ギャ": "gya", "ギュ": "gyu", "ギョ": "gyo", "ジャ": "ja", "ジュ": "ju",
    "ジョ": "jo", "ジェ": "je", "ビャ": "bya", "ビュ": "byu", "ビョ": "byo", "ピャ": "pya", "ピュ": "pyu",
    "ファ": "fa", "フィ": "fi", "フェ": "fe", "フォ": "fo", "フュ": "fyu", "ティ": "ti", "ディ": "di",
    "トゥ": "tu", "ドゥ": "du", "ウィ": "wi", "ウェ": "we", "ウォ": "wo", "ヴァ": "va", "ヴィ": "vi",
    "ヴェ": "ve", "ヴォ": "vo", "ツァ": "tsa", "ツィ": "tsi", "ツェ": "tse", "ツォ": "tso", "イェ": "ye",
    "クァ": "kwa", "クィ": "kwi", "クェ": "kwe", "クォ": "kwo", "グァ": "gwa", "デュ": "dyu", "テュ": "tyu",
}
MONO = dict(zip(
    "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポヴァィゥェォャュョ",
    ["a", "i", "u", "e", "o", "ka", "ki", "ku", "ke", "ko", "sa", "shi", "su", "se", "so", "ta", "chi", "tsu", "te", "to",
     "na", "ni", "nu", "ne", "no", "ha", "hi", "fu", "he", "ho", "ma", "mi", "mu", "me", "mo", "ya", "yu", "yo",
     "ra", "ri", "ru", "re", "ro", "wa", "o", "n", "ga", "gi", "gu", "ge", "go", "za", "ji", "zu", "ze", "zo",
     "da", "ji", "zu", "de", "do", "ba", "bi", "bu", "be", "bo", "pa", "pi", "pu", "pe", "po", "vu",
     "a", "i", "u", "e", "o", "ya", "yu", "yo"]))


def kana_to_romaji(s):
    out, i = "", 0
    while i < len(s):
        two = s[i:i + 2]
        if two in DIGRAPHS:
            out += DIGRAPHS[two]; i += 2; continue
        ch = s[i]
        if ch == "ッ":
            i += 1; continue
        if ch == "ー":
            i += 1; continue
        out += MONO.get(ch, ""); i += 1
    return out


def ascii_letters(s):
    s = unicodedata.normalize("NFKD", s)
    return re.sub(r"[^a-z]", "", s.encode("ascii", "ignore").decode().lower())


def squash(s):
    """母音の違いや l/r、v/b などを吸収するため子音寄りに正規化する。"""
    s = s.replace("l", "r").replace("v", "b").replace("w", "u").replace("c", "k").replace("q", "k")
    s = s.replace("ph", "f").replace("th", "t").replace("sh", "s").replace("ch", "k").replace("j", "g").replace("y", "i")
    s = re.sub(r"(.)\1+", r"\1", s)
    return s


def similarity(kana, latin):
    a, b = squash(kana_to_romaji(kana)), squash(ascii_letters(latin))
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def same_person(ja_name, en_name, threshold=0.55):
    """英語表記の姓 (最後の語) が、カタカナ名のどれかの語と十分に近いか。"""
    en_tokens = [t for t in re.split(r"[\s\-]+", en_name) if t]
    ja_tokens = [t for t in re.split(r"[・･＝=\s]", ja_name) if t]
    if not en_tokens or not ja_tokens:
        return False
    target = en_tokens[-1]
    return max(similarity(j, target) for j in ja_tokens) >= threshold or \
        (len(en_tokens) == 1 and max(similarity(j, en_tokens[0]) for j in ja_tokens) >= threshold)


if __name__ == "__main__":
    for ja, en in [("ルカス・ホルニチェク", "Lukáš Horníček"), ("イニゴ・レクエ", "Hugo Rincón"), ("ウナイ・ゴメス", "Alejandro Rego"),
                   ("ベニャト・プラードス", "Beñat Gerenabarrena"), ("ウィルソン・イシドル", "Wilson Isidor"),
                   ("プロミス・アキンペル", "Promise David"), ("クルックス", "Matt Crooks"), ("コスチーニャ", "Costinha"),
                   ("イェンス・ヒェルト＝ダール", "Jens Hjertø-Dahl"), ("ジョン・ビクター・マシエル・フルタド", "John Victor"),
                   ("シュテファン・ベンダ", "Steven Benda"), ("アレクサンダル・スタンコヴィッチ", "Aleksandar Stanković"),
                   ("ヘルマン・パレーニョ", "Germán Parreño"), ("ロベルト・フェルナンデス・ハエン", "Roberto Fernández")]:
        print(same_person(ja, en), ja, en)


def same_person_strict(ja_name, en_name):
    """姓に加え、名 (最初の語) も近いことを求める。どちらかが1語なら姓だけで判定。"""
    en_tokens = [t for t in re.split(r"[\s\-]+", en_name) if t]
    ja_tokens = [t for t in re.split(r"[・･＝=\s]", ja_name) if t]
    if not same_person(ja_name, en_name, 0.6):
        return False
    if len(en_tokens) >= 2 and len(ja_tokens) >= 2:
        return max(similarity(j, en_tokens[0]) for j in ja_tokens) >= 0.5
    return True
