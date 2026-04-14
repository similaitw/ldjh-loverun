# 羅東愛心路跑圈數記錄系統 — 開發文件

## 專案概覽

**專案名稱：** 羅東愛心路跑圈數記錄系統（ldjh-loverun）  
**用途：** 學校路跑活動現場使用，供學生登記跑步時段、即時記圈、管理員管理報名  
**GitHub：** https://github.com/similaitw/ldjh-loverun  
**正式網址：** https://luodong-love-run.vercel.app（Vercel）/ https://ldjh-loverun.netlify.app（Netlify）

---

## 技術架構

| 項目 | 技術 |
|---|---|
| 框架 | Next.js 14.0.4（Pages Router） |
| UI | React 18.2.0 + Tailwind CSS 3.3.6 |
| 資料庫 | Firebase Firestore（雲端即時同步） |
| 部署 | Vercel（CLI 部署 `npx vercel --prod`）/ Netlify（GitHub 自動部署） |
| 離線快取 | Firestore IndexedDB persistence |
| Node.js | 20.x（⚠️ 不可用 24.x，Next.js 14 不相容） |

---

## 目錄結構

```
ldjh-loverun/
├── lib/
│   └── firebase.js          # Firebase 初始化（讀環境變數）
├── pages/
│   ├── _app.js              # Next.js App 包裝，載入 globals.css
│   └── index.js             # 首頁，載入 LoveRunTracker 元件
├── styles/
│   └── globals.css          # Tailwind 指令
├── loverun-tracker.jsx      # ★ 核心元件（所有邏輯、UI 都在這，約 1600 行）
├── .env.local               # 本地環境變數（不進 git）
├── .gitignore
├── netlify.toml             # Netlify 部署設定
├── next.config.js
├── package.json             # engines.node = "20.x"
├── postcss.config.js
├── tailwind.config.js
└── vercel.json
```

---

## 環境變數

### 本地開發（`.env.local`）

```env
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
NEXT_PUBLIC_ADMIN_PASSWORD=...
```

> `NEXT_PUBLIC_*` 會被 Next.js 打包進前端 JS bundle（設計如此）。  
> `NEXT_PUBLIC_ADMIN_PASSWORD` 為管理頁登入密碼（前端驗證，非真正安全）。

### 生產環境

- **Vercel**：專案 `luodong-love-run` → Settings → Environment Variables（7 個變數皆已設定）
- **Netlify**：Site configuration → Environment variables（7 個變數皆已設定）
- `netlify.toml` 已設定 `SECRETS_SCAN_OMIT_KEYS` 排除 Netlify secrets scanning 誤判

---

## Firebase 設定

**專案 ID：** ldjh-loverun  
**Console：** https://console.firebase.google.com/project/ldjh-loverun

### Firestore 資料結構

```
signups/
  {token}/                    # 每筆報名，以 token 為 document ID
    id: number
    name: string
    token: string             # 8碼英數，供報名者修改用
    slots: string[]           # 例：['08:00','08:05','09:15']
    createdAt: number

settings/
  main/
    eventName: string         # 活動名稱（預設 '羅東愛心路跑'）
    eventDate: string         # 活動日期（自由文字，例 '2026年5月10日（六）'）
    extraEndHour: number      # 活動結束時間（16–20）
```

