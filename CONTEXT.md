# Capacity Gantt Domain Context

這個 context 描述 Capacity Gantt 中 Project、Task、容量與工時分配的共同語言。產品保留既有的 Project／Task 命名，但其核心用途是檢查工作負載與可用容量是否相符。

## 工作結構

**Project**：一組需要被追蹤的承諾或工作群組。產品中以 Project 作為正式名稱；spec 中的 Commitment 指的是同一個概念，不是另一層資料。

**Task**：Project 底下可估算、可安排與可完成的工作項目。Backlog Task 的開始日期與結束日期可以不填；產生 Allocation 後，Task 應形成包含所有 Allocation 日期的日期範圍，缺少的日期邊界可由系統推導。日期範圍本身不代表已占用容量。

**Backlog Task**：尚未被分配工時的 Task。它可以沒有日期；有完整日期時可以在時間軸上被拖曳調整，但不占用任何每日容量。沒有完整日期的 Backlog Task 可以由 Allocation Completion 從今天開始建立日期與工時分配。

**Scheduled Task**：已有一筆或多筆 Allocation 的 Task。它的工作期間仍由 Task 日期決定，實際每日負載則由 Allocation 決定。

## 容量與分配

**Daily Capacity**：某一天可投入工作的時間。可用容量是總容量扣除不可用時間。

**Remaining Capacity**：某一天的可用容量扣除當日所有 Task Allocation 後的剩餘時間。小於零表示超載，超載是可被允許但必須被清楚警告的狀態。

**Allocation**：把某個 Task 的若干工時放到特定日期。Allocation 可以由使用者指定，也可以由系統在 Task 的日期範圍內補足。

**Manual Allocation**：使用者明確指定的 Allocation。系統重新補足工時時必須保留它。

**Capacity-Available Day**：Task 日期範圍內，扣除當日既有分配後仍有剩餘容量的日期。只要剩餘容量大於零，就算是可用日期。

**Automatic Allocation**：系統為了補足 Task 尚未分配的估時而產生的 Allocation。有完整日期範圍時，系統會在範圍內的 Capacity-Available Day 平均分配；沒有完整日期範圍時，系統從今天起依序使用每日可用時間往後分配，並由分配結果推導日期。若容量不足，仍繼續分配並顯示超載。系統可以在重新計算時調整它。

**Estimated Hours**：Task 預計需要完成的總工時。Task 的所有 Allocation 工時總和應等於 Estimated Hours；若容量不足，仍可分配並顯示超載警告。

**Allocation Completion**：對單一 Task，先保留 Manual Allocation，再由系統補足尚未分配的估時。若有完整日期範圍，就平均分配到 Capacity-Available Day；若日期不完整，就從今天開始逐日分配並推導開始／結束日期，直到所有 Allocation 工時總和達到 Estimated Hours。

**Manual Allocation Boundary**：Task 已填寫的日期邊界不能排除任何 Manual Allocation 的日期。任何會讓開始日期晚於、或結束日期早於既有 Manual Allocation 的操作都必須被阻止；未填寫的邊界可以由 Manual 或 Automatic Allocation 推導，先移除或調整 Manual Allocation 後才可縮短既有範圍。

## 排程邊界

**Task Date Range**：Task 的開始日期至結束日期，包含兩端。Phase 0 允許使用者拖曳 Task 來改變此範圍。

**Allocation Completion** 屬於單一 Task 期間內的工時補足，不等同於替多個 Task 選擇日期、處理相依關係或重新安排整個 Project 的排程。後者屬於未來的排程引擎。
