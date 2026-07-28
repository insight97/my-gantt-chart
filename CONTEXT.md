# Capacity Allocation Domain Context

這個 context 定義 Capacity Allocation 中 Project、Task、Allocation、容量與排程狀態的共同語言。產品的核心不是單純追蹤日期，而是讓使用者看見工作需求與可用容量之間的關係。

## 工作結構

**Project**：一組需要被追蹤的工作群組；Task 只屬於一個 Project。

**Task**：Project 底下可估算、可排程與可完成的工作項目。Task 有建立日期、可選的開始／結束日期與截止日期；日期可由最快完成排程推導，也可由使用者指定。

**Task Status**：Task 的生命週期狀態，包含 `backlog`、`scheduled`、`in_progress` 與 `completed`。`completed` Task 不可修改；`in_progress` Task 仍可調整排程。

**Backlog Task**：尚未被使用者放入 Allocation Timeline 的 Task。它通常沒有 Allocation 與排程日期，但仍可保留建立日期、截止日期、優先順序與估計工時。

**Scheduled Task**：已被使用者放入 Allocation Timeline 的 Task。它可以是完整分配、部分分配，或因使用者清除所有 Allocation 而暫時沒有分配；只要沒有被明確移回 Backlog，就仍屬於 Allocation Timeline。

**Created Date**：Task 建立時由系統記錄的唯讀日期，用於歷史與排序，不是排程邊界。

**Deadline**：Task 必須完成的日期。Deadline 是獨立限制，不會隨 Allocation 或 Task Date Range 改寫；只有實際 Allocation 日期超過 Deadline 時才顯示逾期警告，沒有 Allocation 時不因 metadata 顯示逾期。

## 容量與工時

**Daily Capacity**：某一天可投入工作的總時間。可用容量是總容量扣除不可用時間；修改 Daily Capacity 只改變可用空間與警告，不會移動既有 Allocation。

**Remaining Capacity**：某一天的可用容量扣除所有 Project 的 Allocation 後的剩餘時間；小於零表示超載。

**Capacity-Available Day**：Remaining Capacity 大於零的日期。Automatic Allocation 只把一般工時放到這類日期；週末與假日沒有額外規則，完全依該日可用容量判斷。

**Allocation**：把 Task 的若干工時放到特定日期。每日畫面可操作單日總量，直接改變目前結果；週與月畫面只顯示期間加總，不拆分來源。Allocation 不區分自動或手動來源。

**Automatic Allocation**：系統依使用者指定的起始日期與每日可用容量產生的 Allocation。系統從起始日期往後尋找有空間的日期，不會在一般日期故意超載；使用者可重新自動安排，重新執行時依當次起點重建 Allocation。

**Automatic Scheduling**：使用者明確按下「自動排程」，或將 Backlog Task 拖曳到 Allocation Timeline；兩者都是同一個排程操作。操作會讓 Task 進入 Allocation Timeline，使用 `fastest` 建立 Allocation，並將新進入的 Task 放到清單最下方。按鈕排程沒有開始日時從今天開始；拖曳排程使用放下日期。只分配到 Capacity-Available Day，沒有容量時保留 Pending Hours，不產生 Automatic Overflow。編輯 Task metadata、修改 Daily Capacity 或時間軸顯示，不會隱含觸發 Automatic Scheduling。

**Estimated Hours**：Task 預計需要完成的總工時。修改 Estimated Hours 只重新計算 Pending Hours 與警告，不會改動既有 Allocation；需要重新分配時必須明確執行 Automatic Scheduling。

**Allocation Strategy**：Task 自動分配工時的方式。目前只採 `fastest`，從指定起始日往後優先填滿最近的 Capacity-Available Day；不再平均分配每日自動工時。

**Pending Hours**：`Estimated Hours - 所有 Allocation 工時總和` 的有號差額。正值表示尚有未安排工時；負值表示目前已分配超過估計工時，必須顯示警告；零表示分配平衡。

## 日期與排程邊界

**Task Date Range**：Task 卡片上的開始日與結束日 metadata，使用者可以編輯，包含兩端。若設定開始日，它也是 Automatic Allocation 的起點；沒有開始日時使用今天或 Backlog drop 日期。結束日只描述卡片資訊，不是 Automatic Allocation 的上限；Automatic Allocation 只採 `fastest`。Task Date Range 與實際 Allocation 日期可以不同，不互相驗證或改寫。已進入排程的 Task 會保留 `start` anchor，即使沒有可用容量也仍顯示在 Allocation Timeline 並保留 Pending Hours；保留完整既有日期、Allocation record 或 `0h` 預估工時的 Scheduled Task 也仍顯示。只有尚未建立 anchor／Allocation／完整日期的 Scheduled Task，才會出現在 Project 的條件式待處理清單。

**Backlog to Allocation Timeline**：同一份 Task 資料在兩個位置之間移動，不建立副本。拖曳 Backlog 卡片到 Project 的 Allocation Timeline 時，放下的日／週／月週期是起始位置，這會直接觸發 Automatic Scheduling，並把新加入的 Task 放在 Allocation Timeline 清單最下方；不需要確認按鈕。

**Allocation Timeline to Backlog**：使用者可以將 Timeline 的 Task card 拖回 Backlog，或在 Task editor 明確切換狀態。兩者都是同一個移回操作：清除所有 Allocation、保留 `start`、`end`、`deadline` 與其他 Task metadata。這代表重新開始安排。

## 視圖與操作模式

**Allocation Adjustment**：Allocation Timeline 在日層級可用左鍵增加 1 小時、右鍵減少 1 小時，只修改被操作的日期；不跨日期重平衡，也不隱含觸發 Automatic Scheduling。週與月層級只顯示各期間 Allocation 加總並唯讀。各 Project 的水平滾動位置同步，方便比較同一日期的跨 Project 負載。

**Allocation Timeline**：唯一保留的時間軸畫面，固定採 Allocation Adjustment 的操作語意。它保留日、週、月的容量與 Allocation 顯示、時間軸平移與縮放，以及 Backlog Task 放入時間軸的操作；不繪製 Task bar，改以淺色底顯示第一個到最後一個正 Allocation 日期的範圍，實際有工時的格子使用較深底色。Task Date Range metadata 顯示在 Task card 上。

**Timeline Semantic Level**：日、週、月是同一條連續時間軸的不同縮放語意；只有日層級可編輯每日工時。

**Timeline History and Today Marker**：時間軸至少保留今天前 90 天的可捲動歷史，並以垂直線標記今天；若任務更早，則延伸到最早任務之前。

**Task Editor Close Semantics**：點擊編輯視窗外側代表儲存目前草稿；標題列叉叉與「取消」代表放棄草稿。新增 Task 在儲存前不寫入 Workspace，因此取消新增不會留下空白 Task。

## 排程範圍

**Project-Local Scheduling**：Backlog 與 Allocation Timeline 的拖曳只在同一個 Project 內生效；跨 Project 移動是另一個明確的資料操作，不由排程拖曳隱含完成。

本階段不處理跨 Task 相依關係、全域自動排序或多 Task 一次重排。

Allocation Timeline 內的 Task row 可以透過拖曳互換 Project 內的顯示順序；這是明確的手動排序，不會依優先順序、日期或 Automatic Scheduling 自動重排。
