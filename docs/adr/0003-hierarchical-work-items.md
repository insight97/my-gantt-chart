# ADR 0003：以階層 Work Item 取代 Project 層級

## 狀態

Accepted

## 決策

所有可見工作都使用同一種 Work Item 物件。`parentId = null` 的項目是根項目，其他項目是子項目；Project 不再是產品 UI 的階層。

- 有子項目的 Work Item 不可直接擁有可編輯 Allocation。
- 父項目的工時與時間軸顯示由後代葉節點的 Allocation 彙總。
- 拖曳到項目中央代表 `inside`，拖曳到上方／下方代表 `before`／`after`。
- 拖曳會移動整個子樹，禁止移入自己的子樹，最大深度為三層。
- 使用者只輸入 Deadline；開始／結束日期是舊資料的遷移欄位，新的時間範圍由 Allocation 日期推導。

## 相容性

IndexedDB 與 JSON 匯入仍接受舊的 `projects[].tasks[]` 格式。載入時會將所有 Project 的 Task 合併到單一隱藏工作區根，保留 Allocation 與既有 metadata。這讓資料模型可以逐步從舊格式遷移，而不需要使用者先手動搬移資料。
