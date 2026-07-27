# Capacity Gantt

一套以 React、TypeScript 與 Vite 製作的本機容量規劃工具。它不是以傳統專案進度為中心，而是協助使用者回答：

> 目前的可用容量，是否足以承擔這些 Task？

以下 Backlog／Gantt 互動規則是目前產品實作的行為；共同語言請參考 [`CONTEXT.md`](./CONTEXT.md)，重大取捨請參考 [`docs/adr/0001-backlog-gantt-allocation-interaction.md`](./docs/adr/0001-backlog-gantt-allocation-interaction.md)。

## 核心概念

- **Project**：一組需要被追蹤的工作群組。
- **Task**：Project 底下可估時、可分配與可完成的工作項目。
- **Backlog**：尚未被使用者放入 Gantt 的 Task；通常沒有 Allocation 與排程日期。
- **Daily Capacity**：每天的總容量、不可用時間與可用容量。
- **Allocation**：Task 在特定日期上的工時，可由使用者指定或系統自動產生。
- **Capacity Gantt**：呈現 Task 日期範圍、容量摘要與 Allocation 狀態的時間軸。
- **Deadline**：Task 必須完成的日期；它獨立於 Allocation，超過時顯示逾期警告。
- **Pending Hours**：估計工時與目前 Allocation 總和的有號差額；正值代表待安排，負值代表需要釋放。

Gantt 日期欄會簡潔顯示「已分配 / 可用容量」（例如 `4h / 8h`）；日層級點擊日期即可編輯總容量與不可用時間，超載日期會以紅色警告。

## Backlog 與 Gantt 流程

- Task 只有一份資料；Backlog 與 Gantt 是同一 Project 內的兩個排程狀態，不會同時顯示同一個 Task。
- Backlog 卡片只需顯示名稱、優先順序與估計工時；點擊卡片開啟編輯，按住並移動可拖曳。
- 拖曳 Backlog 卡片到 Gantt 後立即自動排程，不需要確認按鈕；放下位置是最早開始位置。
- 拖回 Backlog 會清除所有 Allocation 與推導日期，但保留建立日期、Deadline、估計工時與 Task 資訊。
- 沒有 Allocation 但尚未拖回 Backlog 的 Task，會在 Project 標題列以待處理徽章表示；點擊後才展開清單。

## Allocation 規則

- 新增 Task 預設為 Backlog，預估工時預設為 8 小時，建立日期由系統記錄。
- Automatic Allocation 從使用者指定的起始日期往後尋找有剩餘容量的日期；週末與假日不特殊處理，只看每日可用容量。
- 搜尋範圍使用 Gantt 的預設規劃長度；範圍最後一天仍無法容納的工時會形成 Automatic Overflow，並顯示警告。
- Allocate 模式中，被點擊調整過的整天都視為 Manual Allocation Day，包括 `0h`；Automatic Allocation 不會補回這些日期。
- 左鍵增加 1 小時，右鍵減少 1 小時。正值 Pending Hours 會先被消耗；沒有可調整的 Automatic Allocation 時仍可增加，Pending Hours 會變成負值。
- 減少工時時，差額通常補回 Task 尾端的 Automatic Allocation；Pending Hours 為負值時，減少其他日期會優先抵銷負值。
- Task 的日期範圍根據 Allocation 自動拉長或縮短；Deadline 不會被改寫，超過時只顯示警告。
- Manual Allocation 可以超過剩餘容量，但必須清楚顯示超載；Automatic Allocation 一般不主動造成超載。
- 修改 Daily Capacity 後，只重新安排 Automatic Allocation，保留 Manual Allocation Day；有 Pending Hours 的 Task 不會因容量增加而偷偷補排。
- 本階段不做跨 Task 的自動排程、相依關係推理或全域重新排序。

## Gantt 顯示模式

- **General Mode**：隱藏每日 Allocation 細節，只顯示 Task bar、期間 capacity summary 與 Pending Hours 警示。
- **Allocate Mode**：全域切換所有展開的 Project。日層級可編輯每日工時；週／月層級只顯示期間 Allocation summary 且唯讀。
- Allocate Mode 不會改變縮放層級；所有 Project 的水平滾動位置同步。

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

目前使用 `gantt-capacity-local` schema version 2。舊版傳統 Gantt 資料會由 IndexedDB 升級流程轉成 Project／Task；舊 Task 沒有預估工時，因此會以 0 小時 Backlog 保留，待使用者補填。
