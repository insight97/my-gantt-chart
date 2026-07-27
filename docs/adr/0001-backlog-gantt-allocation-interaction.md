# Backlog 與 Gantt 共用 Task，支援兩種 Allocation 排程策略

我們決定讓 Backlog 與 Gantt 共用同一份 Task 資料，透過使用者在同一 Project 內的拖曳明確改變排程狀態；不複製 Task，也不讓兩邊同時顯示同一個 Task。Task 的開始／結束日期可以由 Allocation 推導，也可以由使用者在詳細資料或 Gantt bar 上指定。預設採最快完成策略；使用者修改起訖日後，切換成明確日期範圍內的平均分配策略。Deadline 則是獨立的軟限制，超過時保留排程並警告。

Allocate Mode 採全域切換：日層級以每次一小時的左鍵增加、右鍵減少編輯每日工時，被點擊過的日期視為 Manual Allocation Day；週／月層級只顯示唯讀摘要。這個分工保留一般 Gantt 的簡潔閱讀性，同時提供需要時的每日容量控制，而不在所有時間層級重複呈現 allocation 細節。

## Consequences

- Task 可以有正值或負值 Pending Hours；畫面必須明確區分待安排與需釋放。
- 沒有 Allocation 且沒有完整日期、又尚未拖回 Backlog 的 Task 需要條件式待處理清單，不應固定佔用時間軸空間；保留既有日期、`0h` Task 或 `0h` Allocation 紀錄的 Task 仍需顯示在 Gantt 並警示待安排。
- Automatic Allocation 重新計算時必須保留 Manual Allocation Day；capacity 變更不會自動補回使用者刻意留下的 Pending Hours。
- `fastest` 從指定起始日往後優先填滿最近可用容量；`balanced` 在明確起訖日內盡可能平均分配自動工時，並保留使用者指定的日期範圍。
- 新 Task 放入 Gantt 後沿用 Project 原有 Task 順序，新增項目移到最下方；不做全域自動排序。
- 待處理區只在有待處理 Task 時直接顯示，沒有項目時隱藏，不需要額外按鈕展開。
- Gantt 的日期範圍與 Deadline 必須分開建模；Deadline 超出目前 viewport 時仍要存在於可滾動時間軸範圍內。
- 時間軸保留至少 90 天歷史並標記今天，讓使用者可以回看近期過去的排程。
- 編輯視窗的背景點擊儲存草稿，叉叉與取消放棄草稿；新增 Task 在儲存前不建立資料。
- Gantt row 的拖曳只交換 Project 內的 Task 順序，不改變日期或 Allocation。
