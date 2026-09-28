# 食材櫃

家用食材與保存期限追蹤。打開網頁或加到 iPhone 主畫面就能用。不登入時，名稱、照片、到期日與存放位置只存在這台裝置。登入 Google 並選定共用的雲端硬碟資料夾後，可以和家人自動同步同一個食材櫃；離線時仍可修改，恢復網路後再同步。

介面上的名字是「食材櫃」。套件與安裝識別名稱是 `pantry-tracker`。這一版是 **2.1.3**。畫面上的版本會再加上建置日期碼，例如 `2.1.3-20260928`（台北時間的建置日）。版號來自 `package.json`，日期碼在 Vite 建置時寫入。

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
- 可選的家庭同步：Google 帳號登入後，清單與照片自動同步到共用的 Google 雲端硬碟資料夾。清單上方會顯示離線、同步中、已同步，或需要登入、尚未設定資料夾。沒有 OAuth 設定時仍是單機
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

- 這台裝置：IndexedDB `pantry-tracker`（食材與壓縮後的 JPEG）。還沒選過資料夾的食材放在「這台裝置」；選定雲端硬碟資料夾後，該資料夾的食材另外存放。關掉再開、尚未登入時，仍會顯示上次的資料夾。還沒放進資料夾的食材不會被清掉，登入後可以匯入
- 排序、已選過的資料夾，以及「今天已經通知過」的紀錄：`localStorage`。Google 存取權杖只留在記憶體，不寫進本機儲存
- 雲端（有設定 OAuth client id 時）：使用者 Google 雲端硬碟裡的一個資料夾。每一筆食材是 `item-<id>.json`，照片是 `photo-<id>.jpg`。同一筆以較新的 `updatedAt` 為準
- 清除這個網站的瀏覽器資料，還沒同步的修改會消失。換手機前可以先匯出 JSON，或先登入並選好資料夾讓資料同步上去

## 雲端同步

靜態的 GitHub Pages 沒有自己的伺服器。家人共用改走 **Google 雲端硬碟**：每人用自己的 Google 帳號，把同一個資料夾分享成「編輯者」。清單與照片由 App 在連線時自動推拉，不必把 JSON 備份傳來傳去。沒有 Firebase、沒有 Cloud Storage，也不需要 Blaze 方案。

沒有把 OAuth client id 放進倉庫。GitHub Pages 若沒設定 `VITE_GOOGLE_CLIENT_ID`，網站會維持單機模式，建置不會失敗。

登入用 [Google Identity Services](https://developers.google.com/identity/oauth2/web/guides/use-token-model) 的彈出視窗權杖，適合沒有後端的靜態網站。不需要設定 redirect URI。權限範圍是 `https://www.googleapis.com/auth/drive`（完整雲端硬碟）。這是受限範圍：家庭人數少時，把 OAuth 同意畫面留在「測試」並把家人加為測試使用者即可。`drive.appdata` 不能分享給家人；`drive.file` 也看不到另一位家人的 App 在共用資料夾裡建立的檔案，所以這裡用完整 Drive 範圍。

### Google Cloud Console 最小設定

1. 打開 [Google Cloud Console](https://console.cloud.google.com/) → 選或建立一個專案。
2. **API 和服務 → 已啟用的 API** → 啟用 **Google Drive API**。
3. **API 和服務 → OAuth 同意畫面**：
   - 使用者類型選「外部」。
   - 發布狀態維持「測試」。
   - 範圍加入 `https://www.googleapis.com/auth/drive`（若主控台把它標成受限範圍，測試階段仍可給測試使用者使用）。
   - **測試使用者**加入每個家人的 Google 帳號（含自己）。測試中的權杖約 7 天要重新同意一次。
4. **API 和服務 → 憑證 → 建立憑證 → OAuth 用戶端 ID**，類型選「網頁應用程式」。
5. **已授權的 JavaScript 來源**加入：
   - `https://evancho.github.io`
   - `http://localhost:5173`
   - `http://127.0.0.1:5173`
6. 這個流程是彈出視窗權杖，**不必填已授權的重新導向 URI**。若之後改成會重新導向的登入，再加入 `https://evancho.github.io/pantry-tracker/` 與本機來源。
7. 複製用戶端 ID。
8. 本機開發：複製 `.env.example` 成 `.env.local`，填入 `VITE_GOOGLE_CLIENT_ID`，再執行 `npm run dev`。
9. GitHub Pages：在倉庫 Settings → Secrets and variables → Actions 加入同名 secret，再讓 Pages workflow 重新跑一次。變數會在建置時寫進靜態檔，所以改設定後要重新部署。沒有這個 secret 時，Pages 仍會部署，只是維持單機。

| Secret | 對應 |
| --- | --- |
| `VITE_GOOGLE_CLIENT_ID` | OAuth 網頁應用程式的用戶端 ID（`….apps.googleusercontent.com`） |
| `VITE_GOOGLE_API_KEY` | 選用。目前同步只用 OAuth 權杖，不讀這個值 |

這是瀏覽器用的公開用戶端 ID，不是服務帳戶金鑰。誰能讀寫，取決於雲端硬碟資料夾有沒有把該 Google 帳號加為編輯者。

### 家人怎麼共用一個食材櫃

1. 一個人在「更多 → 家庭與同步」按「使用 Google 登入」，輸入資料夾名稱（例如「家裡的食材櫃」），按「建立雲端硬碟資料夾」。
2. 按「分享為編輯者」並填家人的 Gmail，或先按一次取得資料夾連結，再到 Google 雲端硬碟把該資料夾分享為「編輯者」。檢視者只能把雲端內容拉下來，改動不會上傳。
3. 家人用自己的 Google 帳號登入同一個網站，把資料夾連結貼到「共用資料夾連結」，按「使用這個資料夾」。
4. 之後兩邊離線都能改。恢復連線後，同一筆以較新的修改為準；刪除也會同步。
5. 第一次選好資料夾時，若這台裝置還有未登入時記的食材，會詢問要不要匯入該資料夾。
6. 選單可以切換這台裝置記得的多個資料夾。

iPhone 主畫面裡的 Google 彈出視窗有時會被系統擋住。請允許彈出視窗，或先用 Safari 打開網站登入。

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

靜態 Vite 應用，沒有 UI 框架。領域規則（提醒天數、狀態、名稱搜尋與排序）、同步合併與 OCR 文字解析是純函式，由 Vitest 測試。畫面直接操作 DOM。沒登入時，照片與食材只進 IndexedDB。有 Google OAuth client id 時，登入後的食材與照片同步到雲端硬碟資料夾，IndexedDB 仍是離線複本。PWA 由 `vite-plugin-pwa` 產生 `manifest.webmanifest` 與 Workbox Service Worker，離線時提供已快取的 App 殼層。偵測到新的 Service Worker 時，會打開更新對話框，並在頂端留下「立即更新」；已安裝到主畫面（`display-mode: standalone`）時，回到 App 會再提示一次，直到重新載入。版本標籤在建置時從 `package.json` 的 `version` 與台北時間日期碼組成。
