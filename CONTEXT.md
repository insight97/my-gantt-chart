# Capacity Gantt Domain Context

這個 context 定義 Capacity Gantt 中 Project、Task、Allocation、容量與排程狀態的共同語言。產品的核心不是單純追蹤日期，而是讓使用者看見工作需求與可用容量之間的關係。

## 工作結構

**Project**：一組需要被追蹤的工作群組；Task 只屬於一個 Project。

**Task**：Project 底下可估算、可排程與可完成的工作項目。Task 有建立日期、可選的開始／結束日期與截止日期；日期可由最快完成排程推導，也可由使用者指定為平均分配的範圍。

**Task Status**：Task 的生命週期狀態，包含 `backlog`、`scheduled`、`in_progress` 與 `completed`。`completed` Task 不可修改；`in_progress` Task 仍可調整排程。

**Backlog Task**：尚未被使用者放入 Gantt 的 Task。它通常沒有 Allocation 與排程日期，但仍可保留建立日期、截止日期、優先順序與估計工時。

**Scheduled Task**：已被使用者放入 Gantt 的 Task。它可以是完整分配、部分分配，或因使用者清除所有 Allocation 而暫時沒有分配；只要沒有被明確拖回 Backlog，就仍屬於 Gantt。

**Created Date**：Task 建立時由系統記錄的唯讀日期，用於歷史與排序，不是排程邊界。

**Deadline**：Task 必須完成的日期。Deadline 是獨立限制，不會隨 Allocation 改寫；排程超過 Deadline 時保留排程並顯示逾期警告。

## 容量與工時

**Daily Capacity**：某一天可投入工作的總時間。可用容量是總容量扣除不可用時間。

**Remaining Capacity**：某一天的可用容量扣除所有 Project 的 Allocation 後的剩餘時間；小於零表示超載。

**Capacity-Available Day**：Remaining Capacity 大於零的日期。Automatic Allocation 只把一般工時放到這類日期；週末與假日沒有額外規則，完全依該日可用容量判斷。

**Allocation**：把 Task 的若干工時放到特定日期。每日畫面可操作單日總量；週與月畫面只顯示期間加總，不拆分來源。

**Manual Allocation Day**：使用者在 Allocate 模式點擊調整過的日期。該日期的最終工時是使用者決定的，包括明確調整成 `0h` 的日期；Automatic Allocation 不得覆蓋或補回它。手動分配可以造成超載，但必須清楚警告。

**Automatic Allocation**：系統依使用者指定的起始日期與每日可用容量產生的 Allocation。系統從起始日期往後尋找有空間的日期，不會在一般日期故意超載；使用者可重新自動安排，但必須保留所有 Manual Allocation Day。

**Automatic Overflow**：Automatic Allocation 到達本次 Gantt 規劃範圍的最後一天仍有剩餘工時時，仍將剩餘工時記在最後一天的特殊例外。這不是一般自動排程行為，必須顯示警告。

**Estimated Hours**：Task 預計需要完成的總工時。

**Allocation Strategy**：Task 自動分配工時的方式。`fastest` 從指定起始日往後優先填滿最近的可用容量；`balanced` 在 Task 明確的開始／結束日期內，避開 Manual Allocation Day，盡可能平均分配每日自動工時。

**Pending Hours**：`Estimated Hours - 所有 Allocation 工時總和` 的有號差額。正值表示尚有未安排工時；負值表示目前已分配超過估計工時，必須從其他日期減少工時；零表示分配平衡。

## 日期與排程邊界

**Task Date Range**：Task 的開始日至結束日，包含兩端。`fastest` 模式會依 Allocation 日期自動拉長或縮短；使用者修改日期欄位或拖曳 Task bar 後切換為 `balanced`，保留明確日期範圍，並在範圍內重新平均分配自動工時。若存在 Manual Allocation Day，日期範圍不能排除它。保留完整既有日期但尚未有 Allocation 的 Scheduled Task 仍顯示日期 bar，並標示待安排；預估工時為 `0h` 或保留 `0h` Allocation 紀錄的 Scheduled Task 也仍保留在 Gantt 任務列；沒有 Allocation 且沒有完整日期的 Scheduled Task，才會出現在 Project 的條件式待處理清單。

**Backlog to Gantt**：同一份 Task 資料在兩個位置之間移動，不建立副本。拖曳 Backlog 卡片到 Project 的 Gantt 時，放下的日／週／月週期是最早起始位置，系統以 `fastest` 策略自動分配工時，並把新加入的 Task 放在 Gantt 清單最下方；不需要確認按鈕。

**Gantt to Backlog**：使用者明確把 Task 拖回 Backlog 時，清除所有 Allocation 與 Allocation 推導日期，但保留建立日期、Deadline、估計工時與其他 Task 資訊。這代表重新開始安排。

**Allocation Rebalancing**：使用者在 Allocate 模式增加某日工時時，先消耗 Pending Hours，再從 Task 尾端的 Automatic Allocation 移動工時；若兩者都不足，仍允許增加並讓 Pending Hours 變成負值。減少某日工時時，差額通常補回尾端的 Automatic Allocation；Pending Hours 為負值時，減少其他日期的工時優先抵銷負值。

## 視圖與操作模式

**General Mode**：只呈現 Task 日期 bar、期間容量摘要與排程結果；不顯示每日 Allocation 細節。Pending Hours 非零時，Task bar 與工時摘要要有警示。沒有完整日期與 Allocation 的 Scheduled Task 會直接顯示在 Backlog 下方的待處理區；沒有待處理 Task 時隱藏該區。

**Allocate Mode**：全域切換，所有展開的 Project 一起進入此模式。日層級可用左鍵增加 1 小時、右鍵減少 1 小時；週與月層級只顯示各期間 Allocation 加總並唯讀。各 Project 的水平滾動位置同步，方便比較同一日期的跨 Project 負載。

**Timeline Semantic Level**：日、週、月是同一條連續時間軸的不同縮放語意。Allocate Mode 不改變目前縮放；只有日層級可編輯每日工時。

**Timeline History and Today Marker**：時間軸至少保留今天前 90 天的可捲動歷史，並以垂直線標記今天；若任務更早，則延伸到最早任務之前。

**Task Editor Close Semantics**：點擊編輯視窗外側代表儲存目前草稿；標題列叉叉與「取消」代表放棄草稿。新增 Task 在儲存前不寫入 Workspace，因此取消新增不會留下空白 Task。

## 排程範圍

**Project-Local Scheduling**：Backlog 與 Gantt 的拖曳只在同一個 Project 內生效；跨 Project 移動是另一個明確的資料操作，不由排程拖曳隱含完成。

本階段不處理跨 Task 相依關係、全域自動排序或多 Task 一次重排。

Gantt 內的 Task row 可以透過拖曳互換 Project 內的顯示順序；這是明確的手動排序，不會依優先順序或日期自動重排。
