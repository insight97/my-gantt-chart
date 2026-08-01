# Capacity Allocation Domain Context

這個 context 定義 Capacity Allocation 中 Work Item、Allocation、容量與排程狀態的共同語言。產品的核心不是單純追蹤日期，而是讓使用者看見工作需求與可用容量之間的關係。

## 工作結構

**Work Item**：唯一的工作物件。根項目與子項目沒有不同的型別，`parentId` 為空代表根項目；最多三層。

**Hierarchy**：有子項目的 Work Item 是群組／彙總項目，不能直接分配工時；其預估工時與 Allocation 由所有後代葉節點彙總。跨視圖拖曳群組是一次 Group Transfer：它批次轉換符合目標狀態的葉節點，群組本身不取得視圖狀態。

**Task Status**：Task 的生命週期狀態，包含 `backlog`、`scheduled`、`in_progress` 與 `completed`。`completed` Task 不可修改；`in_progress` Task 仍可調整排程。

**Leaf Task**：沒有子項目的 Work Item。只有 Leaf Task 擁有 Backlog／Timeline 狀態並可直接分配工時。

**View Projection**：Backlog 與 Allocation Timeline 都是同一份 Work Item 樹的投影。Leaf Task 的狀態決定它出現在哪個視圖，而每個可見 Leaf Task 都必須帶著完整祖先鏈；因此子項目不會單獨出現，父項目可同時作為兩個視圖的群組內容出現，但仍是同一筆資料。

**Group Transfer**：使用者將群組拖曳到另一個視圖時的立即批次操作。拖入 Timeline 會依穩定樹序排程其中的 Backlog Leaf；拖回 Backlog 會移回未完成的 Timeline Leaf 並清除其 Allocation。已完成 Leaf 不變，因此群組可能仍同時出現在兩個視圖；整批操作可作為單次歷史紀錄復原。

**Backlog Task**：尚未被使用者放入 Allocation Timeline 的 Leaf Task。它通常沒有 Allocation 與排程日期，但仍可保留建立日期、截止日期、優先順序與估計工時。

**Scheduled Task**：已被使用者放入 Allocation Timeline 的 Leaf Task。它可以是完整分配、部分分配，或因使用者清除所有 Allocation 而暫時沒有分配；只要沒有被明確移回 Backlog，就仍屬於 Allocation Timeline。

**Created Date**：Task 建立時由系統記錄的唯讀日期，用於歷史與排序，不是排程邊界。

**Deadline**：Task 必須完成的日期。Deadline 是獨立限制，不會隨 Allocation 或 Task Date Range 改寫；只有實際 Allocation 日期超過 Deadline 時才顯示逾期警告，沒有 Allocation 時不因 metadata 顯示逾期。

## 容量與工時

**Daily Capacity**：目前固定為每天 24 小時。系統不另存每日容量或不可用時間；睡眠、休息、通勤等內容應建立為一般 Task，透過其 Allocation 佔用時間。

**Remaining Capacity**：某一天的 24 小時扣除所有 Work Item Allocation 後的剩餘時間；小於零表示超載。

**Capacity-Available Day**：Remaining Capacity 大於零的日期。Automatic Allocation 只把一般工時放到這類日期；週末與假日沒有額外規則，完全依該日可用容量判斷。

**Allocation**：把 Task 的若干工時放到特定日期。每日畫面可操作單日總量，直接改變目前結果；週與月畫面只顯示期間加總，不拆分來源。Allocation 不區分自動或手動來源。

**Automatic Allocation**：系統依放下日期或今天與固定每日 24 小時產生的 Allocation。系統從起點往後尋找有剩餘時間的日期，所有既有 Task（包含睡眠、休息等 Task）的 Allocation 都會計入，不會在一般日期故意超載；使用者可重新自動安排。

**Automatic Scheduling**：使用者明確按下「自動排程」、將 Backlog Task 拖曳到 Allocation Timeline，或從 Allocation Timeline 新增 Task 並儲存；三者都先共用草稿驗證、父節點直接工時拆分與 Deadline 檢查，再進入同一個 Allocation 重建 transition。從 Backlog 父項目新增子任務時，新子任務沿用 Backlog 入口；從 Timeline 父項目新增子任務時，新子任務使用 Timeline 入口並在儲存時建立 Allocation。一般 Task 使用 `fastest` 建立 Allocation；有 `recurrence` 的 Task 則以重複規則日期與每次時數建立 Allocation，不使用累積的 `Estimated Hours` 重新分散，並將新進入的 Task 放到清單最下方。Backlog Task 按下「自動排程」時一般 Task 一律從今天開始，不沿用拖回 Backlog 後殘留的舊 `start` metadata；有重複規則的 Task 保留規則日期。按鈕與 Timeline 新增沒有開始日時也從今天開始；拖曳排程的放下日期只決定進入 Timeline，不會平移 recurring 規則。已在 Timeline 的 Leaf Task 拖到另一個日期時，一般 Task 會清除舊 Allocation 並以新日期重新建立；recurring Task 會依規則重建；`in_progress` 重新排程後保持原狀態。只分配到仍有剩餘時間的日期，沒有剩餘時間時延續到下一天；手動或 recurring Allocation 若超過 24 小時則保留結果並顯示超載。編輯既有 Task metadata 或時間軸顯示，不會隱含觸發 Automatic Scheduling。

