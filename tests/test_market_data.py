import datetime as dt
from pathlib import Path
import subprocess
import tempfile
import unittest

from scripts.bank_gold import TW, parse_quote, update_quote
from scripts.bank_rates import REQUIRED, accept, complete, parse_csv


NOW = dt.datetime(2026, 11, 19, 17, tzinfo=TW)
QUOTE = """
<span>2026/11/19</span><div>掛牌時間：<b>2026/11/19</b> 13:24</div>
<table title="新臺幣黃金牌價">
  <tr><th>品名／規格</th><th></th><th>單位：新臺幣元</th></tr>
  <tr><th></th><th></th><th>1 公克</th></tr>
  <tr><td>黃金存摺<td>本行賣出</td><td>3,980<form><button>買進</button></form></td></tr>
  <tr><td></td><td>本行買進</td><td>3,935</td></tr>
</table>
"""


class GoldTests(unittest.TestCase):
    def test_reference_table_with_missing_td_closure(self):
        self.assertEqual(parse_quote(QUOTE, NOW), (3935, NOW.replace(hour=13, minute=24)))

    def test_other_product_missing_date_and_challenge(self):
        for html in (QUOTE.replace("黃金存摺", "實體黃金"),
                     QUOTE.replace("掛牌時間", "查詢時間"),
                     "<html>請完成驗證<script>" + QUOTE + "</script></html>"):
            with self.subTest():
                with self.assertRaises(ValueError):
                    parse_quote(html, NOW)

    def test_column_order_verified_by_weight(self):
        moved = QUOTE.replace("<th>1 公克</th>", "<th>5 公克</th><th>1 公克</th>")
        moved = moved.replace("<td>3,980", "<td>19,500</td><td>3,980")
        moved = moved.replace("<td>3,935", "<td>19,360</td><td>3,935")
        self.assertEqual(parse_quote(moved, NOW)[0], 3935)
        with self.assertRaises(ValueError):
            parse_quote(QUOTE.replace("1 公克", "5 公克"), NOW)

    def test_reject_future_stale_and_bad_spread(self):
        for html in (QUOTE.replace("13:24", "23:55"),
                     QUOTE.replace("2026/11/19", "2026/11/01"),
                     QUOTE.replace("3,980", "4,900"),
                     QUOTE.replace("3,980", "3,900")):
            with self.subTest():
                with self.assertRaises(ValueError):
                    parse_quote(html, NOW)

    def test_older_quote_cannot_replace_official_price(self):
        data = {"p": {}}
        quote = parse_quote(QUOTE, NOW)
        self.assertTrue(update_quote(data, quote))
        self.assertFalse(update_quote(data, (4000, quote[1] - dt.timedelta(minutes=1))))
        self.assertFalse(update_quote(data, (4000, quote[1])))
        self.assertEqual(data["p"]["GOLD"][1:],
                         [3935, "TWD", "2026-11-19", "2026-11-19T13:24+08:00"])


class RatesTests(unittest.TestCase):
    def setUp(self):
        self.values = {cur: (32 if cur == "USD" else 1) for cur in REQUIRED}
        self.csv = "\ufeff幣別,匯率,現金,即期\n" + "\n".join(
            f'{cur},本行買入,{rate},999' for cur, rate in self.values.items()
        ) + "\nSEK,本行買入,0,99\nUSD,本行賣出,999,999\n"

    def test_cash_buy_and_missing_optional_currencies(self):
        self.assertEqual(parse_csv(self.csv), self.values)
        self.assertTrue(complete(self.values))

    def test_incomplete_duplicate_nonfinite_and_wrong_header(self):
        for candidate in ({"USD": 32}, {**self.values, "GBP": float("nan")},
                          parse_csv(self.csv + "USD,本行買入,32,33"),
                          parse_csv(self.csv.replace("幣別,匯率,現金", "幣別,匯率,即期"))):
            with self.subTest():
                self.assertFalse(complete(candidate))
                self.assertEqual(accept(self.values, candidate), self.values)


class GitPublishingTests(unittest.TestCase):
    def publish(self, conflict):
        script = Path("scripts/push_generated.sh").resolve()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)

            def git(cwd, *args):
                return subprocess.run(["git", *args], cwd=cwd, check=True,
                                      capture_output=True, text=True)

            git(root, "init", "--bare", "--initial-branch=main", "remote.git")
            git(root, "clone", "remote.git", "first")
            first = root / "first"
            generated = "prices.json"
            (first / generated).write_text('{"d":"initial"}')
            git(first, "add", generated)
            git(first, "-c", "user.name=Test", "-c", "user.email=test@example.test",
                "commit", "-m", "初始")
            git(first, "push", "-u", "origin", "main")
            git(root, "clone", "remote.git", "second")
            second = root / "second"
            other = generated if conflict else "rates.json"
            (second / other).write_text('{"d":"remote"}')
            git(second, "add", other)
            git(second, "-c", "user.name=Test", "-c", "user.email=test@example.test",
                "commit", "-m", "遠端更新")
            git(second, "push")
            (first / generated).write_text('{"d":"local"}')
            result = subprocess.run(["bash", str(script), generated, "測試更新"], cwd=first,
                                    capture_output=True, text=True)
            branch_file = git(root / "remote.git", "show", f"main:{generated}").stdout
            if conflict:
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("保留遠端資料", result.stdout)
                self.assertEqual(branch_file, '{"d":"remote"}')
            else:
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(branch_file, '{"d":"local"}')
                self.assertEqual(git(root / "remote.git", "show", f"main:{other}").stdout,
                                 '{"d":"remote"}')

    def test_non_fast_forward_disjoint_files_retries(self):
        self.publish(conflict=False)

    def test_same_file_conflict_leaves_remote_intact(self):
        self.publish(conflict=True)


if __name__ == "__main__":
    unittest.main()
