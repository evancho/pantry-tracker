# 食材櫃

家用食材與保存期限追蹤。打開網頁或加到 iPhone 主畫面就能用。不登入時，名稱、照片、到期日與存放位置只存在這台裝置。登入後可以和家人共用同一個家庭食材櫃，離線時仍可修改，恢復網路後再同步。

介面上的名字是「食材櫃」。套件與安裝識別名稱是 `pantry-tracker`。這一版是 **2.0.0**。畫面上的版本會再加上建置日期碼，例如 `2.0.0-20260928`（台北時間的建置日）。版號來自 `package.json`，日期碼在 Vite 建置時寫入。

## 這一版做什麼

- 食材卡片：照片（可選）、名稱、到期日、存放位置、提前提醒天數
- 狀態標示：**正常**、**即將到期**、**已過期**。已過期的卡片用較深的底色、邊線與標示，標準與簡易模式都看得到
- 食材清單為單欄，一列一項。可在「標準模式」與「簡易模式」之間切換，選擇存在這台裝置
- 以名稱搜尋（輸入即過濾）；清單模式與排序在同一列，仍可依到期日、名稱或存放位置排序
- 點畫面底部的版本，或「更多」裡的「更新紀錄」，可看每個版本改了什麼
- 新增、編輯、刪除（刪除前會再確認）
- 「拍照辨識」：在裝置上辨識包裝，帶入名稱與到期日，仍可手動修改
- 開啟提醒後，打開 App 時若有食材進入提醒範圍會送出通知；拒絕權限時，卡片標示仍可使用
- 匯出／匯入 JSON 備份（含照片）
- 可選的家庭同步：Google 或電子郵件登入、建立或加入家庭、邀請家人、離線修改後再同步
- 可安裝的 PWA：離線開啟已載入的畫面。加到主畫面後若有新版本，會跳出「請更新食材櫃」，並可按「立即更新」重新載入；橫幅會留在畫面上方，直到更新完成

存放位置只有這六個：

- 冷凍
- 冷藏
- 醬料櫃
- 上方調味粉櫃
- 泡麵
- 罐頭區

設定或更改到期日時，提前提醒天數會自動帶入，之後仍可改：

- 距離到期超過 30 天：提前 7 天
- 距離到期超過 7 天：提前 3 天
- 其餘（含一週內與已過期）：提前 1 天

「即將到期」是指還沒過期，而且剩下的天數已經落在該項的提前提醒天數以內。

## 下一版才做

食譜、以及「用現有食材找菜」不在這一版。食譜分頁會標示「下一版」。

## 在本機開啟

需要 Node.js 20 以上。

```bash
npm install
npm run dev
```

瀏覽器打開終端機顯示的本機網址（預設 `http://localhost:5173`）。想讓同一網路的手機連進來：

```bash
npm run dev -- --host
```

純靜態預覽：

```bash
npm test
npm run build
npm run preview
```

`preview` 預設在 `http://127.0.0.1:4173`。用 `file://` 直接點開 `dist/index.html` 不會啟用 Service Worker，也不適合當正式用法。

## 部署到 GitHub Pages

這個倉庫的專案頁路徑是 `/pantry-tracker/`。正式建置要把 base 設成該路徑：

```bash
npm run build:pages
```

或：

```bash
BASE_PATH=/pantry-tracker/ npm run build
```

把 `dist/` 發布到 GitHub Pages 即可。倉庫裡的 [`.github/workflows/pages.yml`](.github/workflows/pages.yml) 會在推上 `main` 時跑測試、以 `/pantry-tracker/` 建置，並部署 Pages。第一次要在倉庫的 Settings → Pages 把 Source 選成 **GitHub Actions**。

若改部署到使用者站台根目錄（`https://<user>.github.io/`），建置時不要設 `BASE_PATH`，用一般的 `npm run build`（base 為 `/`）。

## 資料放在哪

- 這台裝置：IndexedDB `pantry-tracker`（食材與壓縮後的 JPEG）。沒登入的食材放在「這台裝置」；登入後的家庭食材另外依家庭分開存放，並有一份等待同步的佇列
- 排序，以及「今天已經通知過」的紀錄：`localStorage`
- 雲端（有設定時）：Firebase Authentication、Cloud Firestore、Cloud Storage。同一筆資料以較新的 `updatedAt` 為準
- 清除這個網站的瀏覽器資料，還沒同步的修改會消失。換手機前可以先匯出 JSON，或先登入家庭讓資料同步上去

## 雲端同步

靜態的 GitHub Pages 沒有自己的伺服器，所以家人共用用 **Firebase**（Auth、Firestore、Storage）。選它是因為登入方式同時有 Google 與電子郵件，安全規則可以限制只有家庭成員讀寫，而這台裝置的 IndexedDB 仍然負責離線讀寫；連線後再把較新的修改送上雲端。沒有把 Firebase 金鑰放進倉庫。GitHub Pages 若沒設定下面的變數，網站會維持單機模式，建置不會失敗。

### 要準備的 Firebase 專案