### Firestore 安全規則

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /signups/{token} {
      allow read, create, update, delete: if true;
    }
    match /settings/{docId} {
      allow read, write: if true;
    }
  }
}
```

> ⚠️ 目前規則全開，任何人都可讀寫。管理功能僅靠前端密碼保護。

---

## 核心元件：`loverun-tracker.jsx`

整個應用只有這一個元件，包含所有 UI 和邏輯。

### 頁籤結構（TABS）

| key | 圖示 | 名稱 | 說明 |
|---|---|---|---|
| `signup` | 📋 | 報名登記 | 輸入姓名 → 選時段 → 完成，顯示登記總覽、往年回顧 |
| `display` | 📺 | 展示 | 全場總圈數大字展示 + 記圈操作 + 個人統計滑出面板 |
| `admin` | ⚙️ | 管理 | 需密碼，管理報名、設定、統計資料、清資料 |

> 原有的「統計資料」頁籤已整合進管理頁。

### 主題系統（SKINS）

5 組主題配色，儲存於 localStorage（`loverun_skin`）。每組 skin 包含：

| 屬性 | 用途 |
|---|---|
| `header` | 頂部 header 漸層背景 |
| `page` | 頁面背景 Tailwind class（`from-*` `via-*` `to-*`） |
| `displayBg` | 展示頁深色漸層背景 |
| `displayAccent` | 展示頁強調色（hex） |
| `displayCard` | 展示頁卡片半透明背景（rgba） |
| `cardGrad` | 慶祝卡片漸層 |
| `adminGrad` | 管理登入漸層 |
| `statCards` | 統計卡片漸層陣列（3色） |
| `tabActive/tabInactive` | 頁籤啟用/未啟用樣式 |
| `btnGrad/btnHover` | 按鈕漸層/hover |
| `subtextHeader/badgeColor` | Header 副文字/徽章顏色 |

**可用主題：** `ocean`（深海藍）、`sunset`（日落橙）、`forest`（森林綠）、`sakura`（櫻花粉）、`night`（暗夜紫）

### 時間區塊（TIME_BLOCKS）

由 `BASE_BLOCKS`（08:00–16:10 固定）+ 動態 `extra` 區塊（16:10 後依 `extraEndHour` 延伸）組成。

| 類型 | 顏色 | 說明 |
|---|---|---|
| `free` | 灰 | 課前（08:00–08:20） |
| `period` | 白 | 第一節～第七節 |
| `break` | 灰淡 | 下課（含 ☕） |
| `meal` | 琥珀 | 午餐 11:50–12:30（含 🍱） |
| `rest` | 紫 | 午休 12:30–13:30（含 😴） |
| `extra` | 青 | 預備時段，16:10 後（含 ⏰） |

### 時段格子顏色規則

| 顏色 | 條件 |
|---|---|
| 綠 | 0 人 |
| 黃 | 1–2 人 |
| 橙 | 3–4 人 |
| 紅 | 5 人以上 |
| 藍 | 已選取（自己） |

### Banner 標題（Header）

| 行 | 內容 | 來源 |
|---|---|---|
| 第一行 | 活動名稱 | Firestore `settings/main.eventName` |
| 第二行 | 活動日期 | Firestore `settings/main.eventDate`（有值才顯示） |

右側顯示即時時鐘 + 已登記人數。header 上有主題切換按鈕（🎨 圓角方塊，hover 展開下拉）。

---

### 報名登記頁（signup）

**三步驟流程：**

1. **`signupStep = 'name'`** — 輸入姓名
   - 頂部 3 欄統計卡（已登記人數 / 已佔用時段 / 可用時段）
   - 登記表單卡片（姓名輸入框 + `<datalist>` 自動完成）
   - 底部「登記狀況總覽」時間軸（依 TIME_BLOCKS 顯示格子 + 人數色塊）
   - 底部「往年活動回顧」YouTube embed + Google Photos 連結
2. **`signupStep = 'grid'`** — 選時段格子
   - 彈窗（手機 bottom-sheet，平板/PC 置中 modal）
   - 時間軸按區塊顯示，點擊格子選/取消，可多選
   - 底部送出按鈕
3. **`signupStep = 'done'`** — 完成
   - 慶祝卡片（漸層背景）
   - 顯示修改碼（8碼 token）+ 複製連結按鈕
   - 「繼續為其他人登記」按鈕

**修改模式：** URL 帶 `?token=XXXXXXXX` 自動進入修改模式，載入該筆報名的姓名和已選時段。

### 往年回顧資料（PAST_EVENTS）

```javascript
const PAST_EVENTS = [
  { year: '往年', type: 'video', title: '羅東愛心路跑精彩回顧', url: '...', embedId: '9HWyDIqItB4' },
  { year: '往年', type: 'album', title: '活動照片集', url: 'https://photos.app.goo.gl/ofwnpgqwH3dgF2mB7' },
]
```

---

### 展示頁（display）

**用途：** 活動現場大螢幕展示 + 即時記圈操作

**主畫面佈局（由上到下）：**

1. **標題列** — 活動名稱 + 日期 + 即時時鐘，左側跑步圖示容器（圓角毛玻璃）
2. **全場總圈數**（正中央超大字）— 使用 `clamp(6rem, 18vw, 14rem)` 自適應尺寸，顏色為 `skin.displayAccent`
3. **記圈操作區**（半透明卡片 `skin.displayCard`）
   - 選擇跑者（下拉選單，來源：participants + signups + lapRecords 去重合併）
   - 手動對時（toggle 開關 + time input，關閉時用系統時間）
   - 記圈按鈕（按下後 `recordDisplayLap()` 寫入 lapRecords + 播放音效）
   - 選中跑者後下方顯示**該跑者圈數**（`text-5xl` ~ `text-7xl`）
   - 各圈記錄橫向捲動條（圈序號 + 時間，hover 可刪除）
4. **底部排行快覽** — 前 8 名橫向卡片（金銀銅牌），點擊切換跑者
   - 「查看全部 →」打開側邊面板

**裝飾背景：** 三個漸層圓形光暈（`skin.displayAccent` 色，opacity 5%–10%）

**個人統計面板（Drawer）：**
- 點擊「👥 個人統計」或排行榜「查看全部」從右側滑出
- 背景遮罩（`bg-black/50 backdrop-blur-sm`）
- 頂部：匯出 CSV 按鈕 + 關閉按鈕
- 每位跑者用 `<details>` 收合/展開
  - summary：排名 + 姓名 + 總圈數
  - 展開：各圈的序號 + 記錄時間（hover 可刪除）
- 按總圈數降序排列

**全螢幕：** `displayRef.current.requestFullscreen()`，全螢幕時右上角多一個「👥」按鈕

**圈數資料結構（lapRecords，存 localStorage）：**

```javascript
{
  id: number,           // Date.now() 時間戳
  participant: string,  // 跑者姓名
  scheduleId: number,   // 展示頁記錄為 0
  className: string,    // 展示頁記錄為 '展示記錄'
  time: string,         // 'HH:MM:SS'（系統時間或手動對時）
  timestamp: number     // Date.now()
}
```

**CSV 匯出格式（`exportDisplayLaps()`）：**

| 姓名 | 第幾圈 | 記錄時間 |
|---|---|---|
| 王小明 | 1 | 08:15:30 |
| 王小明 | 2 | 08:22:45 |

---

### 管理頁（admin）

**密碼保護：** 透過 `NEXT_PUBLIC_ADMIN_PASSWORD` 環境變數，前端比對。

**管理頁區塊（由上到下）：**

1. **報名管理**
   - 切換檢視：依人名（`person`）/ 依時段（`slot`）
   - 依人名：每人一張卡片，顯示已選時段數 + token，點擊開啟時間軸編輯 modal
   - 依時段：TIME_BLOCKS 時間軸，每格顯示人數 + hover tooltip
   - 快速新增（單筆 / 批次姓名）
   - 新增後可點擊打開時間軸為該人分配時段

2. **活動設定**
   - 活動名稱（inline 編輯，Enter 儲存到 Firestore）
   - 活動日期（文字輸入，即時儲存到 Firestore）
   - 結束時間（16:00–20:00 按鈕切換）
   - 主題配色（5 組按鈕切換）

3. **統計資料**
   - 3 欄統計卡（總圈數 / 參加人數 / 登記時段數）
   - 各時段圈數長條圖
   - 個人排行表格
   - CSV 匯出按鈕

4. **資料清除**
   - 清除所有報名（Firestore batch delete）
   - 清除所有圈數記錄（localStorage clear）

---

## 重要 State 一覽

| State | 型別 | 儲存位置 | 說明 |
|---|---|---|---|
| `signups` | `Array` | Firestore `signups/` | 所有報名（即時監聽） |
| `eventName` | `string` | Firestore `settings/main` | 活動名稱 |
| `eventDate` | `string` | Firestore `settings/main` | 活動日期 |
| `extraEndHour` | `number` | Firestore `settings/main` | 結束時間 16–20 |
| `skinKey` | `string` | localStorage `loverun_skin` | 主題 key |
| `lapRecords` | `Array` | localStorage `loverun_lapRecords` | 圈數記錄 |
| `participants` | `Array` | localStorage `loverun_participants` | 參加者名單 |
| `schedules` | `Array` | localStorage `loverun_schedules` | 時段安排 |
| `signupStep` | `string` | memory | `'name'` / `'grid'` / `'done'` |
| `editToken` | `string\|null` | URL `?token=` | 修改模式 token |
| `adminUnlocked` | `boolean` | memory | 管理頁密碼解鎖 |
| `adminViewMode` | `string` | memory | `'person'` / `'slot'` |
| `displayRunner` | `string` | memory | 展示頁目前選擇的跑者 |
| `displayManualTime` | `string` | memory | 手動對時值 |
| `displayUseManualTime` | `boolean` | memory | 是否啟用手動對時 |
| `displayDrawerOpen` | `boolean` | memory | 個人統計面板開關 |

---

## 響應式佈局

| 裝置 | 寬度 | 佈局特徵 |
|---|---|---|
| 手機 | < 640px | 彈窗為 bottom-sheet（圓角上方滑出）、時段標籤 w-14、格子 38px |
| 平板 | 640–1023px | 彈窗置中 modal、時段標籤 w-16、格子 38px |
| PC | ≥ 1024px | 同平板，主內容 max-w-3xl 置中 |

**展示頁**在所有裝置上為全寬，全螢幕時 `fixed inset-0 z-50`。

---

## 共用常數與元件

| 名稱 | 說明 |
|---|---|
| `SKINS` | 5 組主題配色物件（含展示頁專屬 displayBg/displayAccent/displayCard） |
| `PAST_EVENTS` | 往年回顧資料（YouTube + Google Photos） |
| `BASE_BLOCKS` | 固定節課時間區塊（08:00–16:10） |
| `buildTimeBlocks(endHour)` | 依結束時間產生完整區塊列表 |
| `generateTimeSlots(endHour)` | 產生所有 5 分鐘格子 |
| `getSlotsInBlock(block, allSlots)` | 取某區塊內的格子 |
| `LABEL_STYLE` | 各時段類型的標籤 Tailwind class |
| `ICON_MAP` | 各時段類型的 emoji（☕ 🍱 😴 ⏰） |
| `Legend` | 圖例元件（綠黃橙紅藍色塊說明） |
| `genToken()` | 產生 8 碼英數 token |
| `getCurrentTime()` | 回傳 `HH:MM:SS` 格式 |

---

## 本地開發

```bash
# 安裝依賴
npm install

