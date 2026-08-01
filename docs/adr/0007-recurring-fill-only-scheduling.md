# ADR 0007：Recurring Allocation 採填補式排程

Status: accepted

## Context

Recurring Task 同時存在規則產生的排程與使用者對個別日期的手動調整。若每次修改 recurring rule 都完整重建 Allocation，會覆蓋使用者已確認的單日工時，也無法表達「這一天刻意少排，不需要由其他日期補回」的意圖。

Recurring Task 的預估工時也不能再是可手動輸入的獨立數字；它必須反映規則與目前排程的有效結果。

## Decision

- `幫我排程` 是填補式操作，不修改既有 Allocation。
- recurring rule 的每個已有 Allocation 日期都視為已滿足；即使時數少於規則的每次時數，也不自動補差額。
- recurring rule 延長時，只建立尚未有 Allocation 的新增日期。
- recurring rule 縮短時，只清除超出新規則且仍帶有該 Task `recurrenceId` 的自動 Allocation；手動覆寫保留。
- `清除排程` 只清除該 Task 的全部 Allocation，不清除 recurring rule、Task metadata 或狀態。
- recurring Task 的 `Estimated Hours` 為衍生值：目前 Allocation 總和，加上沒有 Allocation 的規則日期之每次時數。已有 Allocation 的日期只計算一次。
- 要完全依新規則重建時，使用者先按「清除排程」，再按「幫我排程」。

## Consequences

- 修改 recurring rule 不會破壞既有手動安排；使用者可用清除加填補完成可理解的重建流程。
- recurring 的實際 Allocation 是主要工作資料，`Estimated Hours` 只提供由目前規則與排程推導出的摘要。
- 規則變更後可能暫時存在尚未填補的日期；`幫我排程` 會補上缺口。
- Allocation 的 `recurrenceId` 成為判斷「仍由規則擁有」與「已被手動覆寫」的必要標記。
