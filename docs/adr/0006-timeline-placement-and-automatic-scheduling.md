# ADR 0006：區分 Timeline Placement 與 Automatic Scheduling

Status: accepted

## Context

Leaf Task 進入 Allocation Timeline、在 Timeline 內改變日期或排序位置，都是使用者的 Timeline Placement。部分 Placement 會自動建立 Allocation，但使用者也需要能在不立即分配工時的情況下先把工作放入 Timeline。

若把 Placement 與 Automatic Scheduling 視為同一個動作，拖曳 preview、單一 Task、Recurring Task、Group Transfer 與 Timeline 新增容易各自形成排程路徑。這會讓 preview 與 commit 產生不同結果，也會讓自動排程開關同時影響明確操作與隱含操作。

## Decision

- `Timeline Placement` 是改變 Leaf Task Timeline 狀態、日期或同視圖順序的操作。
- `Automatic Scheduling` 是 Placement 建立或重建 Allocation 的排程策略；preview 與 commit 使用同一個 placement plan。
- `Help Scheduling` 是獨立的填補式操作；它保留既有 Allocation，只補上尚未滿足的工時或 recurring 日期。
- 「拖入或新增時自動排程」開關只控制隱含入口：Backlog 拖入 Timeline、Group Transfer，以及 Timeline 新增 Task 或子任務。關閉時只改變 Timeline 狀態，不建立 Allocation。
- 使用者明確進行 Timeline Placement 時，仍執行 Automatic Scheduling，不受開關阻擋；任務編輯器的「幫我排程」不重建既有 Allocation。
- 使用者將既有 Timeline Leaf Task 拖到新日期時，視為明確 Placement，仍會依一般或 Recurring 規則重建 Allocation。
- Recurring Placement 以 Recurrence Rule 的日期與每次時數為來源；放下日期不平移規則。
- Group Transfer 維持一次可復原的 workspace transition，內部的 Leaf Placement 使用同一個 plan。

## Consequences

- Timeline preview 不再直接呼叫另一套一般排程函式；Recurring preview 與 commit 會使用相同規則日期。
- 關閉開關時，使用者可以先整理 Timeline hierarchy，再明確選擇何時排程。
- 既有 Timeline 任務的日期拖曳仍可能重建 Allocation；這是明確操作，不是開關控制的隱含排程。
- 未來新增 Timeline 入口必須明確標示它是隱含 Placement 或明確 Automatic Scheduling，不能自行複製排程分流。
