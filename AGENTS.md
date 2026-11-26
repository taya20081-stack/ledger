# 存摺記帳開發指引

專案架構、開發指令和版本規範見 [CLAUDE.md](CLAUDE.md)。

## 工作守則（每次都要遵守）

使用者用手機和你溝通，常常只傳一張**截圖＋紅圈**，加上一句很短的話。你的目標是做出使用者**真正想要**的結果，不是盡量多做。

### 1. 先弄清楚要什麼，再動手
- 紅圈圈起來的地方，就是要改的地方。先描述你看到什麼、打算怎麼改。
- 只要有兩種以上的合理解讀，就先問使用者**一個選擇題**（2～3 個選項，每個選項附一句說明），等使用者回答再改。不要自己猜一個然後大改。
- 遇到尺寸、間距、顏色這類「看起來怎麼樣」的調整：先給一個具體數字（例如「字從 17px 放大到 19.5px，+15%」），附上**修改前後的截圖**讓使用者確認。不要同一件事反覆改來改去（例如列高 75% → 85%）。
- **只改使用者要求的東西。** 不要順手刪除功能、改版面、改文字或「順便優化」。看到別的問題就在回報裡**列出來**，不要自己動手改。
- 使用者沒有明確說要刪的功能、按鈕或資料，一律不准刪除或隱藏。

### 2. 版號：一個 PR 一個新版號，絕對不能重複
- 開始改之前先確認 main 目前的版號：
  ```bash
  git fetch origin main && git show origin/main:index.html | grep -o "APP_VER='[^']*'"
  ```
- 新版號＝main 的版號 +1。`index.html` 的 `APP_VER` 和 `sw.js` 的 `CACHE` 兩處都要改，而且要一致。
- **同一個版號不能出現在兩個 PR。** 合併前如果 main 已經有新的提交，先 rebase 到 main，再重新確認版號比 main 大。版號沒變，使用者的手機就**不會更新**。
- 只改文件、測試或 workflow 的 PR 不用升版號。

### 3. 提交與 PR
- commit 訊息：`v3.0.N: <繁體中文描述>`；PR 標題也用繁體中文。
- commit 作者一律用 noreply：`taya20081-stack <326361552+taya20081-stack@users.noreply.github.com>`，**不能用使用者的 Gmail**。
- 一個 PR 只做一件事。**不要自己合併**，等使用者確認。
- PR 描述要寫：改了什麼、為什麼這樣改、怎麼驗證的（附兩種 iPhone 尺寸的截圖或量測數字）、可能有什麼風險。

### 4. 驗證：沒跑過就不能說完成
每個 PR 合併前都要實際執行，並把結果寫進 PR：
```bash
python3 -c "import re;s=open('index.html',encoding='utf-8').read();open('/tmp/app.js','w').write('\n;\n'.join(re.findall(r'<script(?![^>]*src)[^>]*>(.*?)</script>',s,re.S)))" && node --check /tmp/app.js
node --test tests/*.cjs
python3 -m unittest tests/test_market_data.py
```
- 介面改動：用 Playwright 在兩種 iPhone 尺寸開啟受影響的畫面、截圖，並確認沒有頁面錯誤、沒有水平溢出（規則見下一節）。
- 測試失敗時，修程式，**不要改測試或刪測試**來讓它通過。如果確定是測試本身過時，要在 PR 裡說明原因。
- 改 `.github/workflows/` 或 `scripts/` 時：任何套件版本變更，都要先確認 GitHub runner 目前的 Python 版本有對應的安裝檔（wheel），例如 `pip download --only-binary=:all: --python-version 3.14 …`。排程「成功」不代表資料真的有更新，要去看執行記錄。

### 5. 不要碰的地方（除非使用者明確要求）
- `apple-mobile-web-app-status-bar-style`（見下方靈動島說明）、`window.FIREBASE_CONFIG`、Firestore 規則。
- 收件匣協定（`processInbox()`）：要改的話，`processInbox()` 上方的協定註解、`README.md` 的表格和使用者的「記帳」skill 三處要一起更新，而且新舊版本 App 都要能處理。
- 不要重新排版或格式化 `index.html`。這個檔案的每一行都很長，是刻意的；diff 只能包含真正修改的部分。