# 啟動開發伺服器
npm run dev
# 開啟 http://localhost:3000

# 建置
npm run build
```

需確保 `.env.local` 存在並填入正確的 7 個環境變數。

---

## 部署

### Vercel（CLI 部署）

> ⚠️ Vercel 使用 CLI 部署，不使用 GitHub 自動部署（帳號 email 不符問題）。  
> ⚠️ Node.js 版本必須為 20.x（已透過 API 設定 + `package.json engines`）。

```bash
npx vercel --prod
```

### Netlify（GitHub 自動部署）

GitHub push 後 Netlify 自動觸發部署。設定檔為 `netlify.toml`，使用 `@netlify/plugin-nextjs` 插件。

---

## 已知問題 / 注意事項

1. **Vercel 自動部署不可用**：GitHub commit 作者 email 與 Vercel team 帳號不符，每次更新需手動 `npx vercel --prod`
2. **Node.js 24.x 不可用**：Next.js 14.0.4 在 Node 24.x 下 build 會失敗（0ms 無輸出），必須使用 20.x
3. **管理密碼在前端**：`NEXT_PUBLIC_ADMIN_PASSWORD` 僅作前端隱藏，非真正安全
4. **Firestore 規則全開**：任何人都可讀寫，依賴前端密碼保護管理功能
5. **Netlify secrets scanning**：`NEXT_PUBLIC_*` 被打包進 webpack bundle，Netlify 會誤判。已透過 `SECRETS_SCAN_OMIT_KEYS` 排除
6. **圈數記錄存 localStorage**：`lapRecords` 只在本機，不跨裝置同步。如需多裝置同步需改存 Firestore
7. **展示頁跑者來源**：合併 `participants` + `signups` + `lapRecords` 三個來源去重

---

## 功能清單

- [x] 報名登記（輸入姓名 → 選時段格子）
- [x] 系統自動建議最空時段
- [x] 每時段顯示目前人數（不限人數上限）
- [x] 修改碼（token）供報名者自行修改
- [x] URL `?token=` 直接進入修改模式
- [x] 管理頁密碼保護
- [x] 管理頁：依人名 / 依時段切換檢視
- [x] 管理頁：點姓名或格子開啟時間軸編輯視窗
- [x] 活動名稱 / 活動日期設定（Firestore 同步）
- [x] 延伸活動時間至最晚 20:00（預備時段）
- [x] 快速新增參加者（單筆 / 批次）
- [x] 報名資料 CSV 匯出
- [x] 5 組主題配色（localStorage 記憶）
- [x] 展示頁：全場總圈數大字展示（自適應字體）
- [x] 展示頁：選擇跑者 + 該跑者圈數大字
- [x] 展示頁：一鍵記圈 + 音效回饋
- [x] 展示頁：手動對時（解決裝置時鐘不同步）
- [x] 展示頁：底部排行快覽（前 8 名，金銀銅牌）
- [x] 展示頁：個人統計滑出面板（Drawer）
- [x] 展示頁：各圈明細可刪除
- [x] 展示頁：圈數記錄 CSV 匯出
- [x] 展示頁：全螢幕模式
- [x] 展示頁：skin-based 深色漸層背景 + 裝飾光暈
- [x] 大螢幕展示模式（全螢幕）
- [x] Firebase Firestore 即時同步
- [x] 環境變數保護 API key
- [x] Firestore 離線快取（IndexedDB persistence）
- [x] 往年活動回顧（YouTube embed + Google Photos）
- [x] UI 大圖示 iOS 風格
- [x] 響應式佈局（手機 bottom-sheet、平板/PC 適配）
- [x] Netlify 部署支援（secrets scan 排除）
- [x] 統計資料整合至管理頁
