# ADR 0008：集中 Task Drag Session 的互動生命週期

Status: accepted

## Context

Task drag 的 drop command 已經是純函式，但 pointer activation、ghost 定位、target element tracking、`elementFromPoint` 驗證、click suppression 與 pointer cancel 仍集中在 `App.tsx`。這讓 UI adapter 同時管理拖曳狀態與 workspace command dispatch，也讓 threshold、target containment 和 cleanup 不容易在沒有完整 React 畫面的情況下測試。

## Decision

- 新增 `TaskDragSession` module，集中管理一次拖曳的 begin、move、target update、release 與 cancel 生命週期。
- Session 在 pointer 移動超過 5px 後才 activation；未 activation 的 pointer up 不產生 command。
- Session 只接受同一 Project 的 target，並在 release 時確認 pointer 仍位於 tracked element 內；hit-test 失敗時不產生 command。
- Session 透過既有 `resolveTaskDrop` 產生 `TaskDropCommand`，不直接讀寫 Workspace。
- App 保留 React state、ghost DOM 位置更新、`elementFromPoint` adapter、click suppression，以及將 command 委派給 workspace operation 的責任。
- 保留現有 Backlog／Timeline／群組拖曳規則與一次 drop 對應一次 workspace transition 的行為。

## Consequences

- 拖曳互動規則可用純 session 測試，不需啟動完整 App。
- App 的 pointer listener 只負責瀏覽器事件與 command dispatch，workspace operation 不會被拖曳 session 直接耦合。
- 未來若更換 pointer input adapter，仍可重用相同的 session 和 drop command resolver。
- click suppression 仍是 App 的 UI adapter 行為，因為它依賴 React capture event 與 DOM card。
