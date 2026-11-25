"""取得臺灣銀行 1 公克黃金存摺的本行買進價。"""
import datetime as dt
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.request import Request, urlopen

TW = dt.timezone(dt.timedelta(hours=8))
URL = "https://rate.bot.com.tw/gold?Lang=zh-TW"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"
TABLE = "新臺幣黃金牌價"


class QuoteHTML(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tables = []
        self.rows = None
        self.row = None
        self.cell = None
        self.page_text = []
        self.ignored = None

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "form"} and self.ignored is None:
            self.ignored = tag
        if self.ignored:
            return
        if tag == "table":
            self.rows = [] if dict(attrs).get("title") == TABLE else None
        elif self.rows is not None and tag == "tr":
            self.row = []
        elif self.row is not None and tag in {"td", "th"}:
            self.finish_cell()
            self.cell = []

    def handle_data(self, data):
        if not self.ignored:
            self.page_text.append(data)
            if self.cell is not None:
                self.cell.append(data)

    def finish_cell(self):
        if self.cell is not None:
            self.row.append(" ".join("".join(self.cell).split()))
            self.cell = None

    def handle_endtag(self, tag):
        if self.ignored:
            if tag == self.ignored:
                self.ignored = None
            return
        if tag in {"td", "th"}:
            self.finish_cell()
        elif tag == "tr" and self.row is not None:
            self.finish_cell()
            self.rows.append(self.row)
            self.row = None
        elif tag == "table" and self.rows is not None:
            self.tables.append(self.rows)
            self.rows = None


def parse_quote(html, now):
    parser = QuoteHTML()
    parser.feed(html)
    stamps = set(re.findall(r"掛牌時間\s*[：:]\s*(\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2})",
                            " ".join(parser.page_text)))
    if len(stamps) != 1:
        raise ValueError("缺少唯一掛牌時間")
    stamp = dt.datetime.strptime(stamps.pop(), "%Y/%m/%d %H:%M").replace(tzinfo=TW)
    if not now - dt.timedelta(days=7) <= stamp <= now + dt.timedelta(minutes=5):
        raise ValueError("掛牌時間超出範圍")
    candidates = []
    for rows in parser.tables:
        if not any("黃金存摺" in row for row in rows):
            continue
        grams = [i for row in rows for i, cell in enumerate(row) if re.fullmatch(r"1\s*公克", cell)]
        if len(grams) != 1 or not any("新臺幣元" in c for row in rows for c in row):
            continue
        index = grams[0]
        values = {}
        product = ""
        for row in rows:
            if len(row) <= index:
                continue
            labels = {"本行買進", "本行賣出"}.intersection(row)
            if not labels:
                continue
            label = next(iter(labels))
            names = [cell for cell in row[:row.index(label)] if cell]
            if names:
                product = "黃金存摺" if names == ["黃金存摺"] else ""
            if product != "黃金存摺":
                continue
            if len(labels) != 1 or labels.intersection(values):
                raise ValueError("買賣欄位重複")
            amount = row[index]
            if not re.fullmatch(r"(?:\d+|\d{1,3}(?:,\d{3})+)", amount):
                raise ValueError("黃金價格不是整數")
            values[label] = int(amount.replace(",", ""))
        if values.keys() == {"本行買進", "本行賣出"}:
            buy, sell = values["本行買進"], values["本行賣出"]
            if 1000 < buy < sell < min(30000, buy * 1.05):
                candidates.append(buy)
    if len(candidates) != 1:
        raise ValueError("未找到唯一有效的黃金存摺買進價")
    return candidates[0], stamp


def fetch_quote(now):
    try:
        req = Request(URL, headers={"User-Agent": UA, "Accept-Language": "zh-TW"})
        with urlopen(req, timeout=15) as response:
            return parse_quote(response.read().decode("utf-8-sig"), now)
    except Exception as error:
        print("臺銀 HTTP 未取得有效牌價：", type(error).__name__)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome", headless=True, timeout=15000)
        try:
            page = browser.new_page(locale="zh-TW", user_agent=UA)
            page.goto(URL, wait_until="domcontentloaded", timeout=20000)
            table = page.locator(f'table[title="{TABLE}"]').filter(
                has=page.get_by_text("黃金存摺", exact=True)
            ).filter(has=page.get_by_text(re.compile(r"^1\s*公克$"))).filter(
                has=page.get_by_text("本行買進", exact=True)
            )
            table.first.wait_for(state="visible", timeout=25000)
            return parse_quote(page.content(), dt.datetime.now(TW))
        finally:
            browser.close()


def update_quote(data, quote):
    buy, stamp = quote
    day = stamp.date().isoformat()
    timestamp = stamp.isoformat(timespec="minutes")
    prices = data.setdefault("p", {})
    old = prices.get("GOLD", [])
    if len(old) > 3 and "臺銀" in old[0]:
        # 舊版只存日期，當天第一筆有來源時間的報價可以補上。
        if day < old[3] or (len(old) > 4 and timestamp <= old[4]):
            return False
    prices["GOLD"] = ["黃金（臺銀每公克）", buy, "TWD", day, timestamp]
    return True


def main():
    path = Path("prices.json")
    data = json.loads(path.read_text(encoding="utf-8"))
    try:
        quote = fetch_quote(dt.datetime.now(TW))
    except Exception as error:
        print("臺銀金價暫無有效更新，保留既有牌價：", type(error).__name__)
        return
    if update_quote(data, quote):
        temp = path.with_suffix(".tmp")
        temp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        temp.replace(path)
        print("已更新臺銀黃金存摺掛牌時間", quote[1].isoformat())


if __name__ == "__main__":
    main()
