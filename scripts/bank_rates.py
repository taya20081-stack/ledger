"""臺銀現金買入匯率驗證。"""
import csv
import io
import math

# 臺銀有牌告 ZAR、SEK，但該兩欄可能沒有現金匯率。
REQUIRED = frozenset("USD HKD GBP AUD CAD SGD CHF JPY NZD THB PHP IDR EUR KRW VND MYR CNY".split())
CURRENCIES = REQUIRED | {"ZAR", "SEK"}


def valid_rate(value):
    return type(value) in (int, float) and math.isfinite(value) and 0 < value < 100


def complete(rates):
    return REQUIRED <= rates.keys() and all(valid_rate(v) for v in rates.values()) and 20 < rates["USD"] < 50


def parse_csv(text):
    rows = csv.reader(io.StringIO(text.lstrip("\ufeff")))
    header = [c.strip() for c in next(rows, [])]
    if header[:4] != ["幣別", "匯率", "現金", "即期"]:
        return {}
    rates = {}
    seen = set()
    for row in rows:
        if len(row) < 3:
            continue
        cur, direction, raw = (v.strip() for v in row[:3])
        if cur not in CURRENCIES or direction != "本行買入":
            continue
        if cur in seen:
            return {}
        seen.add(cur)
        try:
            value = float(raw)
        except ValueError:
            continue
        if valid_rate(value):
            rates[cur] = value
    return rates


def accept(existing, candidate):
    """接受完整來源，保留候選資料中未提供的舊有幣別。"""
    return {**existing, **candidate} if complete(candidate) else existing
