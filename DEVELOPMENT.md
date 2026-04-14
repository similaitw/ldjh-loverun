# 羅東愛心路跑圈數記錄系統 — 開發文件

## 專案概覽

**專案名稱：** 羅東愛心路跑圈數記錄系統（ldjh-loverun）  
**用途：** 學校路跑活動現場使用，供學生登記跑步時段、管理員管理報名  
**GitHub：** https://github.com/similaitw/ldjh-loverun  
**正式網址：** https://luodong-love-run.vercel.app  

---

## 技術架構

| 項目 | 技術 |
|---|---|
| 框架 | Next.js 14.0.4 |
| UI | React 18.2.0 + Tailwind CSS 3.3.6 |
| 資料庫 | Firebase Firestore（雲端即時同步） |
| 部署 | Vercel（CLI 部署）/ Netlify（GitHub 自動部署） |
| 離線快取 | Firestore IndexedDB persistence |

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
├── loverun-tracker.jsx      # 核心元件（所有邏輯都在這）
├── .env.local               # 本地環境變數（不進 git）
├── .gitignore
├── netlify.toml             # Netlify 部署設定
├── next.config.js
├── package.json
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

> 實際值請從 Firebase Console → 專案設定 → 您的應用程式 取得，或複製既有的 `.env.local`。
> `NEXT_PUBLIC_ADMIN_PASSWORD` 為管理頁登入密碼。

### Vercel 生產環境

Vercel 專案 `luodong-love-run` → Settings → Environment Variables  
（已設定上述七個變數）

### Netlify 生產環境

Netlify 站台 → Site configuration → Environment variables  
（需設定上述七個變數）

> `NEXT_PUBLIC_*` 變數會被 Next.js 打包進前端 JS bundle（設計如此）。  
> `netlify.toml` 已設定 `SECRETS_SCAN_OMIT_KEYS` 避免 Netlify secrets scanning 誤判阻擋 build。

---

## Firebase 設定

**專案 ID：** ldjh-loverun  
**Console：** https://console.firebase.google.com/project/ldjh-loverun  

### Firestore 資料結構

