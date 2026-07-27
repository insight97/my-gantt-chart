# Capacity Gantt

一套以 React、TypeScript 與 Vite 製作的本機容量規劃工具。它不是以傳統專案進度為中心，而是協助使用者回答：

> 目前的可用容量，是否足以承擔這些 Task？

## 核心概念

- **Project**：一組需要被追蹤的承諾或工作群組。
- **Task**：Project 底下可估時、可分配與可完成的工作項目。
- **Backlog**：尚未產生 Allocation 的 Task；可以沒有日期。
- **Daily Capacity**：每天的總容量、不可用時間與可用容量。
- **Allocation**：Task 在特定日期上的工時，可由使用者指定或系統自動產生。
- **Capacity Gantt**：同時呈現 Task 日期範圍、每日 Allocation 與每日剩餘容量。

## Allocation 規則

- 新增 Task 預設為 Backlog，預估工時預設為 8 小時，日期可留空。
- 有完整日期範圍時，Automatic Allocation 會平均分配到仍有剩餘容量的日期。
- 沒有完整日期範圍時，Automatic Allocation 從今天往後逐日分配，並自動推導 Task 日期。
- Manual Allocation 必須被保留；Task 日期範圍不可排除既有 Manual Allocation。
- 容量不足時仍允許分配，但會顯示超載警告。
- 本階段不做跨 Task 的自動排程、相依關係推理或全域重新排序。

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
