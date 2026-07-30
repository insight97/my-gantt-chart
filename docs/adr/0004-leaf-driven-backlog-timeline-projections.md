# ADR 0004：以葉節點驅動 Backlog／Timeline 投影

Status: accepted

Backlog 與 Allocation Timeline 不把父項目當成擁有視圖狀態的工作；只有沒有子項目的 Leaf Task 以狀態決定所在視圖，每個可見 Leaf 一律投影出完整祖先鏈。這避免子項目失去工作脈絡，同時允許含有不同狀態後代的同一父項目在兩個視圖作為同一筆資料的群組內容出現。群組不可直接分配，但可跨視圖拖曳以觸發 Group Transfer：立即批次轉換其符合目標狀態的後代 Leaf，並作為一次可復原操作；已完成 Leaf 不變。Leaf 從 Timeline 回到 Backlog 時清除 Allocation 但保留 `parentId`，並只在同一父項目的 Leaf 間調整順序。