**Estimated Hours**：Task 預計需要完成的總工時。修改 Estimated Hours 只重新計算 Pending Hours 與警告，不會改動既有 Allocation；需要重新分配時必須明確執行 Automatic Scheduling。

**Allocation Strategy**：Task 自動分配工時的方式。目前只採 `fastest`，從指定起始日往後優先填滿最近的 Capacity-Available Day；不再平均分配每日自動工時。

**Pending Hours**：`Estimated Hours - 所有 Allocation 工時總和` 的有號差額。正值表示尚有未安排工時；負值表示目前已分配超過估計工時，必須顯示警告；零表示分配平衡。

## 日期與排程邊界

**Deadline**：Work Item 必須完成的日期，是唯一由使用者輸入的日期限制。開始／結束日期不再是編輯欄位；時間軸範圍與摘要直接由 Allocation 日期推導。

**Backlog to Allocation Timeline**：同一份 Leaf Task 資料在兩個位置之間移動，不建立副本。拖曳到時間軸空白區會觸發 Automatic Scheduling；一般 Task 使用放下日期作為最快排程起點，recurring Task 依規則日期與每次時數建立 Allocation。拖曳到另一個 Work Item 則依落點加入子項目或改變同層順序。拖曳群組時改用 Group Transfer，一次排程其中所有 Backlog Leaf；祖先不因此獲得可分配工時。

**Allocation Timeline to Backlog**：使用者可以將 Timeline 的 Leaf Task card 拖回 Backlog，或在 editor 明確切換狀態。兩者都是同一個移回操作：清除所有 Allocation、保留 `parentId`、Deadline 與其他 metadata；若放在同一父項目的 Backlog 同層項目前後，則一併更新其同層順序。Backlog 中的群組也可在同層項目前後重排，並連同完整子樹一起移動。拖曳群組回 Backlog 時，以 Group Transfer 一次移回其中所有未完成 Timeline Leaf；已完成 Leaf 保留在 Timeline。

## 視圖與操作模式

**Allocation Adjustment**：Allocation Timeline 在日層級可用左鍵增加、右鍵減少使用者選定的調整步進（預設 1 小時，也可選 0.5 小時），只修改被操作的日期；不跨日期重平衡，也不隱含觸發 Automatic Scheduling。週與月層級只顯示各期間 Allocation 加總並唯讀；父項目的彙總格在任何層級都唯讀。

**Allocation Timeline**：唯一保留的時間軸畫面，固定採 Allocation Adjustment 的操作語意。它保留日、週、月的固定 24 小時容量與 Allocation 顯示、時間軸平移與縮放，以及 Backlog Task 放入時間軸的操作；不繪製 Task bar，改以淺色底顯示第一個到最後一個正 Allocation 日期的範圍，實際有工時的格子使用較深底色，日層級週末在日期標題標記、下方格子不加入週末紋理。Timeline 與 Backlog 都可以獨立收合群組；收合只隱藏該視圖的子項目，不改變另一個視圖。Task Date Range metadata 顯示在 Task card 上。

**Timeline Semantic Level**：日、週、月是同一條連續時間軸的不同縮放語意；只有日層級可編輯每日工時。

**Timeline History and Today Marker**：時間軸至少保留今天前 90 天的可捲動歷史，並以垂直線標記今天；若任務更早，則延伸到最早任務之前。

**Task Editor Close Semantics**：點擊編輯視窗外側代表儲存目前草稿；標題列叉叉與「取消」代表放棄草稿。新增 Task 在儲存前不寫入 Workspace，因此取消新增不會留下空白 Task。

## 排程範圍

本階段不處理跨 Work Item 相依關係、全域自動排序或多 Task 一次重排。Backlog 與 Timeline 都可在同一父項目的兄弟節點間排序；重新掛載時來源的整個子樹一起移動。
