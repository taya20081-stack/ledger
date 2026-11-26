# 存摺記帳開發指引

專案架構、開發指令和版本規範見 [CLAUDE.md](CLAUDE.md)。

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
