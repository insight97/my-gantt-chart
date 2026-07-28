# Capacity Allocation

一套以 React、TypeScript 與 Vite 製作的本機容量規劃工具。它不是以傳統專案進度為中心，而是協助使用者回答：

> 目前的可用容量，是否足以承擔這些 Task？

以下 Backlog／Allocation Timeline 互動規則是目前產品實作的行為；共同語言請參考 [`CONTEXT.md`](./CONTEXT.md)，重大取捨請參考 [`docs/adr/0002-allocation-timeline-explicit-scheduling.md`](./docs/adr/0002-allocation-timeline-explicit-scheduling.md)。

## 核心概念

- **Project**：一組需要被追蹤的工作群組。
- **Task**：Project 底下可估時、可分配與可完成的工作項目。
- **Backlog**：尚未被使用者放入 Allocation Timeline 的 Task；通常沒有 Allocation。
- **Daily Capacity**：每天的總容量、不可用時間與可用容量。
- **Allocation**：Task 在特定日期上的工時，可由使用者指定或 Automatic Scheduling 產生；不區分來源。
- **Allocation Timeline**：唯一的時間軸畫面，保留日／週／月容量摘要、Allocation 編輯、縮放、平移與 Task card 拖曳。
- **Deadline**：Task 必須完成的日期；只有實際 Allocation 日期超過時顯示逾期警告。
- **Pending Hours**：估計工時與目前 Allocation 總和的有號差額；正值代表待安排，負值代表需要釋放。

Allocation Timeline 的日期欄會簡潔顯示「已分配 / 可用容量」（例如 `4h / 8h`）；日層級點擊日期即可編輯總容量與不可用時間，超載日期會以紅色警告。

## Backlog 與 Allocation Timeline 流程

- Task 只有一份資料；Backlog 與 Allocation Timeline 是同一 Project 內的兩個排程狀態，不會同時顯示同一個 Task。
- Backlog 卡片只需顯示名稱、優先順序與估計工時；點擊卡片開啟編輯，按住並移動可拖曳。
- 拖曳 Backlog 卡片到 Allocation Timeline 後立即執行 fastest Automatic Scheduling，不需要確認按鈕；放下位置是起始日期，新 Task 放到清單最下方。
- 按下 Task 的「自動排程」也會讓 Backlog Task 進入 Allocation Timeline；沒有 `start` 時從今天開始。
- 拖曳 Timeline 的 Task card 回 Backlog，或在 editor 切換狀態，會清除所有 Allocation，但保留日期與其他 Task metadata。
- Task card 顯示 Task Date Range metadata；時間軸不再繪製可遮住 Allocation 的 Task bar。

## Allocation 規則

- 新增 Task 預設為 Backlog，預估工時預設為 8 小時，建立日期由系統記錄。
- Automatic Scheduling 只採最快完成模式，從 `start`、放下日期或今天往後尋找 Capacity-Available Day；沒有容量時保留 Pending Hours，不產生 Automatic Overflow。週末與假日不特殊處理，只看每日可用容量。
- Allocation Timeline 日層級左鍵增加 1 小時，右鍵減少 1 小時，只修改被操作的日期，不跨日期重平衡；可以超過容量或 Estimated Hours，必須清楚顯示警告。
- 只有明確 Automatic Scheduling 會清除並重建全部 Allocation；修改 Daily Capacity、Estimated Hours 或 Task metadata 不會改動 Allocation。
- 本階段不做跨 Task 的自動排程、相依關係推理或全域重新排序。

## Allocation Timeline 顯示

- Allocation Timeline 固定採單一 Allocation 操作語意。日層級可編輯每日工時；週／月層級只顯示期間 Allocation summary 且唯讀。Allocation 範圍使用淺色底，有工時的格子使用較深底色。
- 時間軸縮放層級與所有 Project 的水平滾動位置同步。
- Timeline 會保留既有 Task 順序，新拖入的 Task 放在最下方；Task row 可由使用者手動排序。
- 時間軸至少提供今天前 90 天的歷史範圍，並以垂直線標出今天的位置。
- 新增 Task 會直接開啟編輯視窗；點擊視窗外側儲存，叉叉與取消放棄尚未儲存的內容。

## 本機開發

需要 Node.js 20 以上版本。

```bash
npm install
npm run dev
```

品質檢查及正式建置：

```bash
npm run lint
npm test
npm run build
npm run preview
```

## 資料保存與備份

工作區會自動保存到目前瀏覽器的 **IndexedDB**；日／週／月檢視偏好存於 **localStorage**。資料不會同步到雲端，清除網站資料、無痕模式或更換裝置都可能造成遺失，請定期建立 JSON 備份。

資料存取集中在 [`src/db.ts`](./src/db.ts)，容量與 Allocation 規則集中在 [`src/capacity.ts`](./src/capacity.ts)，React UI 不直接操作 IndexedDB。

目前使用 `gantt-capacity-local` schema version 3。舊版資料會由 IndexedDB 升級流程轉成 Project／Task；舊 Task 沒有預估工時，因此會以 0 小時 Backlog 保留，待使用者補填。