```
signups/
  {token}/          # 每筆報名，以 token 為 document ID
    id: number
    name: string
    token: string   # 8碼英數，供報名者修改用
    slots: string[] # 例：['08:00','08:05','09:15']
    createdAt: number

settings/
  main/
    eventName: string       # 活動名稱
    extraEndHour: number    # 活動結束時間（16–20）
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

---

## 核心元件：`loverun-tracker.jsx`

### 頁籤結構

| key | 名稱 | 說明 |
|---|---|---|
| `signup` | 報名登記 | 輸入姓名 → 選時段 → 完成，顯示登記總覽 |
| `stats` | 統計資料 | 圈數統計（目前較少用） |
| `display` | 展示 | 大螢幕展示模式，可全螢幕 |
| `admin` | 管理 | 需密碼，管理報名、設定、清資料 |

### 時間區塊（TIME_BLOCKS）

| 類型 | 顏色 | 說明 |
|---|---|---|
| `free` | 灰 | 課前（08:00–08:20） |
| `period` | 白 | 第一節～第七節 |
| `break` | 灰淡 | 下課（含 ☕ 圖示） |
| `meal` | 琥珀 | 午餐 11:50–12:30（含 🍱） |
| `rest` | 紫 | 午休 12:30–13:30（含 😴） |
| `extra` | 青 | 預備時段，16:10 後延伸（含 ⏰） |

### 時段格子顏色規則（不限人數）

| 顏色 | 條件 |
|---|---|
| 綠 | 0 人 |
| 黃 | 1–2 人 |
| 橙 | 3–4 人 |
| 紅 | 5 人以上 |
| 藍 | 已選取（自己） |

### 響應式佈局

| 裝置 | 寬度 | 佈局特徵 |
|---|---|---|
| 手機 | < 640px | 彈窗為 bottom-sheet（圓角上方滑出）、格子 38px、標籤 w-12 |
| 平板 | 640–1023px | 彈窗置中、格子 38px、標籤 w-14 |
| PC | ≥ 1024px | 同平板，主內容 max-w-3xl 置中 |

### 共用常數

- `LABEL_STYLE`：各時段類型的標籤樣式（顏色、邊框）
- `ICON_MAP`：各時段類型的圖示（☕ 🍱 😴 ⏰）
- `Legend` 元件：圖例說明（綠黃橙紅 = 人數）

### 重要 State

```javascript
signups          // 所有報名（從 Firestore 即時監聽）
eventName        // 活動名稱（Firestore settings/main）
extraEndHour     // 活動結束時間 16–20（Firestore settings/main）
signupStep       // 'name' | 'grid' | 'done'
editToken        // URL ?token= 進入修改模式
adminUnlocked    // 管理頁密碼解鎖狀態
adminViewMode    // 'person' | 'slot'（管理頁報名檢視方式）
```

### 管理密碼

> 管理密碼透過 `NEXT_PUBLIC_ADMIN_PASSWORD` 環境變數注入，於 `loverun-tracker.jsx` 中讀取。請勿將密碼明文寫入程式碼或文件。

---


## 資料儲存說明

| 資料 | 儲存位置 | 說明 |
|---|---|---|
| 報名登記 | Firestore | 多裝置即時同步 |
| 活動名稱 | Firestore | 多裝置即時同步 |
| 活動結束時間 | Firestore | 多裝置即時同步 |
| 參加者名單 | localStorage | 管理員本機 |
| 時段安排 | localStorage | 管理員本機 |
| 圈數記錄 | localStorage | 管理員本機 |

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

需確保 `.env.local` 存在並填入正確的 Firebase 設定。

---

## 部署

### Vercel（CLI 部署）

> 注意：Vercel 使用 CLI 部署，不使用 GitHub 自動部署（帳號 email 不符問題）

```bash
npx vercel --prod
```

### Netlify（GitHub 自動部署）

GitHub push 後 Netlify 自動觸發部署。設定檔為 `netlify.toml`，使用 `@netlify/plugin-nextjs` 插件。

---

## 已知問題 / 注意事項

1. **Vercel 自動部署不可用**：GitHub commit 作者 email（similai@gmail.com）與 Vercel team 帳號不符，每次更新需手動執行 `npx vercel --prod`
2. **管理密碼在前端**：管理密碼透過 `NEXT_PUBLIC_ADMIN_PASSWORD` 環境變數注入，僅作前端隱藏，非真正安全。若需更高安全性需加 Firebase Authentication
3. **Firestore 規則全開**：目前任何人都可讀寫，依賴前端密碼保護管理功能
4. **Netlify secrets scanning**：`NEXT_PUBLIC_*` 變數被 Next.js 打包進 webpack bundle，Netlify 會誤判為洩漏密鑰。已透過 `SECRETS_SCAN_OMIT_KEYS` 排除

---

## 功能清單

- [x] 報名登記（輸入姓名 → 選時段格子）
- [x] 系統自動建議最空時段
- [x] 每時段顯示目前人數（不限人數上限）
- [x] 修改碼（token）供報名者自行修改
- [x] URL ?token= 直接進入修改模式
- [x] 管理頁密碼保護
- [x] 管理頁：依人名 / 依時段切換檢視
- [x] 管理頁：點姓名或格子開啟時間軸編輯視窗
- [x] 活動名稱設定
- [x] 延伸活動時間至最晚 20:00（預備時段）
- [x] 快速新增參加者（單筆 / 批次）
- [x] 報名資料 CSV 匯出
- [x] 大螢幕展示模式（全螢幕）
- [x] Firebase Firestore 即時同步
- [x] 環境變數保護 API key
- [x] Firestore 離線快取（IndexedDB persistence）
- [x] UI 美化（漸層配色、統計卡片、慶祝頁面）
- [x] 響應式佈局（手機 bottom-sheet、平板/PC 適配）
- [x] Netlify 部署支援（secrets scan 排除）