1. 在 [Firebase console](https://console.firebase.google.com/) 建立專案。
2. 新增一個 Web 應用，複製設定值。
3. Authentication → Sign-in method：啟用 **Google** 與 **電子郵件/密碼**。
4. Authentication → Settings → Authorized domains：加入 `evancho.github.io`（以及本機的 `localhost`）。
5. 建立 Cloud Firestore（正式模式）與 Storage。
6. 部署規則（專案裡的 `firebase.json` 會指到規則檔）：

```bash
npx firebase-tools deploy --only firestore:rules,storage
```

7. 本機開發：複製 `.env.example` 成 `.env.local`，填入 `VITE_FIREBASE_*`，再執行 `npm run dev`。
8. GitHub Pages：在倉庫 Settings → Secrets and variables → Actions 加入同名 secrets，再讓 Pages workflow 重新跑一次。變數會在建置時寫進靜態檔，所以改設定後要重新部署。

| Secret | 對應 |
| --- | --- |
| `VITE_FIREBASE_API_KEY` | Web API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | `*.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | 專案 id |
| `VITE_FIREBASE_STORAGE_BUCKET` | Storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Sender id |
| `VITE_FIREBASE_APP_ID` | App id |

這些是 Firebase Web 應用的公開設定，不是服務帳戶金鑰。真正的存取界限在 `firebase/firestore.rules` 與 `firebase/storage.rules`：只有該家庭的成員能讀寫食材與照片；邀請碼只有登入者能用代碼讀取，不能列出全部邀請。

### 家人怎麼加入

管理員在「更多 → 家庭與同步」建立家庭，再按「產生邀請連結」。連結帶 `?join=` 邀請碼，30 天內有效。對方登入後會加入，角色是成員。也可以按「用電子郵件寄出」，那是打開這台裝置的郵件軟體，不會經過後端代寄。一個人可以屬於多個家庭，並在選單裡切換目前家庭。

第一次進入家庭時，若這台裝置還有未登入時記的食材，會詢問要不要匯入。

iPhone 主畫面裡的 Google 彈出視窗有時會被系統擋住。這種情況改用電子郵件登入，或先用 Safari 打開網站登入。

## 拍照辨識的限制

辨識在手機或電腦上執行（Tesseract.js），不會把照片送到辨識 API。繁體中文與英文語料，以及辨識引擎，都跟網站一起下載。Service Worker 會把它們快取起來（大約 15MB），所以第一次開啟需要網路，之後離線也能辨識。

實際使用時仍請再看一眼結果：

- 包裝要盡量正面、清楚、少反光。手寫、凹凸字、透明瓶和很小的噴印日期常常辨不出來
- 失敗時會說明是逾時、辨識元件沒載入，或是沒讀到名稱與期限。欄位保持可編輯，照片仍會留下
- 日期會看台灣包裝常見寫法：`2026.12.31`、`2026年12月31日`、`有效期限`／`保存期限`／`賞味期限`、`EXP`、`BEST BEFORE`，以及民國年（例如 `115.06.30` 或 `民國115.06.30`，會換成西元）
- 同時有製造日與有效期限時，會優先採用靠近「有效期限」這類字的日期；都沒有標示時，取較晚的那個日期
- 年底在前的 `DD/MM/YYYY` 與 `MM/DD/YYYY`，若月和日都小於 12，可能判錯，請手動改
- 兩位數年份（`26.12.31`）會當成 20xx；三位數且介於 100–199 會當成民國年
- 名稱是從辨識列裡估一個比較像品名的片段，不是包裝上的正式品名欄位，所以可能帶進標語或漏掉副標

## 通知的限制

提醒用的是瀏覽器 Notification API。打開 App、從背景回到前景，以及 App 開著時約每 15 分鐘，會檢查一次。同一項食材同一天只通知一次。

iPhone 要加到主畫面，且系統為 iOS 16.4 以上，通知才比較有機會出現。iOS 不會在 App 完全關掉時持續在背景輪詢，所以「到了提醒日自動跳通知」無法保證；進到 App 時仍會補檢查。卡片上的狀態與主畫面數字徽章（若系統支援）不依賴通知權限。

## 技術架構

靜態 Vite 應用，沒有 UI 框架。領域規則（提醒天數、狀態、名稱搜尋與排序）、同步合併與 OCR 文字解析是純函式，由 Vitest 測試。畫面直接操作 DOM。沒登入時，照片與食材只進 IndexedDB。有 Firebase 設定時，登入後的家庭資料以 Firestore 分享、照片放 Storage，IndexedDB 仍是離線複本。PWA 由 `vite-plugin-pwa` 產生 `manifest.webmanifest` 與 Workbox Service Worker，離線時提供已快取的 App 殼層。偵測到新的 Service Worker 時，會打開更新對話框，並在頂端留下「立即更新」；已安裝到主畫面（`display-mode: standalone`）時，回到 App 會再提示一次，直到重新載入。版本標籤在建置時從 `package.json` 的 `version` 與台北時間日期碼組成。
