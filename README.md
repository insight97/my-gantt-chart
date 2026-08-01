# Capacity Allocation

一套以 React、TypeScript 與 Vite 製作的本機容量規劃工具。它不是以傳統專案進度為中心，而是協助使用者回答：

> 目前的可用容量，是否足以承擔這些 Task？

以下 Backlog／Allocation Timeline 互動規則是目前產品實作的行為；共同語言請參考 [`CONTEXT.md`](./CONTEXT.md)，重大取捨請參考 [`docs/adr/0004-leaf-driven-backlog-timeline-projections.md`](./docs/adr/0004-leaf-driven-backlog-timeline-projections.md) 與 [`docs/adr/0005-fixed-24-hour-capacity.md`](./docs/adr/0005-fixed-24-hour-capacity.md)。

## 核心概念

- **Work Item**：唯一的工作物件；根項目與子項目使用相同資料結構，`parentId` 決定階層。
- **Hierarchy**：根項目沒有父項目，最多允許三層；有子項目的 Work Item 不可直接分配工時。
- **Leaf Task**：沒有子項目的 Work Item；只有 Leaf Task 可決定 Backlog／Timeline 狀態與直接分配工時。
- **Backlog**：尚未被使用者放入 Allocation Timeline 的 Leaf Task；通常沒有 Allocation。
- **Daily Capacity**：每天固定 24 小時；睡眠、休息、通勤等內容以一般 Task／Allocation 計入，不另設不可用時間或每日容量設定。
- **Allocation**：Task 在特定日期上的工時，可由使用者指定或 Automatic Scheduling 產生；不區分來源。
- **Allocation Timeline**：唯一的時間軸畫面，保留日／週／月容量摘要、Allocation 編輯、縮放、平移與 Task card 拖曳。
- **Deadline**：Task 必須完成的日期；只有實際 Allocation 日期超過時顯示逾期警告。
- 父 Work Item 的 Deadline 代表整個子樹的完成期限；新增子項目時預設繼承，子項目不可晚於已設定的父項目期限。
- 若父 Work Item 原本已有實際 Allocation，加入子項目時會保留為 `未拆分工作` 葉節點；只有預估工時但尚未分配時不會建立額外子項目。
- **Pending Hours**：估計工時與目前 Allocation 總和的有號差額；正值代表待安排，負值代表需要釋放。

Allocation Timeline 的日期欄在日檢視顯示剩餘時數，週／月檢視顯示「已分配 / 每日固定 24 小時」的期間摘要；所有 Task 的 Allocation 都會計入當日使用量，超過 24 小時會以紅色警告。

## Backlog 與 Allocation Timeline 流程

- Work Item 只有一份資料；Leaf Task 的狀態決定它在 Backlog 或 Allocation Timeline 的位置。每個可見 Leaf 都會帶著完整祖先鏈，所以子項目不會單獨出現；同一父項目可在兩邊作為群組內容出現。
- Backlog 卡片顯示名稱、優先順序與估計工時；祖先列是不可直接排程的群組內容。Leaf 卡片可點擊編輯，按住並移動可拖曳。
- 拖曳 Backlog 卡片到 Allocation Timeline 後立即執行 Automatic Scheduling，不需要確認按鈕；一般 Task 以放下位置作為 fastest 排程起點，recurring Task 依重複規則日期與每次時數安排，新 Task 放到清單最下方。
- 拖曳父群組到另一個區域會立即批次搬移其葉節點：拖入 Timeline 排程所有 Backlog Leaf，拖回 Backlog 移回所有未完成 Timeline Leaf；整批可用一次復原還原。已完成 Leaf 不會被搬動，因此父群組可繼續同時出現在兩邊。
- 按下 Work Item 的「自動排程」也會讓 Backlog Work Item 進入 Allocation Timeline；排程起點由 Allocation 日期決定。
- 拖曳 Timeline 的 Leaf Task card 回 Backlog，或在 editor 切換狀態，會清除所有 Allocation，但保留 `parentId`、截止日期與其他 metadata；放在同一父項目的 Backlog Leaf 前後時會保留插入順序。
- Task card 不再提供開始／結束日期；時間軸範圍由 Allocation 日期與 Deadline 推導。
- 收合有子項目的 Work Item 時，Timeline 顯示所有後代 Allocation 的彙總，摘要格不可編輯。

## Allocation 規則

- 新增 Task 預設為 Backlog，預估工時預設為 8 小時，建立日期由系統記錄。
- 一般 Task 的 Automatic Scheduling 採最快完成模式，從放下日期或今天往後尋找仍有剩餘時間的日期；recurring Task 依規則日期與每次時數安排，不把總 Estimated Hours 重新塞入單日。睡眠、休息等既有 Allocation 也會先消耗當日 24 小時，沒有剩餘時間時延續到下一天。週末與假日不特殊處理。
- Allocation Timeline 日層級可選擇每次調整 1 或 0.5 小時；左鍵增加、右鍵減少選定步進，只修改被操作的日期，不跨日期重平衡；可以超過容量或 Estimated Hours，必須清楚顯示警告。
- 只有明確 Automatic Scheduling 會清除並重建全部 Allocation；修改 Estimated Hours 或 Task metadata 不會改動既有 Allocation。手動調整可以暫時超過 24 小時，但必須顯示超載警告。
- 本階段不做跨 Task 的自動排程、相依關係推理或全域重新排序。

## Allocation Timeline 顯示

- Allocation Timeline 固定採單一 Allocation 操作語意。日層級可編輯每日工時；週／月層級只顯示期間 Allocation summary 且唯讀。容量摘要固定以期間天數乘以 24 小時計算；Allocation 範圍使用淺色底，有工時的格子使用較深底色；日層級週末在日期標題加上標記，下方格子維持單純底色。
- 時間軸縮放層級與工作區的水平滾動位置同步。
- Timeline 會保留同層 Work Item 順序；拖曳到項目中央代表加入子項目，拖曳到項目上方／下方代表同層排序。來源項目的整個子樹會一起移動。
- 時間軸至少提供今天前 90 天的歷史範圍，並以垂直線標出今天的位置。
- 新增 Task 會直接開啟編輯視窗；點擊視窗外側儲存，叉叉與取消放棄尚未儲存的內容。

## 本機開發

需要 Node.js 20 以上版本。

```bash
npm install
npm run dev
```

`npm install` 會自動啟用 `.githooks/pre-push`。之後每次 push 前都會執行完整驗證；若格式檢查、測試或正式建置失敗，Git 會阻止 push。

品質檢查及正式建置：

```bash
npm run verify
npm run preview
```

## 資料保存與備份

工作區會自動保存到目前瀏覽器的 **IndexedDB**；日／週／月檢視偏好存於 **localStorage**。資料不會同步到雲端，清除網站資料、無痕模式或更換裝置都可能造成遺失，請定期建立 JSON 備份。

資料存取集中在 [`src/db.ts`](./src/db.ts)，容量與 Allocation 規則集中在 [`src/capacity.ts`](./src/capacity.ts)，React UI 不直接操作 IndexedDB。

目前使用 `gantt-capacity-local` schema version 5。舊版資料會由 IndexedDB 遷移流程把多個 Project 的 Task 合併成同一工作區的 Work Item；舊資料中的每日容量／不可用時間欄位會被忽略，既有 Task 與 Allocation 會保留，並改以固定每日 24 小時計算；`projects` 只保留作為相容的匯入／儲存邊界，不再是產品 UI 的階層。