### 6. 隱私
- 持股代號、金額、帳戶名稱、UID、Email 等個人資料，**不能**寫進 repo 的任何檔案、測試資料、commit 訊息或 PR 描述。測試要用假資料。
- 美股持股只會透過收件匣私下傳給 App，不可以寫進 `prices.json`。

### 7. 回報給使用者
- 用繁體中文，簡潔，附具體數據（例如尺寸幾 px、幾項測試通過）。
- 先講結果，再講使用者需要做什麼（例如「回覆 go 就合併」「App 重開一次」）。
- 不確定的事要直接說不確定，不要把推測寫成事實。

## 手機 UI／UX 開發規範

所有影響畫面或操作流程的變更都需維護同一套響應式 PWA，並在以下兩種直向 CSS viewport 同時開發和驗證。

| 手機 | CSS viewport |
| --- | --- |
| iPhone 13 Pro | 390 × 844 |
| iPhone 16 Pro | 402 × 874 |

- 用範例或測試資料在兩種尺寸跑完受影響的流程，確認內容無水平溢出，主要按鈕可操作，表單和視窗的完成與取消行為正常。
- 檢查 iOS 安全區、鍵盤開啟時的表單與底部按鈕、長文字、焦點及對比。重要觸控目標至少 44 × 44 CSS px。
- **靈動島／瀏海**：`index.html` 使用 `apple-mobile-web-app-status-bar-style: default`，從主畫面開啟時，App 畫面從狀態列下方開始，所以 `env(safe-area-inset-top)` 實際上是 0，靈動島不會蓋到內容。**不要改成 `black-translucent`**；真的要改，就要讓所有頂部元件都避開安全區（16 Pro 約 59–62px、13 Pro 約 47px）。注意首頁 `.top` 是 sticky 元件，安全區變大時會蓋住月曆，得先修好這個問題。
- 用 Playwright 模擬實機可用區域時，要扣掉狀態列高度：13 Pro 用 390 × 797、16 Pro 用 402 × 812，底部安全區（home indicator）設 34px。瀏覽器模擬不會帶入 `env()` 的值，可以在測試用的副本裡把 `env(safe-area-inset-bottom…)` 換成 34px 再驗證。
- 在 PR 記錄兩種尺寸的驗證結果，註明使用瀏覽器模擬、iOS 模擬器或 Safari 實機。涉及 Safari、鍵盤或加入主畫面的行為時，有實機或 iOS 模擬器就加測。

## 設計指南與工具

- 用 **Vercel Web Design Guidelines** 審查表單標籤、焦點、觸控、安全區、無障礙和響應式版面。有安裝 skill 時依其流程審查，也可直接遵循 [Vercel 官方指南](https://vercel.com/design/guidelines)。
- 用 **Impeccable** 的 critique、audit 和 polish 指南審查畫面層級、資訊密度、操作步驟和一致性。沒有執行器時可直接讀設計文件。[Impeccable 官方文件](https://impeccable.style/docs/)
- 用 **Playwright** 驗證兩種 viewport 的實際操作，必要時截圖比對。可使用 Playwright Interactive skill 或現有 Playwright 測試。[OpenAI Skill](https://github.com/openai/skills/blob/main/skills/.curated/playwright-interactive/SKILL.md) · [Playwright 裝置模擬](https://playwright.dev/docs/emulation)
- iPhone 的表單、視窗、導覽和安全區參考 **Apple Human Interface Guidelines**。遇到需要探索手機介面慣例的設計，可搭配 Mobile Design skill。[Apple HIG](https://developer.apple.com/design/human-interface-guidelines/) · [Mobile Design](https://rubenglez.dev/mobile-design)
- **web-artifacts-builder** 用於需要可點擊原型的工作。**Expo Native UI** 適用於未來採用 Expo 的原生 App 開發。現有記帳 PWA 的介面沿用本專案架構。[Anthropic Skill](https://github.com/anthropics/skills/tree/main/skills/web-artifacts-builder) · [Expo 官方 Skills](https://docs.expo.dev/skills/)
