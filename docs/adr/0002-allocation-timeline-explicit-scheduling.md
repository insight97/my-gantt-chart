# Allocation Timeline 與明確的最快完成排程

Status: accepted

Capacity Allocation 只保留 Allocation Timeline 作為時間軸操作介面，移除 General Mode、Task bar 日期操作與 balanced allocation。Automatic Scheduling 只在使用者按下按鈕或將 Backlog Task 拖入 Allocation Timeline 時執行；兩者共用同一個 fastest scheduling module。Capacity、Estimated Hours 與 Task metadata 的修改不會隱含重排，只有明確 Automatic Scheduling 會清除並重建全部 Allocation。

## Consequences

- Timeline 不繪製 Task bar；Task card 仍可拖入或拖回 Backlog，Task Date Range metadata 顯示在卡片上。
- `start` 是下一次 Automatic Scheduling 的起點；`end` 只描述卡片 metadata；Deadline 只根據實際 Allocation 日期顯示警告。
- Allocation 不再區分 automatic／manual source，也不再保存 locked 狀態。
- Allocation Timeline 的每日調整只修改被操作日期，不跨日期重平衡；超過容量或預估工時時保留結果並警告。
- Capacity 不足時保留 Pending Hours，不產生 Automatic Overflow。
- 新進入 Timeline 的 Task 放到清單最下方；Automatic Scheduling 不改變既有 Task 順序。
