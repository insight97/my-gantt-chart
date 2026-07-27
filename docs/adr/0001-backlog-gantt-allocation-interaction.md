# Backlog 與 Gantt 共用 Task，Allocation 推導排程日期

我們決定讓 Backlog 與 Gantt 共用同一份 Task 資料，透過使用者在同一 Project 內的拖曳明確改變排程狀態；不複製 Task，也不讓兩邊同時顯示同一個 Task。Task 的開始／結束日期由 Allocation 自動推導，Deadline 則是獨立的軟限制，超過時保留排程並警告。

Allocate Mode 採全域切換：日層級以每次一小時的左鍵增加、右鍵減少編輯每日工時，被點擊過的日期視為 Manual Allocation Day；週／月層級只顯示唯讀摘要。這個分工保留一般 Gantt 的簡潔閱讀性，同時提供需要時的每日容量控制，而不在所有時間層級重複呈現 allocation 細節。

## Consequences

- Task 可以有正值或負值 Pending Hours；畫面必須明確區分待安排與需釋放。
- 沒有 Allocation 且沒有完整日期、又尚未拖回 Backlog 的 Task 需要條件式待處理清單，不應固定佔用時間軸空間；保留既有日期的 Task 仍需顯示 bar 並警示待安排。
- Automatic Allocation 重新計算時必須保留 Manual Allocation Day；capacity 變更不會自動補回使用者刻意留下的 Pending Hours。
- Gantt 的日期範圍與 Deadline 必須分開建模；Deadline 超出目前 viewport 時仍要存在於可滾動時間軸範圍內。
