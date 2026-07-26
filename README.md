# 時序 Gantt

一套以 React、TypeScript 與 Vite 製作的純前端甘特圖工具。第一個畫面即是工作表與可水平捲動的時間軸，適合在不建立帳號、不傳送資料到伺服器的情況下管理多個專案。

線上使用：[GitHub Pages](https://insight97.github.io/my-gantt-chart/)

## 功能

- 多專案與完整工作欄位（日期、進度、負責人、顏色、備註、里程碑、相依關係）
- 新增、編輯、刪除、複製、排序，以及直接拖曳時間軸工作以平移日期
- 日／週／月顯示、PNG、SVG、CSV 與列印／PDF 輸出
- Undo／Redo（亦支援 `Ctrl/⌘ + Z`）、手動 JSON 快照與刪除前備份提醒
- 響應式繁體中文介面、鍵盤焦點與語意化標籤

## 本機開發

需要 Node.js 20 以上版本。

```bash
npm install
npm run dev
```

品質檢查及正式建置：

```bash
npm run lint
npm test
npm run build
npm run preview
```

## 資料保存與備份

專案會自動寫入目前瀏覽器的 **IndexedDB**；日／週／月偏好存於 **localStorage**。資料不會同步至雲端，無痕模式、清除網站資料、重設瀏覽器或更換裝置都可能造成遺失，請定期按「建立快照」下載 JSON。

匯出的 JSON 使用 `gantt-local` schema 與版本號。匯入會驗證必要欄位、日期、進度與版本，驗證成功後仍要求確認；採取**合併**而非覆蓋策略，ID 重複的專案會以「（匯入）」副本加入。CSV 與圖片用於分享或報表，不可作為可還原的完整備份。

## GitHub Pages 部署

Vite 的 `base` 已設為 `/my-gantt-chart/`。`.github/workflows/deploy.yml` 會在 `main` 更新時依序執行 lint、測試、建置並部署 `dist`。請在 GitHub repository 的 **Settings → Pages → Build and deployment** 將 Source 設為 **GitHub Actions**。

網站網址：[https://insight97.github.io/my-gantt-chart/](https://insight97.github.io/my-gantt-chart/)

若 fork 後更改 repository 名稱，請同步修改 `vite.config.ts` 的 `base`。
