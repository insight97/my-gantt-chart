# ADR 0005：以固定每日 24 小時取代每日容量設定

Status: accepted

系統不再為每一天保存總容量或不可用時間。每日可用時間固定為 24 小時；睡眠、休息、通勤、假日等需要佔用時間的內容都建立為一般 Task，透過其 Allocation 消耗當日時間。Automatic Scheduling 會把所有其他 Task 的 Allocation 視為已使用時間，從指定日期往後尋找仍有空間的日期。

## Consequences

- `WorkspaceData` 不再包含 `dailyCapacities`，並以 schema version 5 保存。
- 舊版資料的 Task 與 Allocation 會保留；舊的每日容量／不可用時間資料不再套用，遷移後以每日 24 小時計算。
- 日／週／月容量摘要以期間天數乘以 24 小時計算，不再提供每日容量編輯器。
- 手動與 recurring Allocation 可以超過 24 小時；結果保留，Timeline 以 overloaded 狀態警告，不默默移動使用者的安排。
- Automatic Scheduling 不會故意建立超過 24 小時的 Allocation；若當日剩餘時間不足，會把剩餘工時延續到下一天，直到排程 horizon 結束。
- 未來若需要工作時間、時區、假日或跨日規則，應另建明確的 Calendar／Resource 模型，不把例外重新塞回每日容量欄位。
