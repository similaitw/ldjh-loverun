import { useState, useEffect, useRef, useCallback } from 'react'
import { db } from './lib/firebase'
import {
  collection, doc, onSnapshot,
  setDoc, deleteDoc, writeBatch
} from 'firebase/firestore'
import {
  Activity, Palette, ClipboardList, Monitor, Settings, Users, CalendarCheck, Sparkles,
  ClipboardSignature, Lightbulb, PartyPopper, Pencil, KeyRound, Copy, BarChart3,
  FileDown, Clapperboard, Play, Camera, Coffee, Utensils, Moon, Clock, Watch,
  Lock, Unlock, Check, XCircle, Trash2, AlertTriangle, ChevronRight, ArrowRight, X
} from 'lucide-react'

// 依結束時間產生時段列表（08:00 起，每5分鐘）
const generateTimeSlots = (endHour = 16) => {
  const slots = []
  for (let hour = 8; hour < endHour; hour++) {
    for (let minute = 0; minute < 60; minute += 5) {
      slots.push(`${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`)
    }
  }
  return slots
}

// 固定節課區塊（08:00–16:10）
const BASE_BLOCKS = [
  { type: 'free',   label: '課前',   start: '08:00', end: '08:20' },
  { type: 'period', label: '第一節', start: '08:20', end: '09:05' },
  { type: 'break',  label: '下課',   start: '09:05', end: '09:15' },
  { type: 'period', label: '第二節', start: '09:15', end: '10:00' },
  { type: 'break',  label: '下課',   start: '10:00', end: '10:10' },
  { type: 'period', label: '第三節', start: '10:10', end: '10:55' },
  { type: 'break',  label: '下課',   start: '10:55', end: '11:05' },
  { type: 'period', label: '第四節', start: '11:05', end: '11:50' },
  { type: 'meal',   label: '午餐',   start: '11:50', end: '12:30' },
  { type: 'rest',   label: '午休',   start: '12:30', end: '13:30' },
  { type: 'period', label: '第五節', start: '13:30', end: '14:15' },
  { type: 'break',  label: '下課',   start: '14:15', end: '14:25' },
  { type: 'period', label: '第六節', start: '14:25', end: '15:10' },
  { type: 'break',  label: '下課',   start: '15:10', end: '15:25' },
  { type: 'period', label: '第七節', start: '15:25', end: '16:10' },
]

// 依結束時間動態產生完整區塊列表（16:10 後補預備時段）
const buildTimeBlocks = (endHour = 16) => {
  if (endHour <= 16) return BASE_BLOCKS
  const extra = []
  // 16:10 之後到 endHour，每小時一個預備時段區塊
  for (let h = 16; h < endHour; h++) {
    const start = h === 16 ? '16:10' : `${h.toString().padStart(2,'0')}:00`
    const end   = `${(h + 1).toString().padStart(2,'0')}:00`
    extra.push({ type: 'extra', label: '預備', start, end })
  }
  return [...BASE_BLOCKS, ...extra]
}

// 取某區塊內所有 5 分鐘格（動態 slots）
const getSlotsInBlock = (block, allSlots) =>
  allSlots.filter(t => t >= block.start && t < block.end)

// 依小時分組（保留，供其他地方使用）
const groupByHour = (slots) => {
  const map = new Map()
  slots.forEach(t => {
    const h = t.split(':')[0]
    if (!map.has(h)) map.set(h, [])
    map.get(h).push(t)
  })
  return map
}

const getCurrentTime = () => {
  const now = new Date()
  return `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`
}
const getCurrentTimeDisplay = () => new Date().toLocaleTimeString('zh-TW', { hour12: false })

const formatDuration = (seconds) => {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return [h, m, s].map((v, i) => i === 0 ? String(v).padStart(2, '0') : String(v).padStart(2, '0')).join(':')
}

const parseTodayTime = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  const now = new Date()
  const parsed = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0)
  return parsed.getTime()
}

// 產生 token（8位隨機英數）
const genToken = () => String(Math.floor(1000 + Math.random() * 9000))

const BEEP_SOUND = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmEfAzuM1O/1dy0FIHfI7NyOPggXZbjmqqtVFgw+ltv7w3QpBSmBzvHYhTZJQJ7Y8LlqHAY3kNTv1XIqBSl8xuzcjTwIC2m06vKVVQwNUKzlmn7tBA=='

// 每時段不限人數，純顯示用
const MAX_PER_SLOT = 0 // 已停用，保留供參考

// ── 主題 Skin ──
const SKINS = {
  ocean:  { name: '深海藍', iconColor: 'text-blue-600', header: 'linear-gradient(135deg, #1e3a5f 0%, #1d4ed8 50%, #0891b2 100%)', page: 'from-slate-200 via-blue-100 to-cyan-100', accent: 'blue', tabActive: 'bg-white text-blue-700 shadow-md', tabInactive: 'text-blue-100 hover:bg-white/20', subtextHeader: 'text-blue-200', badgeColor: 'text-yellow-300', btnGrad: 'from-blue-600 to-blue-500', btnHover: 'hover:from-blue-700 hover:to-blue-600', cardGrad: 'linear-gradient(135deg, #1e3a5f 0%, #1d4ed8 60%, #0891b2 100%)', adminGrad: 'linear-gradient(135deg, #1e3a5f 0%, #1d4ed8 100%)', statCards: ['from-blue-500 to-blue-600','from-emerald-500 to-emerald-600','from-violet-500 to-violet-600'], displayBg: 'linear-gradient(135deg, #0c1929 0%, #1e3a5f 30%, #1d4ed8 70%, #0891b2 100%)', displayAccent: '#38bdf8', displayCard: 'rgba(30,58,95,0.85)' },
  sunset: { name: '日落橙', iconColor: 'text-orange-600', header: 'linear-gradient(135deg, #7c2d12 0%, #ea580c 50%, #f59e0b 100%)', page: 'from-orange-100 via-amber-100 to-yellow-100', accent: 'orange', tabActive: 'bg-white text-orange-700 shadow-md', tabInactive: 'text-orange-100 hover:bg-white/20', subtextHeader: 'text-orange-200', badgeColor: 'text-yellow-200', btnGrad: 'from-orange-600 to-amber-500', btnHover: 'hover:from-orange-700 hover:to-amber-600', cardGrad: 'linear-gradient(135deg, #7c2d12 0%, #ea580c 60%, #f59e0b 100%)', adminGrad: 'linear-gradient(135deg, #7c2d12 0%, #ea580c 100%)', statCards: ['from-orange-500 to-orange-600','from-amber-500 to-amber-600','from-rose-500 to-rose-600'], displayBg: 'linear-gradient(135deg, #431407 0%, #7c2d12 30%, #ea580c 70%, #f59e0b 100%)', displayAccent: '#fb923c', displayCard: 'rgba(124,45,18,0.85)' },
  forest: { name: '森林綠', iconColor: 'text-green-600', header: 'linear-gradient(135deg, #14532d 0%, #16a34a 50%, #22d3ee 100%)', page: 'from-green-100 via-emerald-100 to-teal-100', accent: 'green', tabActive: 'bg-white text-green-700 shadow-md', tabInactive: 'text-green-100 hover:bg-white/20', subtextHeader: 'text-green-200', badgeColor: 'text-yellow-300', btnGrad: 'from-green-600 to-emerald-500', btnHover: 'hover:from-green-700 hover:to-emerald-600', cardGrad: 'linear-gradient(135deg, #14532d 0%, #16a34a 60%, #22d3ee 100%)', adminGrad: 'linear-gradient(135deg, #14532d 0%, #16a34a 100%)', statCards: ['from-green-500 to-green-600','from-teal-500 to-teal-600','from-cyan-500 to-cyan-600'], displayBg: 'linear-gradient(135deg, #052e16 0%, #14532d 30%, #16a34a 70%, #22d3ee 100%)', displayAccent: '#4ade80', displayCard: 'rgba(20,83,45,0.85)' },
  sakura: { name: '櫻花粉', iconColor: 'text-pink-600', header: 'linear-gradient(135deg, #831843 0%, #db2777 50%, #f472b6 100%)', page: 'from-pink-100 via-rose-100 to-fuchsia-100', accent: 'pink', tabActive: 'bg-white text-pink-700 shadow-md', tabInactive: 'text-pink-100 hover:bg-white/20', subtextHeader: 'text-pink-200', badgeColor: 'text-yellow-200', btnGrad: 'from-pink-600 to-rose-500', btnHover: 'hover:from-pink-700 hover:to-rose-600', cardGrad: 'linear-gradient(135deg, #831843 0%, #db2777 60%, #f472b6 100%)', adminGrad: 'linear-gradient(135deg, #831843 0%, #db2777 100%)', statCards: ['from-pink-500 to-pink-600','from-rose-500 to-rose-600','from-fuchsia-500 to-fuchsia-600'], displayBg: 'linear-gradient(135deg, #500724 0%, #831843 30%, #db2777 70%, #f472b6 100%)', displayAccent: '#f9a8d4', displayCard: 'rgba(131,24,67,0.85)' },
  night:  { name: '暗夜紫', iconColor: 'text-purple-600', header: 'linear-gradient(135deg, #312e81 0%, #7c3aed 50%, #a855f7 100%)', page: 'from-violet-100 via-purple-100 to-indigo-100', accent: 'purple', tabActive: 'bg-white text-purple-700 shadow-md', tabInactive: 'text-purple-100 hover:bg-white/20', subtextHeader: 'text-purple-200', badgeColor: 'text-yellow-300', btnGrad: 'from-purple-600 to-violet-500', btnHover: 'hover:from-purple-700 hover:to-violet-600', cardGrad: 'linear-gradient(135deg, #312e81 0%, #7c3aed 60%, #a855f7 100%)', adminGrad: 'linear-gradient(135deg, #312e81 0%, #7c3aed 100%)', statCards: ['from-purple-500 to-purple-600','from-violet-500 to-violet-600','from-indigo-500 to-indigo-600'], displayBg: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 30%, #7c3aed 70%, #a855f7 100%)', displayAccent: '#c084fc', displayCard: 'rgba(49,46,129,0.85)' },
}

// ── 往年回顧資料 ──
const PAST_EVENTS = [
  { year: '往年', type: 'video', title: '羅東愛心路跑精彩回顧', url: 'https://www.youtube.com/watch?v=9HWyDIqItB4', embedId: '9HWyDIqItB4' },
  { year: '往年', type: 'album', title: '活動照片集', url: 'https://photos.app.goo.gl/ofwnpgqwH3dgF2mB7' },
]

// 模擬時鐘元件
const AnalogClock = ({ time }) => {
  const [hours, minutes, seconds] = time.split(':').map(Number)
  const hourAngle = (hours % 12) * 30 + minutes * 0.5
  const minuteAngle = minutes * 6
  const secondAngle = seconds * 6

  return (
    <svg width="100%" height="100%" viewBox="0 0 100 100" className="text-white">
      {/* 時鐘外框 */}
      <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.3"/>
      
      {/* 刻度 */}
      {[...Array(12)].map((_, i) => {
        const angle = i * 30 - 90
        const x1 = 50 + 35 * Math.cos(angle * Math.PI / 180)
        const y1 = 50 + 35 * Math.sin(angle * Math.PI / 180)
        const x2 = 50 + 40 * Math.cos(angle * Math.PI / 180)
        const y2 = 50 + 40 * Math.sin(angle * Math.PI / 180)
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="currentColor"
            strokeWidth="2"
            opacity="0.6"
          />
        )
      })}
      
      {/* 時針 */}
      <line
        x1="50"
        y1="50"
        x2={50 + 20 * Math.cos((hourAngle - 90) * Math.PI / 180)}
        y2={50 + 20 * Math.sin((hourAngle - 90) * Math.PI / 180)}
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      
      {/* 分針 */}
      <line
        x1="50"
        y1="50"
        x2={50 + 30 * Math.cos((minuteAngle - 90) * Math.PI / 180)}
        y2={50 + 30 * Math.sin((minuteAngle - 90) * Math.PI / 180)}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      
      {/* 秒針 */}
      <line
        x1="50"
        y1="50"
        x2={50 + 35 * Math.cos((secondAngle - 90) * Math.PI / 180)}
        y2={50 + 35 * Math.sin((secondAngle - 90) * Math.PI / 180)}
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
      
      {/* 中心點 */}
      <circle cx="50" cy="50" r="2" fill="currentColor"/>
    </svg>
  )
}

export default function LoveRunTracker() {
  const [participants, setParticipants] = useState([])
  const [schedules, setSchedules] = useState([])
  const [lapRecords, setLapRecords] = useState([])
  // signups: { id, name, token, slots: ['08:00','08:05',...], note, createdAt }
  const [signups, setSignups] = useState([])
  const [eventName, setEventName] = useState('羅東愛心路跑')
  const [eventDate, setEventDate] = useState('')
  const [activeTab, setActiveTab] = useState('signup')
  const [skinKey, setSkinKey] = useState('ocean')
  const [currentParticipant, setCurrentParticipant] = useState('')
  const [currentSchedule, setCurrentSchedule] = useState('')
  const [currentTime, setCurrentTime] = useState('')
  const [isFullscreen, setIsFullscreen] = useState(false)

  // 展示頁圈數記錄
  const [displayRunner, setDisplayRunner] = useState('')    // 目前選擇的跑者
  const [displayManualTime, setDisplayManualTime] = useState('')  // 手動時間覆蓋
  const [displayUseManualTime, setDisplayUseManualTime] = useState(false) // 是否使用手動時間
  const [displayDrawerOpen, setDisplayDrawerOpen] = useState(false) // 個人統計滑出面板
  const [displayLeftOpen, setDisplayLeftOpen] = useState(false)   // 手機版左側跑者面板
  const [displayRightOpen, setDisplayRightOpen] = useState(false) // 手機版右側順序面板
  const [completedRunners, setCompletedRunners] = useState([])    // 已完成的跑者 key（token 或 name）
  const [displayBgIndex, setDisplayBgIndex] = useState(() => Math.floor(Math.random() * 9) + 1) // 1..9

  // 報名流程狀態
  const [signupStep, setSignupStep] = useState('name') // 'name' | 'grid' | 'done'
  const [signupNameInput, setSignupNameInput] = useState('')
  const [signupSelectedSlots, setSignupSelectedSlots] = useState([]) // 本次選擇的時段
  const [signupToken, setSignupToken] = useState('')        // 完成後的 token
  const [signupDoneToken, setSignupDoneToken] = useState('') // 顯示給用戶的 token
  const [signupSubmitting, setSignupSubmitting] = useState(false) // 送出中
  const [signupError, setSignupError] = useState('')        // 送出錯誤訊息
  const [hoveredSlot, setHoveredSlot] = useState(null)      // 首頁總覽 hover 的時段

  // 修改模式：從 URL token 進入
  const [editToken, setEditToken] = useState(null)
  const [editRecord, setEditRecord] = useState(null)

  // 計時器
  const [timerStart, setTimerStart] = useState(null)
  const [timerRunning, setTimerRunning] = useState(false)

  // 時鐘顯示模式
  const [clockDisplayMode, setClockDisplayMode] = useState('digital') // 'digital' | 'analog'

  // 手動修改圈數彈窗
  const [showEditLapModal, setShowEditLapModal] = useState(false)
  const [editLapRunner, setEditLapRunner] = useState('')
  const [editLapNumber, setEditLapNumber] = useState('')
  const [editLapTime, setEditLapTime] = useState('')
  const [editLapAdjustment, setEditLapAdjustment] = useState('')
  const [editLapError, setEditLapError] = useState('')

  // 參加者管理
  const [newParticipantName, setNewParticipantName] = useState('')
  const [bulkParticipants, setBulkParticipants] = useState('')
  const [editingParticipant, setEditingParticipant] = useState(null)
  const [editParticipantName, setEditParticipantName] = useState('')

  // 時段管理
  const [newSchedule, setNewSchedule] = useState({ class: '', time: '08:00', duration: 30 })
  const [editingSchedule, setEditingSchedule] = useState(null)

  // 管理
  const [editingEventName, setEditingEventName] = useState(false)
  const [tempEventName, setTempEventName] = useState('')
  const [extraEndHour, setExtraEndHour] = useState(16)  // 活動結束時間（小時）
  const [adminUnlocked, setAdminUnlocked] = useState(false)
  const [adminPwInput, setAdminPwInput] = useState('')
  const [adminPwError, setAdminPwError] = useState(false)
  const ADMIN_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD

  // 確認對話框
  const [confirmDialog, setConfirmDialog] = useState(null) // { title, message, onConfirm, onCancel }

  // 工具提示
  const [tooltip, setTooltip] = useState(null) // { text, x, y }

  // 管理頁報名視窗
  const [adminGridToken, setAdminGridToken] = useState(null)   // 正在管理的 token
  const [adminGridSlots, setAdminGridSlots] = useState([])     // 暫存修改中的時段
  const [adminViewMode, setAdminViewMode] = useState('person') // 'person' | 'slot'

  // 查詢自己時段彈窗
  const [queryToken, setQueryToken] = useState('')             // 查詢輸入
  const [queryResult, setQueryResult] = useState(null)         // 查詢結果記錄
  const [queryError, setQueryError] = useState('')             // 查詢錯誤訊息

  const audioRef = useRef(null)
  const displayRef = useRef(null)
  const runnerListRef = useRef(null)

  // ── 本地資料（localStorage） ──
  useEffect(() => {
    try {
      const p = localStorage.getItem('loverun_participants')
      const sc = localStorage.getItem('loverun_schedules')
      const lr = localStorage.getItem('loverun_lapRecords')
      const ts = localStorage.getItem('loverun_timerStart')
      if (p) setParticipants(JSON.parse(p))
      if (sc) setSchedules(JSON.parse(sc))
      if (lr) setLapRecords(JSON.parse(lr))
      if (ts) {
        const start = parseInt(ts)
        if (!Number.isNaN(start)) {
          setTimerStart(start)
          setTimerRunning(true)
        }
      }
      const sk = localStorage.getItem('loverun_skin')
      if (sk && SKINS[sk]) setSkinKey(sk)
      const cdm = localStorage.getItem('loverun_clockDisplayMode')
      if (cdm === 'analog' || cdm === 'digital') setClockDisplayMode(cdm)
      const cr = localStorage.getItem('loverun_completedRunners')
      if (cr) setCompletedRunners(JSON.parse(cr))
    } catch (e) {}
  }, [])

  useEffect(() => { localStorage.setItem('loverun_participants', JSON.stringify(participants)) }, [participants])
  useEffect(() => { localStorage.setItem('loverun_schedules', JSON.stringify(schedules)) }, [schedules])
  useEffect(() => { localStorage.setItem('loverun_lapRecords', JSON.stringify(lapRecords)) }, [lapRecords])
  useEffect(() => { localStorage.setItem('loverun_skin', skinKey) }, [skinKey])
  useEffect(() => { localStorage.setItem('loverun_clockDisplayMode', clockDisplayMode) }, [clockDisplayMode])
  useEffect(() => { localStorage.setItem('loverun_completedRunners', JSON.stringify(completedRunners)) }, [completedRunners])
  // 圈數（lapRecords）有變化時，隨機切換一張不同的展示背景
  useEffect(() => {
    setDisplayBgIndex(prev => {
      let next = prev
      while (next === prev) next = Math.floor(Math.random() * 9) + 1
      return next
    })
  }, [lapRecords.length])
  useEffect(() => {
    if (timerStart) localStorage.setItem('loverun_timerStart', String(timerStart))
    else localStorage.removeItem('loverun_timerStart')
  }, [timerStart])

  const skin = SKINS[skinKey]

  // ── Firestore 即時監聽：報名資料 ──
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'signups'), (snapshot) => {
      const data = snapshot.docs.map(d => d.data())
      setSignups(data)
    })
    return () => unsub()
  }, [])

  // ── Firestore 即時監聽：設定（活動名稱、日期、結束時間） ──
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'main'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data()
        if (data.eventName) setEventName(data.eventName)
        if (data.eventDate !== undefined) setEventDate(data.eventDate || '')
        if (data.extraEndHour) setExtraEndHour(data.extraEndHour)
      }
    })
    return () => unsub()
  }, [])

  // ── 寫回 Firestore：活動名稱 ──
  const saveEventName = async (name) => {
    setEventName(name)
    await setDoc(doc(db, 'settings', 'main'), { eventName: name }, { merge: true })
  }

  // ── 寫回 Firestore：活動日期 ──
  const saveEventDate = async (d) => {
    setEventDate(d)
    await setDoc(doc(db, 'settings', 'main'), { eventDate: d }, { merge: true })
  }

  // ── 寫回 Firestore：結束時間 ──
  const saveExtraEndHour = async (h) => {
    setExtraEndHour(h)
    await setDoc(doc(db, 'settings', 'main'), { extraEndHour: h }, { merge: true })
  }

  // ── 從 URL 讀取 token（修改模式）──
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const t = params.get('token')
    if (t) {
      setEditToken(t)
      setActiveTab('signup')
    }
  }, [])

  // token 有值時找對應記錄
  useEffect(() => {
    if (!editToken) { setEditRecord(null); return }
    const rec = signups.find(s => s.token === editToken)
    if (rec) {
      setEditRecord(rec)
      setSignupNameInput(rec.name)
      setSignupSelectedSlots([...rec.slots])
      setSignupStep('grid')
    } else {
      setEditRecord(null)
    }
  }, [editToken, signups])

  // ── 時鐘 ──
  useEffect(() => {
    setCurrentTime(getCurrentTimeDisplay())
    const t = setInterval(() => setCurrentTime(getCurrentTimeDisplay()), 1000)
    return () => clearInterval(t)
  }, [])

  // ── 快捷鍵 ──
  useEffect(() => {
    const h = (e) => {
      if (activeTab === 'recording' && (e.code === 'Space' || e.code === 'Enter') && currentParticipant && currentSchedule) {
        e.preventDefault(); recordLap()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [activeTab, currentParticipant, currentSchedule, lapRecords, schedules])

  const playBeep = () => { if (audioRef.current) { audioRef.current.currentTime = 0; audioRef.current.play().catch(() => {}) } }

  const startTimer = () => {
    if (timerRunning) return
    const now = Date.now()
    setTimerStart(now)
    setTimerRunning(true)
  }

  const resetTimer = () => {
    setTimerStart(null)
    setTimerRunning(false)
  }

  const elapsedSeconds = timerStart ? Math.max(0, Math.floor((Date.now() - timerStart) / 1000)) : 0
  const elapsedTimeDisplay = formatDuration(elapsedSeconds)

  const getRunnerExpectedSlot = (name) => {
    const signup = signups.find(s => s.name === name)
    if (!signup || !signup.slots?.length) return null
    return [...signup.slots].sort()[0]
  }

  const getRunnerScheduleDelta = (name) => {
    const slot = getRunnerExpectedSlot(name)
    if (!slot || !timerStart) return null
    const expected = parseTodayTime(slot)
    const diff = Math.round((Date.now() - expected) / 60000)
    return diff
  }

  const getRunnerOrder = () => {
    return signups
      .map(s => ({ ...s, earliestSlot: s.slots?.length ? [...s.slots].sort()[0] : '99:99' }))
      .sort((a, b) => {
        if (a.earliestSlot === b.earliestSlot) return a.name.localeCompare(b.name, 'zh-TW')
        return a.earliestSlot.localeCompare(b.earliestSlot)
      })
  }

  const getDisplayRunnerGroups = () => {
    const runnerOrder = getRunnerOrder().map(r => ({
      ...r,
      key: r.token || r.name,
      sortedSlots: r.slots?.length ? [...r.slots].sort() : [],
    }))
    const scheduledRunners = runnerOrder.filter(r => r.sortedSlots.length > 0)
    const unscheduledRunners = runnerOrder.filter(r => r.sortedSlots.length === 0)
    const runnerByKey = new Map(scheduledRunners.map(r => [r.key, r]))
    const slotToRunnerKeys = new Map()

    scheduledRunners.forEach(runner => {
      runner.sortedSlots.forEach(slot => {
        if (!slotToRunnerKeys.has(slot)) slotToRunnerKeys.set(slot, [])
        slotToRunnerKeys.get(slot).push(runner.key)
      })
    })

    const visited = new Set()
    const groups = []

    scheduledRunners.forEach(runner => {
      if (visited.has(runner.key)) return
      const queue = [runner.key]
      const memberKeys = new Set()
      const slotSet = new Set()

      while (queue.length > 0) {
        const currentKey = queue.shift()
        if (visited.has(currentKey)) continue
        visited.add(currentKey)
        const currentRunner = runnerByKey.get(currentKey)
        if (!currentRunner) continue
        memberKeys.add(currentKey)
        currentRunner.sortedSlots.forEach(slot => {
          slotSet.add(slot)
          ;(slotToRunnerKeys.get(slot) || []).forEach(relatedKey => {
            if (!visited.has(relatedKey)) queue.push(relatedKey)
          })
        })
      }

      const members = runnerOrder.filter(candidate => memberKeys.has(candidate.key))
      const slots = [...slotSet].sort()
      groups.push({
        earliestSlot: slots[0] || '99:99',
        members,
        slotLabel: slots.length <= 1 ? (slots[0] || '未指定時段') : `${slots[0]} ~ ${slots[slots.length - 1]}`,
      })
    })

    if (unscheduledRunners.length > 0) {
      groups.push({
        earliestSlot: '99:99',
        members: unscheduledRunners,
        slotLabel: '未指定時段',
      })
    }

    return groups
      .sort((a, b) => {
        if (a.earliestSlot === b.earliestSlot) {
          const aName = a.members[0]?.name || ''
          const bName = b.members[0]?.name || ''
          return aName.localeCompare(bName, 'zh-TW')
        }
        return a.earliestSlot.localeCompare(b.earliestSlot)
      })
      .map((group, index) => ({ ...group, rank: index + 1 }))
  }

  // ══════════════════════════════
  // 報名邏輯
  // ══════════════════════════════

  // 取得某時段的所有登記（不含正在修改的自己）
  const getSlotSignups = useCallback((slot) => {
    return signups.filter(s => s.slots.includes(slot) && s.token !== editToken)
  }, [signups, editToken])

  // 時段格子狀態（不限人數，只依人數多寡顯示顏色）
  const slotStatus = useCallback((slot) => {
    const count = getSlotSignups(slot).length
    if (count === 0) return 'empty'
    if (count <= 2) return 'few'
    if (count <= 4) return 'some'
    return 'many'
  }, [getSlotSignups])

  // 點擊時段格子（不限人數，任何時段都可點選）
  const toggleSlot = (slot) => {
    const alreadySelected = signupSelectedSlots.includes(slot)
    setSignupSelectedSlots(prev =>
      alreadySelected ? prev.filter(s => s !== slot) : [...prev, slot]
    )
  }

  // 提交報名
  const submitSignup = async () => {
    const name = signupNameInput.trim()
    if (!name) { alert('請輸入姓名！'); return }
    if (signupSelectedSlots.length === 0) { alert('請至少選擇一個時段！'); return }

    setSignupSubmitting(true)
    setSignupError('')
    try {
      if (editRecord) {
        // 修改模式：更新既有記錄
        await setDoc(doc(db, 'signups', editToken), { ...editRecord, name, slots: [...signupSelectedSlots] })
        setSignupDoneToken(editToken)
      } else {
        // 新增
        const token = genToken()
        const record = { id: Date.now(), name, token, slots: [...signupSelectedSlots], createdAt: Date.now() }
        await setDoc(doc(db, 'signups', token), record)
        setSignupDoneToken(token)
      }
      setSignupStep('done')
    } catch (err) {
      setSignupError('儲存失敗，請確認網路連線後再試。')
      console.error('submitSignup error:', err)
    } finally {
      setSignupSubmitting(false)
    }
  }

  // 取消修改模式
  const cancelEdit = () => {
    setEditToken(null)
    setEditRecord(null)
    setSignupStep('name')
    setSignupNameInput('')
    setSignupSelectedSlots([])
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.delete('token')
      window.history.replaceState({}, '', url)
    }
  }

  // 刪除登記
  const deleteSignup = async (token) => {
    if (!confirm('確定要取消此登記？')) return
    await deleteDoc(doc(db, 'signups', token))
    cancelEdit()
  }

  // 取得修改連結
  const getEditLink = (token) => {
    if (typeof window === 'undefined') return ''
    const url = new URL(window.location.href)
    url.searchParams.set('token', token)
    return url.toString()
  }

  // 複製連結
  const copyLink = (token) => {
    const link = getEditLink(token)
    navigator.clipboard.writeText(link).then(() => alert('連結已複製！'))
  }

  // 開始新報名
  const startNewSignup = () => {
    setSignupStep('name')
    setSignupNameInput('')
    setSignupSelectedSlots([])
    setSignupDoneToken('')
    setEditToken(null)
    setEditRecord(null)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.delete('token')
      window.history.replaceState({}, '', url)
    }
  }

  // ══════════════════════════════
  // 參加者管理
  // ══════════════════════════════
  const addParticipant = () => {
    const name = newParticipantName.trim()
    if (!name) return
    if (participants.includes(name)) { alert(`「${name}」已存在！`); return }
    setParticipants([...participants, name])
    setNewParticipantName('')
  }

  const addBulkParticipants = () => {
    const names = bulkParticipants.split(/[,，\n]/).map(n => n.trim()).filter(Boolean)
    const duplicates = [], toAdd = []
    names.forEach(name => {
      if (participants.includes(name)) duplicates.push(name)
      else if (!toAdd.includes(name)) toAdd.push(name)
    })
    if (toAdd.length > 0) setParticipants([...participants, ...toAdd])
    setBulkParticipants('')
    if (duplicates.length > 0) alert(`以下名稱已存在，已略過：${duplicates.join('、')}`)
    else alert(`成功新增 ${toAdd.length} 位參加者！`)
  }

  const deleteParticipant = (name) => {
    if (!confirm(`確定要刪除「${name}」嗎？`)) return
    setParticipants(participants.filter(p => p !== name))
  }

  const saveEditParticipant = () => {
    const newName = editParticipantName.trim()
    if (!newName) return
    if (participants.includes(newName) && newName !== editingParticipant) { alert(`「${newName}」已存在！`); return }
    setParticipants(participants.map(p => p === editingParticipant ? newName : p))
    setLapRecords(lapRecords.map(r => r.participant === editingParticipant ? { ...r, participant: newName } : r))
    setSignups(signups.map(s => s.name === editingParticipant ? { ...s, name: newName } : s))
    setEditingParticipant(null); setEditParticipantName('')
  }

  // ══════════════════════════════
  // 時段管理
  // ══════════════════════════════
  const addSchedule = () => {
    if (!newSchedule.class.trim()) { alert('請輸入班級／活動名稱！'); return }
    setSchedules([...schedules, { id: Date.now(), class: newSchedule.class.trim(), time: newSchedule.time, duration: parseInt(newSchedule.duration) || 30 }])
    setNewSchedule({ class: '', time: '08:00', duration: 30 })
  }

  const deleteSchedule = (id) => {
    if (!confirm('確定要刪除此時段嗎？')) return
    setSchedules(schedules.filter(s => s.id !== id))
  }

  const saveEditSchedule = () => {
    if (!editingSchedule.class.trim()) return
    setSchedules(schedules.map(s => s.id === editingSchedule.id ? editingSchedule : s))
    setEditingSchedule(null)
  }

  // ══════════════════════════════
  // 圈數記錄
  // ══════════════════════════════
  const recordLap = useCallback(() => {
    if (!currentParticipant || !currentSchedule) return
    const schedule = schedules.find(s => s.id.toString() === currentSchedule)
    setLapRecords(prev => [...prev, {
      id: Date.now(), participant: currentParticipant,
      scheduleId: parseInt(currentSchedule), className: schedule?.class || '',
      time: getCurrentTime(), timestamp: Date.now(),
    }])
    playBeep()
  }, [currentParticipant, currentSchedule, schedules])

  const deleteLapRecord = (id) => setLapRecords(lapRecords.filter(r => r.id !== id))

  // 展示頁記圈（可手動對時）
  const recordDisplayLap = useCallback(() => {
    if (!displayRunner) return
    const time = displayUseManualTime && displayManualTime ? displayManualTime + ':00' : getCurrentTime()
    setLapRecords(prev => [...prev, {
      id: Date.now(), participant: displayRunner,
      scheduleId: 0, className: '展示記錄',
      time, timestamp: Date.now(),
    }])
    playBeep()
  }, [displayRunner, displayUseManualTime, displayManualTime])

  // 手動調整圈數
  const adjustLapCount = useCallback((adjustment) => {
    if (!displayRunner) return

    const adjustmentNum = parseInt(adjustment)
    if (isNaN(adjustmentNum) || adjustmentNum === 0) return

    const time = displayUseManualTime && displayManualTime ? displayManualTime + ':00' : getCurrentTime()

    if (adjustmentNum > 0) {
      // 增加圈數
      const newLaps = Array.from({ length: adjustmentNum }, (_, i) => ({
        id: Date.now() + i,
        participant: displayRunner,
        scheduleId: 0,
        className: '手動調整',
        time,
        timestamp: Date.now() + i,
      }))
      setLapRecords(prev => [...prev, ...newLaps])
    } else {
      // 減少圈數
      const runnerLaps = getRunnerLaps(displayRunner)
      const lapsToRemove = Math.min(Math.abs(adjustmentNum), runnerLaps.length)
      const sortedLaps = runnerLaps.sort((a, b) => b.timestamp - a.timestamp)
      const idsToRemove = sortedLaps.slice(0, lapsToRemove).map(lap => lap.id)
      setLapRecords(prev => prev.filter(r => !idsToRemove.includes(r.id)))
    }

    playBeep()
  }, [displayRunner, displayUseManualTime, displayManualTime])

  const saveLapModification = () => {
    if (!editLapRunner) {
      setEditLapError('請先選擇跑者。')
      return
    }
    const runnerLaps = getRunnerLaps(editLapRunner).sort((a, b) => a.timestamp - b.timestamp)
    let updated = [...lapRecords]
    let changed = false

    if (editLapNumber && editLapTime) {
      const index = parseInt(editLapNumber, 10) - 1
      if (index >= 0 && index < runnerLaps.length) {
        const lapToEdit = runnerLaps[index]
        updated = updated.map(r => r.id === lapToEdit.id ? { ...r, time: editLapTime, timestamp: Date.now() } : r)
        changed = true
      } else {
        setEditLapError('請選擇有效的圈數編號。')
        return
      }
    }

    const adjustment = parseInt(editLapAdjustment, 10)
    if (!Number.isNaN(adjustment) && adjustment !== 0) {
      if (adjustment > 0) {
        const time = displayUseManualTime && displayManualTime ? displayManualTime + ':00' : getCurrentTime()
        const newLaps = Array.from({ length: adjustment }, (_, i) => ({
          id: Date.now() + i,
          participant: editLapRunner,
          scheduleId: 0,
          className: '手動調整',
          time,
          timestamp: Date.now() + i,
        }))
        updated = [...updated, ...newLaps]
        changed = true
      } else {
        const removeCount = Math.min(Math.abs(adjustment), runnerLaps.length)
        const toRemoveIds = runnerLaps.slice(-removeCount).map(lap => lap.id)
        updated = updated.filter(r => !toRemoveIds.includes(r.id))
        changed = true
      }
    }

    if (!changed) {
      setEditLapError('請設定要修改的項目。')
      return
    }

    setLapRecords(updated)
    setShowEditLapModal(false)
    setEditLapError('')
    setEditLapAdjustment('')
    setEditLapNumber('')
    setEditLapTime('')
  }

  // 取得指定跑者的圈數
  const getRunnerLaps = (name) => lapRecords.filter(r => r.participant === name)

  // 匯出展示頁圈數記錄
  const exportDisplayLaps = () => {
    const allRunners = [...new Set(lapRecords.map(r => r.participant))].sort((a, b) => a.localeCompare(b, 'zh-TW'))
    const rows = [['姓名', '第幾圈', '記錄時間'].join(',')]
    allRunners.forEach(name => {
      const laps = getRunnerLaps(name).sort((a, b) => a.timestamp - b.timestamp)
      laps.forEach((lap, i) => rows.push([name, i + 1, lap.time].join(',')))
    })
    const csv = rows.join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `${eventName}_圈數記錄_${new Date().toISOString().split('T')[0]}.csv`; a.click()
  }

  // ══════════════════════════════
  // 統計
  // ══════════════════════════════
  const getParticipantStats = () => {
    const stats = {}
    lapRecords.forEach(r => {
      if (!stats[r.participant]) stats[r.participant] = { name: r.participant, totalLaps: 0, classes: new Set() }
      stats[r.participant].totalLaps++
      stats[r.participant].classes.add(r.className)
    })
    return Object.values(stats).map(s => ({ ...s, classes: Array.from(s.classes).join('、') }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'))
  }

  const getCurrentParticipantLaps = () => {
    if (!currentParticipant || !currentSchedule) return 0
    return lapRecords.filter(r => r.participant === currentParticipant && r.scheduleId.toString() === currentSchedule).length
  }

  // ══════════════════════════════
  // CSV 匯出
  // ══════════════════════════════
  const exportResults = () => {
    const s = getParticipantStats()
    const csv = [['姓名','總圈數','參與時段'].join(','), ...s.map(r => [r.name, r.totalLaps, r.classes].join(','))].join('\n')
    const blob = new Blob(['\ufeff'+csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `${eventName}_統計_${new Date().toISOString().split('T')[0]}.csv`; a.click()
  }

  const exportSignups = () => {
    const rows = []
    signups.forEach(s => s.slots.forEach(slot => rows.push([slot, s.name, s.token])))
    rows.sort((a, b) => a[0].localeCompare(b[0]))
    const csv = [['時段','姓名','修改碼'].join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob(['\ufeff'+csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `${eventName}_報名_${new Date().toISOString().split('T')[0]}.csv`; a.click()
  }

  // 產生通知單：每人一張，瀏覽器列印（可直接印或存 PDF）
  const printNotices = () => {
    if (signups.length === 0) { alert('目前沒有任何登記資料'); return }
    const sorted = [...signups].sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'))
    const dateText = eventDate || ''
    const escapeHtml = (str) => String(str).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))
    const cards = sorted.map((s, idx) => {
      const slots = [...s.slots].sort()
      const slotsHtml = slots.length
        ? slots.map(t => `<span class="slot">${escapeHtml(t)}</span>`).join('')
        : '<span class="no-slot">（未選擇時段）</span>'
      const isPageEnd = idx % 2 === 1
      return `
        <section class="notice${isPageEnd ? ' page-end' : ''}">
          <div class="deco deco-tl">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          </div>
          <div class="deco deco-br">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          </div>
          <header>
            <div class="badge">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </div>
            <div class="title">${escapeHtml(eventName)}</div>
            <div class="subtitle">報名通知單</div>
            ${dateText ? `<div class="date"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><span>${escapeHtml(dateText)}</span></div>` : ''}
          </header>
          <div class="row name-row">
            <div class="label">姓名</div>
            <div class="name">${escapeHtml(s.name)}</div>
          </div>
          <div class="row slots-row">
            <div class="label">登記時段（共 ${slots.length} 個）</div>
            <div class="slots">${slotsHtml}</div>
          </div>
          <footer class="bottom">
            <div class="token-box">
              <span class="token-label">修改碼</span>
              <span class="token">${escapeHtml(s.token)}</span>
            </div>
            <div class="tips">※ 請於登記時段前至活動現場報到。如需修改請以修改碼至報名頁更新。</div>
          </footer>
        </section>`
    }).join('')
    const html = `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><title>${escapeHtml(eventName)} 通知單</title>
<style>
  @page { size: A4; margin: 8mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif; margin: 0; color: #222; }
  .notice { position: relative; padding: 8mm 12mm; border: 2px dashed #93c5fd; border-radius: 10px; margin-bottom: 5mm; height: 140mm; display: flex; flex-direction: column; overflow: hidden; background: linear-gradient(135deg, #fafcff 0%, #f0f9ff 100%); }
  .notice.page-end { page-break-after: always; margin-bottom: 0; }
  .notice:last-child { page-break-after: auto; }
  .deco { position: absolute; color: #dbeafe; pointer-events: none; }
  .deco svg { width: 100%; height: 100%; }
  .deco-tl { top: 4mm; left: 4mm; width: 16mm; height: 16mm; transform: rotate(-15deg); color: #fde68a; }
  .deco-br { bottom: 4mm; right: 4mm; width: 18mm; height: 18mm; color: #fecaca; opacity: 0.6; }
  header { text-align: center; border-bottom: 2px solid #3b82f6; padding-bottom: 3mm; margin-bottom: 4mm; position: relative; z-index: 1; }
  .badge { width: 10mm; height: 10mm; margin: 0 auto 2mm; color: #fff; background: linear-gradient(135deg, #3b82f6, #6366f1); border-radius: 50%; display: flex; align-items: center; justify-content: center; padding: 2mm; box-shadow: 0 2px 4px rgba(59, 130, 246, 0.3); }
  .badge svg { width: 100%; height: 100%; }
  .title { font-size: 18pt; font-weight: 900; color: #1e40af; letter-spacing: 2px; }
  .subtitle { font-size: 11pt; color: #64748b; margin-top: 1mm; letter-spacing: 4px; }
  .date { font-size: 20pt; font-weight: 900; color: #dc2626; margin-top: 3mm; display: flex; align-items: center; justify-content: center; gap: 3mm; letter-spacing: 2px; }
  .date svg { width: 7mm; height: 7mm; }
  .row { margin-bottom: 4mm; position: relative; z-index: 1; }
  .label { font-size: 10pt; color: #64748b; margin-bottom: 1.5mm; font-weight: 600; }
  .name { font-size: 26pt; font-weight: 900; color: #111; letter-spacing: 4px; }
  .slots-row { flex: 1; overflow: hidden; }
  .slots { display: flex; flex-wrap: wrap; gap: 2mm; margin-top: 2mm; }
  .slot { font-family: ui-monospace, "Courier New", monospace; font-size: 11pt; font-weight: 700; background: linear-gradient(135deg, #3b82f6, #6366f1); color: #fff; padding: 1.5mm 3.5mm; border-radius: 12mm; box-shadow: 0 1px 2px rgba(59, 130, 246, 0.3); }
  .no-slot { color: #aaa; font-size: 11pt; }
  .bottom { margin-top: auto; position: relative; z-index: 1; }
  .token-box { display: inline-flex; align-items: center; gap: 2mm; background: #fef3c7; border: 1px dashed #f59e0b; border-radius: 3mm; padding: 1mm 3mm; margin-bottom: 2mm; }
  .token-label { font-size: 9pt; color: #92400e; font-weight: 600; }
  .token { font-family: ui-monospace, "Courier New", monospace; font-size: 11pt; font-weight: 900; color: #b45309; letter-spacing: 2px; }
  .tips { font-size: 9pt; color: #64748b; border-top: 1px dashed #cbd5e1; padding-top: 2mm; line-height: 1.6; }
  @media print { .notice { border: 1px dashed #93c5fd; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>${cards}
<script>window.onload=()=>{setTimeout(()=>window.print(),300)}</script>
</body></html>`
    const w = window.open('', '_blank')
    if (!w) { alert('無法開啟新視窗，請允許彈出視窗'); return }
    w.document.write(html)
    w.document.close()
  }

  // ══════════════════════════════
  // 全螢幕
  // ══════════════════════════════
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) { displayRef.current?.requestFullscreen(); setIsFullscreen(true) }
    else { document.exitFullscreen(); setIsFullscreen(false) }
  }
  useEffect(() => {
    const h = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', h)
    return () => document.removeEventListener('fullscreenchange', h)
  }, [])

  // 非管理員進入展示頁：首次使用者互動時自動切全螢幕
  useEffect(() => {
    if (activeTab !== 'display') return
    if (adminUnlocked) return
    if (document.fullscreenElement) return
    const trigger = () => {
      if (!document.fullscreenElement && displayRef.current) {
        displayRef.current.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(() => {})
      }
      window.removeEventListener('click', trigger)
      window.removeEventListener('touchstart', trigger)
      window.removeEventListener('keydown', trigger)
    }
    window.addEventListener('click', trigger, { once: true })
    window.addEventListener('touchstart', trigger, { once: true })
    window.addEventListener('keydown', trigger, { once: true })
    return () => {
      window.removeEventListener('click', trigger)
      window.removeEventListener('touchstart', trigger)
      window.removeEventListener('keydown', trigger)
    }
  }, [activeTab, adminUnlocked])

  // ══════════════════════════════
  // 衍生資料
  // ══════════════════════════════
  const TIME_SLOTS = generateTimeSlots(extraEndHour)
  const TIME_BLOCKS = buildTimeBlocks(extraEndHour)

  const stats = getParticipantStats()
  const hourGroups = groupByHour(TIME_SLOTS)

  // 時段格子顏色樣式
  const slotCellClass = (slot) => {
    const selected = signupSelectedSlots.includes(slot)
    const status = slotStatus(slot)
    if (selected) return 'bg-blue-500 text-white border-blue-600 ring-2 ring-blue-300 cursor-pointer'
    if (status === 'many') return 'bg-red-50 border-red-200 text-red-600 cursor-pointer hover:bg-red-100'
    if (status === 'some') return 'bg-orange-50 border-orange-200 text-orange-700 cursor-pointer hover:bg-orange-100'
    if (status === 'few')  return 'bg-yellow-50 border-yellow-200 text-yellow-700 cursor-pointer hover:bg-yellow-100'
    return 'bg-green-50 border-green-300 text-green-700 cursor-pointer hover:bg-green-100'
  }

  // 共用的 labelStyle / iconMap（供多處時間表使用）
  const LABEL_STYLE = {
    period: 'bg-white text-gray-700 border-gray-300',
    free:   'bg-gray-100 text-gray-500 border-gray-200',
    break:  'bg-gray-50 text-gray-400 border-gray-200',
    meal:   'bg-amber-50 text-amber-600 border-amber-200',
    rest:   'bg-purple-50 text-purple-500 border-purple-200',
    extra:  'bg-teal-50 text-teal-600 border-teal-200',
  }
const ICON_MAP = { period: null, free: null, break: Coffee, meal: Utensils, rest: Moon, extra: Clock }

  // 圖例元件（共用）
  const Legend = () => (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-gray-600">
      <span className="flex items-center gap-1.5"><span className="w-4 h-4 rounded-lg bg-green-200 border border-green-400 inline-block"/>空</span>
      <span className="flex items-center gap-1.5"><span className="w-4 h-4 rounded-lg bg-yellow-200 border border-yellow-400 inline-block"/>1–2人</span>
      <span className="flex items-center gap-1.5"><span className="w-4 h-4 rounded-lg bg-orange-200 border border-orange-400 inline-block"/>3–4人</span>
      <span className="flex items-center gap-1.5"><span className="w-4 h-4 rounded-lg bg-red-200 border border-red-400 inline-block"/>5人+</span>
      <span className="flex items-center gap-1.5"><span className="w-4 h-4 rounded-lg bg-blue-500 inline-block"/>已選</span>
    </div>
  )

  const TABS = [
    { key: 'signup', icon: ClipboardList, label: '報名登記', tooltip: '學生報名時段登記' },
    { key: 'display', icon: Monitor, label: '展示', tooltip: '活動現場大螢幕展示' },
    { key: 'admin', icon: Settings, label: '管理', tooltip: '管理員功能設定' },
  ]

  return (
    <div className={`min-h-screen bg-gradient-to-br ${skin.page}`}>
      <audio ref={audioRef} preload="auto"><source src={BEEP_SOUND} type="audio/wav" /></audio>

      {/* 標題列 */}
      <header className="sticky top-0 z-10 shadow-lg"
        style={{ background: skin.header }}>
        <div className="w-[90%] mx-auto px-4 pt-3 pb-1 flex items-center justify-between gap-3">
          <button onClick={() => setActiveTab('signup')} className="text-left hover:opacity-90 transition-opacity flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center shrink-0 shadow-lg">
              <Activity className="w-7 h-7 sm:w-8 sm:h-8 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-xl font-extrabold text-white leading-snug tracking-wide">{eventName}</h1>
              {eventDate && <p className={`text-xs sm:text-sm ${skin.subtextHeader} font-semibold`}>{eventDate}</p>}
            </div>
          </button>
          <div className="flex items-center gap-2 sm:gap-3">
            {/* 主題切換 */}
            <div className="relative group">
              <button className="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur hover:bg-white/30 flex items-center justify-center transition-colors shadow" title="切換主題"><Palette className="w-5 h-5 text-white" /></button>
              <div className="absolute right-0 top-full mt-1 bg-white rounded-2xl shadow-2xl border border-gray-200 p-2 hidden group-hover:block min-w-[140px] z-50">
                {Object.entries(SKINS).map(([key, s]) => (
                  <button key={key} onClick={() => setSkinKey(key)}
                    className={`w-full text-left px-3 py-2 rounded-xl text-sm transition-colors flex items-center gap-2.5 ${skinKey === key ? 'bg-gray-100 font-bold' : 'hover:bg-gray-50'}`}>
                    <span className="w-5 h-5 rounded-lg shrink-0 shadow-sm" style={{ background: s.header }}/>
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-xl sm:text-2xl font-mono font-bold text-white tabular-nums">{currentTime}</div>
              <div className={`text-xs ${skin.subtextHeader}`}>已登記 <span className={`font-bold ${skin.badgeColor}`}>{signups.length}</span> 人</div>
            </div>
          </div>
        </div>
        <div className="w-[90%] mx-auto px-3 flex gap-1.5 py-2 overflow-x-auto">
          {TABS.map((tab, index) => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`tooltip flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-all duration-300 hover:scale-105 active:scale-95 ${
                activeTab === tab.key ? `${skin.tabActive} shadow-lg` : skin.tabInactive
              }`}
              data-tooltip={tab.tooltip}
              style={{ animationDelay: `${index * 0.05}s` }}
            >
              <tab.icon className={`w-5 h-5 animate-bounce-in ${activeTab === tab.key ? skin.iconColor : 'opacity-80'}`} style={{ animationDelay: `${index * 0.05 + 0.1}s` }} />
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      <main className="w-[90%] mx-auto px-3 sm:px-4 py-4 sm:py-6">

        {/* ═══════════════════════════════
            報名登記
        ═══════════════════════════════ */}
        {activeTab === 'signup' && (
          <div>
            {/* 修改模式提示橫幅 */}
            {editToken && editRecord && (
              <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center justify-between">
                <div className="text-sm text-blue-700">
                  <Pencil className="w-4 h-4 inline mr-1" /> 修改模式：<span className="font-bold">{editRecord.name}</span> 的登記
                </div>
                <div className="flex gap-2">
                  <button onClick={() => deleteSignup(editToken)} className="text-xs bg-red-50 text-red-500 border border-red-200 px-3 py-1 rounded-lg hover:bg-red-100">取消登記</button>
                  <button onClick={cancelEdit} className="text-xs bg-gray-100 text-gray-500 px-3 py-1 rounded-lg hover:bg-gray-200">離開修改</button>
                </div>
              </div>
            )}

            {/* ── STEP 1：輸入姓名 ── */}
            {signupStep === 'name' && !editToken && (
              <div className="mt-4">
                {/* 統計摘要列（手機橫排3欄，較寬時也是橫排） */}
                <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4">
                  {[
                    { label: '已登記人數', value: signups.length, color: skin.statCards[0], Icon: Users },
                    { label: '已佔用時段', value: [...new Set(signups.flatMap(s => s.slots))].length, color: skin.statCards[1], Icon: CalendarCheck },
                    { label: '可用時段', value: Math.max(0, TIME_SLOTS.length - [...new Set(signups.flatMap(s => s.slots))].length), color: skin.statCards[2], Icon: Sparkles },
                  ].map(({ label, value, color, Icon }, index) => (
                    <div key={label} className={`bg-gradient-to-br ${color} rounded-2xl p-3 sm:p-4 text-white text-center shadow-md hover:shadow-lg transition-all duration-300 animate-fade-in`} style={{ animationDelay: `${index * 0.1}s` }}>
                      <div className="mb-2 flex justify-center animate-bounce-in" style={{ animationDelay: `${index * 0.1 + 0.2}s` }}><Icon className="w-7 h-7 sm:w-8 sm:h-8 opacity-90" /></div>
                      <div className="text-2xl sm:text-3xl font-black leading-none animate-pulse-gentle" style={{ animationDelay: `${index * 0.1 + 0.4}s` }}>{value}</div>
                      <div className="text-[10px] sm:text-xs opacity-80 mt-1.5 leading-tight font-medium">{label}</div>
                    </div>
                  ))}
                </div>

                {/* 登記表單卡片 */}
                <div className="card animate-fade-in p-4 sm:p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center shadow-lg animate-bounce-in" style={{ background: skin.cardGrad }}><ClipboardSignature className="w-6 h-6 sm:w-7 sm:h-7 text-white" /></div>
                    <div>
                      <h2 className="text-base sm:text-lg font-extrabold text-gray-800 leading-tight">時段登記</h2>
                      <p className="text-xs text-gray-400">輸入姓名後選擇想登記的時段</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="relative">
                      <input
                        type="text"
                        value={signupNameInput}
                        onChange={e => setSignupNameInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && signupNameInput.trim()) setSignupStep('grid') }}
                        placeholder="請輸入您的姓名..."
                        list="participant-list"
                        className="input-primary"
                        autoFocus
                      />
                      <datalist id="participant-list">
                        {participants.map(n => <option key={n} value={n} />)}
                      </datalist>
                      {signupNameInput && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-green-500 animate-pulse-gentle">
                          <Check className="w-5 h-5" />
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => { if (signupNameInput.trim()) setSignupStep('grid') }}
                      disabled={!signupNameInput.trim()}
                      className={`w-full btn-primary disabled:from-gray-200 disabled:to-gray-200 disabled:text-gray-400 disabled:shadow-none disabled:cursor-not-allowed ${signupNameInput.trim() ? 'animate-pulse-gentle' : ''}`}
                    >
                      {signupNameInput.trim() ? <span className="flex items-center justify-center gap-2"><span>選擇時段</span><ArrowRight className="w-4 h-4" /></span> : '請先輸入姓名'}
                    </button>
                  </div>

                  {/* 已有登記可查詢 */}
                  {signups.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-dashed">
                      <p className="text-xs text-gray-400 mb-2">已有登記，直接輸入修改碼查詢或修改：</p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={queryToken}
                          onChange={e => { setQueryToken(e.target.value.toUpperCase()); setQueryError('') }}
                          placeholder="修改碼（4碼）"
                          maxLength={8}
                          className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 font-mono uppercase"
                        />
                        <button
                          onClick={() => {
                            const t = queryToken.trim().toUpperCase()
                            const rec = signups.find(s => s.token === t)
                            if (rec) { setQueryResult(rec); setQueryError('') }
                            else setQueryError('找不到此修改碼')
                          }}
                          className="shrink-0 bg-blue-500 text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-blue-600"
                        >查詢</button>
                        <button
                          onClick={() => {
                            const t = queryToken.trim().toUpperCase()
                            const rec = signups.find(s => s.token === t)
                            if (rec) { setEditToken(t); setEditRecord(rec); setSignupNameInput(rec.name); setSignupSelectedSlots([...rec.slots]); setSignupStep('grid'); setQueryToken(''); setQueryError('') }
                            else setQueryError('找不到此修改碼')
                          }}
                          className="shrink-0 bg-gray-100 text-gray-700 px-3 py-2 rounded-lg text-sm font-semibold hover:bg-gray-200"
                        >修改</button>
                      </div>
                      {queryError && (
                        <p className="text-xs text-red-500 mt-2">{queryError}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── STEP 2：時間表格（手機全螢幕 / 平板+PC 彈窗） ── */}
            {signupStep === 'grid' && (
              <div className="fixed inset-0 z-40 bg-black/50 flex items-end sm:items-start justify-center sm:overflow-y-auto sm:py-4 sm:px-4">
                {/* 手機：底部滑出；平板/PC：置中 modal */}
                <div className="bg-white w-full sm:rounded-2xl sm:shadow-2xl sm:max-w-2xl relative
                  rounded-t-3xl shadow-2xl max-h-[92vh] flex flex-col overflow-hidden">
                  {/* 送出中遮罩 */}
                  {signupSubmitting && (
                    <div className="absolute inset-0 z-20 bg-white/80 backdrop-blur-sm rounded-t-3xl sm:rounded-2xl flex flex-col items-center justify-center gap-3 animate-fade-in">
                      <div className="loading-spinner"></div>
                      <div className="text-blue-600 font-semibold text-base animate-pulse-gentle">正在儲存登記…</div>
                      <div className="text-gray-400 text-sm">請稍候，勿關閉頁面</div>
                    </div>
                  )}
                  {/* 彈窗標題 */}
                  <div className="px-4 sm:px-5 py-3 sm:py-4 border-b flex items-center justify-between shrink-0">
                    {/* 手機拖曳把手 */}
                    <div className="absolute top-2 left-1/2 -translate-x-1/2 w-10 h-1 bg-gray-300 rounded-full sm:hidden"/>
                    <div className="mt-2 sm:mt-0">
                      <span className="font-bold text-gray-800 text-base sm:text-lg">{signupNameInput}</span>
                      <span className="text-gray-500 text-sm ml-2">選擇時段</span>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3">
                      {/* 圖例：平板以上才顯示 */}
                      <div className="hidden sm:flex items-center gap-3 text-xs text-gray-500">
                        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-200 border border-green-400 inline-block"/>空</span>
                        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-200 border border-yellow-400 inline-block"/>1–2人</span>
                        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-200 border border-orange-400 inline-block"/>3–4人</span>
                        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-200 border border-red-400 inline-block"/>5人+</span>
                        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-500 inline-block"/>已選</span>
                      </div>
                      <button
                        onClick={() => { setSignupStep('name'); setSignupSelectedSlots([]); setSignupError('') }}
                        disabled={signupSubmitting}
                        className="text-gray-400 hover:text-gray-600 text-2xl leading-none disabled:opacity-30"
                      ><X className="w-5 h-5" /></button>
                    </div>
                  </div>

                  {/* 系統建議時段 */}
                  {signupSelectedSlots.length === 0 && (
                    <div className="mx-3 sm:mx-5 mt-3 bg-green-50 border border-green-200 rounded-xl px-3 py-2 flex items-center justify-between gap-3">
                      <div className="text-xs sm:text-sm text-green-700 flex items-center gap-1"><Lightbulb className="w-4 h-4" /> 系統可自動排入較空時段，或直接點選格子</div>
                      <button
                        onClick={() => {
                          const sorted = [...TIME_SLOTS].sort((a, b) => {
                            const ca = signups.filter(s => s.slots.includes(a) && s.token !== editToken).length
                            const cb = signups.filter(s => s.slots.includes(b) && s.token !== editToken).length
                            return ca - cb
                          })
                          setSignupSelectedSlots(sorted.slice(0, 3))
                        }}
                        className="shrink-0 bg-green-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-green-700 whitespace-nowrap"
                      >自動排入</button>
                    </div>
                  )}

                  {/* 已選時段提示 */}
                  {signupSelectedSlots.length > 0 && (
                    <div className="mx-3 sm:mx-5 mt-3 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 flex flex-wrap gap-1.5 items-center">
                      <span className="text-xs text-blue-500 mr-1">已選：</span>
                      {[...signupSelectedSlots].sort().map(s => (
                        <span key={s} className="bg-blue-500 text-white text-xs px-2 py-0.5 rounded-full flex items-center gap-1">
                          {s}
                          <button onClick={() => toggleSlot(s)} className="hover:text-blue-200"><X className="w-3 h-3" /></button>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* 時間表：可捲動區域 */}
                  <div className="overflow-y-auto flex-1 p-3 sm:p-4 space-y-1">
                    {TIME_BLOCKS.map((block) => {
                      const blockSlots = getSlotsInBlock(block, TIME_SLOTS)
                      const anySelected = blockSlots.some(s => signupSelectedSlots.includes(s))
                      const activeLabelStyle = anySelected ? 'bg-blue-600 text-white border-blue-600' : LABEL_STYLE[block.type]
                      return (
                        <div key={block.label + block.start}
                          className={`flex items-start gap-1.5 sm:gap-2 px-1.5 sm:px-2 py-1.5 rounded-xl transition-colors ${
                            anySelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                          }`}>
                          {/* 左側標籤 */}
                          <div className={`shrink-0 w-14 sm:w-16 rounded-xl border text-center py-1.5 leading-tight ${activeLabelStyle}`}>
                            {ICON_MAP[block.type] && (() => {
                              const Icon = ICON_MAP[block.type];
                              return <div className="flex justify-center mb-0.5"><Icon className={`w-4 h-4 ${anySelected ? 'text-white' : skin.iconColor}`} /></div>
                            })()}
                            <div className="text-xs sm:text-sm font-bold">{block.label}</div>
                            <div className="text-[9px] sm:text-[10px] opacity-60 mt-0.5">{block.start}</div>
                            <div className="text-[9px] sm:text-[10px] opacity-60">–{block.end}</div>
                          </div>
                          {/* 右側格子：手機 38px，平板以上 44px */}
                          <div className="flex flex-wrap gap-1 flex-1">
                            {blockSlots.map(slot => {
                              const count = getSlotSignups(slot).length
                              const selected = signupSelectedSlots.includes(slot)
                              const names = getSlotSignups(slot).map(s => s.name)
                              return (
                                <button
                                  key={slot}
                                  onClick={() => toggleSlot(slot)}
                                  title={names.length > 0 ? `${slot}：${names.join('、')}（${count}人）` : `${slot}：尚無人登記`}
                                  className={`border rounded-lg text-center transition-all ${slotCellClass(slot)}`}
                                  style={{ width: '38px', height: '38px' }}
                                >
                                  <div className="text-[10px] font-bold leading-none">{slot}</div>
                                  {count > 0 ? (
                                    <div className={`text-[9px] font-semibold mt-0.5 ${selected ? 'text-white' : 'opacity-70'}`}>{count}人</div>
                                  ) : (
                                    <div className="text-[8px] mt-0.5 opacity-40">空</div>
                                  )}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* 底部操作列 */}
                  <div className="border-t px-4 sm:px-5 py-3 sm:py-4 shrink-0">
                    {signupError && (
                      <div className="mb-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs sm:text-sm text-red-600 flex items-center gap-2">
                        ⚠️ {signupError}
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm text-gray-500">
                        已選 <span className="font-bold text-blue-600">{signupSelectedSlots.length}</span> 個時段
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setSignupStep('name'); setSignupSelectedSlots([]); setSignupError('') }}
                          disabled={signupSubmitting}
                          className="px-3 sm:px-4 py-2 rounded-xl border text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                        >取消</button>
                        <button
                          onClick={submitSignup}
                          disabled={signupSelectedSlots.length === 0 || signupSubmitting}
                          className="px-4 sm:px-6 py-2 rounded-xl bg-blue-600 disabled:bg-gray-300 disabled:text-gray-400 text-white text-sm font-semibold hover:bg-blue-700 transition-colors flex items-center gap-2 min-w-[90px] justify-center"
                        >
                          {signupSubmitting ? (
                            <>
                              <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                              </svg>
                              儲存中…
                            </>
                          ) : (editRecord ? '確認修改' : '確認登記')}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── STEP 3：完成 ── */}
            {signupStep === 'done' && (
              <div className="max-w-md mx-auto mt-6">
                {/* 慶祝卡片 */}
                <div className="rounded-3xl shadow-xl overflow-hidden mb-4"
                  style={{ background: skin.cardGrad }}>
                  <div className="px-6 pt-8 pb-6 text-center">
                    <div className="mb-4 flex justify-center">{editRecord ? <Pencil className="w-12 h-12 text-white" /> : <PartyPopper className="w-12 h-12 text-white" />}</div>
                    <h2 className="text-2xl font-black text-white mb-1">
                      {editRecord ? '修改完成！' : '登記成功！'}
                    </h2>
                    <p className="text-blue-200 text-sm">
                      <span className="text-yellow-300 font-bold">{signupNameInput}</span>，已完成 <span className="text-yellow-300 font-bold">{signupSelectedSlots.length}</span> 個時段登記
                    </p>
                  </div>
                  {/* 已選時段 */}
                  <div className="bg-white/10 px-6 py-4">
                    <div className="text-[11px] text-blue-200 font-semibold mb-2 uppercase tracking-wide">已登記時段</div>
                    <div className="flex flex-wrap gap-1.5">
                      {[...signupSelectedSlots].sort().map(s => (
                        <span key={s} className="bg-white/20 text-white text-xs px-2.5 py-1 rounded-full font-mono font-semibold border border-white/30">{s}</span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 修改碼卡片 */}
                <div className="bg-white rounded-2xl shadow-lg p-5 mb-3 border border-gray-100">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg" style={{ background: skin.btnGrad }}><KeyRound className="w-5 h-5 text-white" /></div>
                    <span className="text-sm font-bold text-gray-700">您的修改碼（請妥善保存）</span>
                  </div>
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-3 mb-3 text-center">
                    <div className="text-3xl font-mono font-black text-blue-600 tracking-[0.3em]">{signupDoneToken}</div>
                  </div>
                  <button
                    onClick={() => copyLink(signupDoneToken)}
                    className={`w-full bg-gradient-to-r ${skin.btnGrad} text-white py-2.5 rounded-xl text-sm font-bold ${skin.btnHover} transition-all shadow`}
                  ><Copy className="w-4 h-4 inline mr-2" /> 複製修改連結</button>
                  <div className="mt-2 text-[10px] text-gray-300 break-all text-center">{getEditLink(signupDoneToken)}</div>
                </div>

                <button onClick={startNewSignup} className="w-full border-2 border-gray-200 text-gray-500 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50 hover:border-gray-300 transition-all">
                  + 繼續為其他人登記
                </button>
              </div>
            )}

            {/* ── 時段總覽（底部，step=name 時顯示）── */}
            {signupStep === 'name' && !editToken && (
              <div className="mt-4 bg-white rounded-2xl shadow-lg p-4 border border-gray-100">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg" style={{ background: skin.cardGrad }}><BarChart3 className="w-5 h-5 text-white" /></span>
                    <h2 className="font-extrabold text-gray-800 text-base sm:text-lg">登記狀況總覽</h2>
                  </div>
                  <button onClick={exportSignups} className="text-sm bg-gray-100 text-gray-600 px-4 py-2 rounded-xl hover:bg-gray-200 font-semibold flex items-center gap-1.5 shadow-sm"><FileDown className={`w-4 h-4 ${skin.iconColor}`} /> 匯出</button>
                </div>
                {/* 圖例 */}
                <div className="flex items-center gap-4 text-sm text-gray-600 mb-3">
                  <span className="flex items-center gap-1.5"><span className="w-4 h-4 rounded-lg bg-green-200 border border-green-400 inline-block"/>空</span>
                  <span className="flex items-center gap-1.5"><span className="w-4 h-4 rounded-lg bg-yellow-200 border border-yellow-400 inline-block"/>1–2人</span>
                  <span className="flex items-center gap-1.5"><span className="w-4 h-4 rounded-lg bg-orange-200 border border-orange-400 inline-block"/>3–4人</span>
                  <span className="flex items-center gap-1.5"><span className="w-4 h-4 rounded-lg bg-red-200 border border-red-400 inline-block"/>5人+</span>
                </div>
                {/* 依 TIME_BLOCKS 軸呈現 */}
                <div className="space-y-1">
                  {TIME_BLOCKS.map((block) => {
                    const blockSlots = getSlotsInBlock(block, TIME_SLOTS)
                    return (
                      <div key={block.label + block.start} className="flex items-start gap-1.5 sm:gap-2 px-1.5 sm:px-2 py-1 rounded-xl hover:bg-gray-50">
                        {/* 左側標籤 */}
                        <div className={`shrink-0 w-14 sm:w-16 rounded-xl border text-center py-1.5 leading-tight ${LABEL_STYLE[block.type]}`}>
                          {ICON_MAP[block.type] && (() => {
                            const Icon = ICON_MAP[block.type];
                            return <div className="flex justify-center mb-0.5"><Icon className={`w-4 h-4 ${skin.iconColor}`} /></div>
                          })()}
                          <div className="text-xs sm:text-sm font-bold">{block.label}</div>
                          <div className="text-[9px] sm:text-[10px] opacity-60 mt-0.5">{block.start}</div>
                          <div className="text-[9px] sm:text-[10px] opacity-60">–{block.end}</div>
                        </div>
                        {/* 右側格子（唯讀，hover 顯示 tooltip） */}
                        <div className="flex flex-wrap gap-0.5 sm:gap-1 flex-1">
                          {blockSlots.map(slot => {
                            const sgs = signups.filter(s => s.slots.includes(slot))
                            const count = sgs.length
                            const cellCls = count === 0
                              ? 'bg-green-50 border-green-300 text-green-700'
                              : count <= 2
                              ? 'bg-yellow-50 border-yellow-300 text-yellow-700'
                              : count <= 4
                              ? 'bg-orange-50 border-orange-300 text-orange-700'
                              : 'bg-red-50 border-red-300 text-red-700'
                            const isHovered = hoveredSlot === slot
                            return (
                              <div
                                key={slot}
                                className={`relative border rounded-lg text-center cursor-default transition-shadow ${cellCls} ${isHovered && count > 0 ? 'ring-2 ring-offset-1 ring-blue-300 z-10' : ''}`}
                                style={{ width: '36px', height: '36px' }}
                                onMouseEnter={() => setHoveredSlot(slot)}
                                onMouseLeave={() => setHoveredSlot(null)}
                              >
                                <div className="text-[10px] font-bold leading-none pt-1">{slot}</div>
                                {count > 0 ? (
                                  <div className="text-[9px] font-semibold mt-0.5 opacity-70">{count}人</div>
                                ) : (
                                  <div className="text-[8px] mt-0.5 opacity-30">空</div>
                                )}
                                {/* Tooltip */}
                                {isHovered && count > 0 && (
                                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 pointer-events-none">
                                    <div className="bg-gray-900 text-white rounded-xl shadow-xl px-3 py-2 text-left whitespace-nowrap">
                                      <div className="text-[11px] font-bold text-gray-300 mb-1">{slot} · {count} 人</div>
                                      <div className="space-y-0.5">
                                        {sgs.map((s, i) => (
                                          <div key={s.token} className="text-xs flex items-center gap-1.5">
                                            <span className="w-4 h-4 rounded-full bg-blue-500 text-white text-[9px] flex items-center justify-center shrink-0">{i + 1}</span>
                                            {s.name}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                    <div className="w-2 h-2 bg-gray-900 rotate-45 mx-auto -mt-1"/>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ── 往年回顧 ── */}
            {signupStep === 'name' && !editToken && PAST_EVENTS.length > 0 && (
              <div className="mt-4 bg-white rounded-2xl shadow-lg p-4 border border-gray-100">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg" style={{ background: skin.cardGrad }}><Clapperboard className="w-5 h-5 text-white" /></div>
                  <h2 className="font-extrabold text-gray-800 text-base sm:text-lg">往年活動回顧</h2>
                </div>
                <div className="space-y-4">
                  {PAST_EVENTS.filter(e => e.type === 'video').map((ev, i) => (
                    <div key={i}>
                      <h3 className="text-base font-bold text-gray-700 mb-3 flex items-center gap-2">
                        <Play className={`w-5 h-5 ${skin.iconColor}`} fill="currentColor" /> {ev.title}
                      </h3>
                      <div className="relative w-full rounded-xl overflow-hidden shadow-md" style={{ paddingBottom: '56.25%' }}>
                        <iframe
                          className="absolute inset-0 w-full h-full"
                          src={`https://www.youtube.com/embed/${ev.embedId}`}
                          title={ev.title}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                      </div>
                    </div>
                  ))}
                  {PAST_EVENTS.filter(e => e.type === 'album').map((ev, i) => (
                    <a key={i} href={ev.url} target="_blank" rel="noopener noreferrer"
                      className="block bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl p-4 hover:shadow-md transition-shadow group">
                      <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg shrink-0" style={{ background: skin.cardGrad }}><Camera className="w-7 h-7 text-white" /></div>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-gray-700 text-base group-hover:text-emerald-700 transition-colors">{ev.title}</div>
                          <div className="text-sm text-gray-400 mt-0.5">點擊前往 Google 相簿瀏覽</div>
                        </div>
                        <ArrowRight className="text-emerald-400 w-6 h-6 shrink-0 group-hover:translate-x-1 transition-transform" />
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════
            大螢幕展示 + 圈數記錄
        ═══════════════════════════════ */}
        {activeTab === 'display' && (() => {
          const allRunners = [...new Set([...participants, ...signups.map(s => s.name), ...lapRecords.map(r => r.participant)])].sort((a, b) => a.localeCompare(b, 'zh-TW'))
          const runnerLaps = displayRunner ? getRunnerLaps(displayRunner).sort((a, b) => a.timestamp - b.timestamp) : []
          const runnerLapCount = runnerLaps.length
          const totalLaps = (() => {
            const seen = new Set()
            let count = 0
            lapRecords.forEach(r => {
              if (r.groupLapId) {
                if (seen.has(r.groupLapId)) return
                seen.add(r.groupLapId)
              }
              count += 1
            })
            return count
          })()
          const sortedStats = [...stats].sort((a, b) => b.totalLaps - a.totalLaps)
          const groupedRunners = getDisplayRunnerGroups()
          const expectedSlot = displayRunner ? getRunnerExpectedSlot(displayRunner) : null
          const scheduleDelta = displayRunner ? getRunnerScheduleDelta(displayRunner) : null
          const currentGroup = displayRunner
            ? (groupedRunners.find(group => group.members.some(r => r.name === displayRunner))?.members || [])
            : []
          return (
          <div className="space-y-4">
            {/* 操作列 */}
            <div className="flex flex-wrap justify-between items-center gap-2">
              <h2 className="font-bold text-gray-700 text-lg">展示 & 圈數記錄</h2>
              <div className="flex flex-wrap gap-2">
                  {adminUnlocked && (
                    <>
                      <button onClick={() => setDisplayDrawerOpen(true)} className="bg-violet-600 text-white px-4 py-2 rounded-xl text-sm hover:bg-violet-700 font-semibold shadow flex items-center gap-1.5"><Users className="w-4 h-4" /> 個人統計</button>
                      <button onClick={() => { setEditLapRunner(displayRunner || allRunners[0] || ''); setShowEditLapModal(true) }} className="bg-yellow-500 text-white px-4 py-2 rounded-xl text-sm hover:bg-yellow-600 font-semibold shadow flex items-center gap-1.5"><Settings className="w-4 h-4" /> 手動修改</button>
                      <button onClick={exportDisplayLaps} className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm hover:bg-emerald-700 font-semibold shadow flex items-center gap-1.5"><FileDown className="w-4 h-4" /> 匯出</button>
                    </>
                  )}
                  <button onClick={toggleFullscreen} className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm hover:bg-blue-700 font-semibold shadow flex items-center gap-1.5">
                    {isFullscreen ? '退出' : <><Monitor className="w-4 h-4" /> 全螢幕</>}
                  </button>
              </div>
            </div>

            {/* 手機直式時強迫打橫的 CSS：整個展示容器順時針旋轉 90° */}
            <style>{`
              @media (orientation: portrait) and (max-width: 768px) {
                .display-force-landscape {
                  transform: rotate(90deg);
                  transform-origin: center center;
                  width: 100vh !important;
                  height: 100vw !important;
                  position: fixed !important;
                  top: 50% !important;
                  left: 50% !important;
                  margin-left: -50vh !important;
                  margin-top: -50vw !important;
                  z-index: 60 !important;
                  border-radius: 0 !important;
                }
              }
            `}</style>
            {/* 主展示區 */}
            <div ref={displayRef} className={`rounded-2xl text-white overflow-hidden shadow-2xl relative flex flex-col ${isFullscreen ? 'display-force-landscape fixed inset-0 z-50 rounded-none overflow-y-auto' : ''}`}
              style={{
                background: skin.displayBg,
                backgroundImage: `url("/img/bg (${displayBgIndex}).png")`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat',
                minHeight: isFullscreen ? '100vh' : '75vh',
              }}>


              {/* 頂部標題列 */}
              <div className="relative px-4 sm:px-8 pt-2 pb-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                      <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center shadow-2xl" style={{ background: 'rgba(255,255,255,0.92)', border: '2px solid rgba(0,0,0,0.15)' }}><Activity className="w-7 h-7 sm:w-8 sm:h-8" style={{ color: skin.displayAccent }} /></div>
                    <div className="rounded-2xl px-4 py-2 shadow-2xl" style={{ background: 'rgba(255,255,255,0.92)', border: '2px solid rgba(0,0,0,0.15)' }}>
                      <div className="text-sm text-gray-700 font-semibold">已進行時間</div>
                      <div className="text-xl sm:text-2xl font-black tabular-nums" style={{ color: skin.displayAccent }}>
                        {timerRunning ? elapsedTimeDisplay : '00:00:00'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {isFullscreen && (
                        <button onClick={() => setDisplayDrawerOpen(true)} className="w-10 h-10 rounded-xl hover:bg-white flex items-center justify-center transition-colors shadow-2xl" style={{ background: 'rgba(255,255,255,0.92)', border: '2px solid rgba(0,0,0,0.15)' }}><Users className="w-5 h-5 text-gray-800" /></button>
                    )}
                    <div className="text-right">
                      <div className="flex items-center gap-2 mb-1 justify-end">
                        <div className="text-sm text-gray-700 font-semibold px-2 py-0.5 rounded shadow-lg" style={{ background: 'rgba(255,255,255,0.92)', border: '2px solid rgba(0,0,0,0.15)' }}>目前時間</div>
                        <button
                          onClick={() => setClockDisplayMode(clockDisplayMode === 'digital' ? 'analog' : 'digital')}
                          className="w-6 h-6 rounded-lg hover:bg-white flex items-center justify-center text-xs transition-colors shadow-lg"
                          style={{ background: 'rgba(255,255,255,0.92)', border: '2px solid rgba(0,0,0,0.15)' }}
                          title={clockDisplayMode === 'digital' ? '切換到圓形時鐘' : '切換到數字時鐘'}
                        >
                            {clockDisplayMode === 'digital' ? <Clock className="w-4 h-4 text-gray-800" /> : <Watch className="w-4 h-4 text-gray-800" />}
                        </button>
                      </div>
                      {clockDisplayMode === 'digital' ? (
                        <div className="text-2xl sm:text-4xl font-mono font-black tabular-nums text-gray-900 inline-block px-3 py-1 rounded-xl shadow-2xl" style={{ background: 'rgba(255,255,255,0.92)', border: '2px solid rgba(0,0,0,0.15)' }}>{currentTime}</div>
                      ) : (
                        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center mx-auto shadow-2xl" style={{ background: 'rgba(255,255,255,0.92)', border: '2px solid rgba(0,0,0,0.15)' }}>
                          <AnalogClock time={currentTime} />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* ══ 核心展示：跑者 → 目前總圈數文字 → 超大總圈數數字 ══ */}
              <div className="relative flex-1 flex flex-col items-center px-4 sm:px-8 pt-2 sm:pt-4 min-h-0">
                {/* 上方：跑者資訊（固定高度） */}
                <div className="w-full text-center shrink-0">
                  {currentGroup.length > 0 ? (
                    currentGroup.length === 1 ? (
                      <span className="inline-block text-gray-900 text-xl sm:text-3xl font-bold px-5 py-2 rounded-2xl shadow-2xl"
                           style={{ background: 'rgba(255,255,255,0.92)', border: '2px solid rgba(0,0,0,0.15)' }}>
                        現在跑者 - <span style={{ color: skin.displayAccent }}>{currentGroup[0].name}</span>
                        <span className="ml-2 text-gray-700 text-base sm:text-2xl">（個人第 {getRunnerLaps(currentGroup[0].name).length} 圈）</span>
                      </span>
                    ) : (
                      <div className="flex flex-col gap-1 sm:gap-2 items-center">
                        {currentGroup.map(g => {
                          const cnt = getRunnerLaps(g.name).length
                          return (
                            <span key={g.token || g.name}
                                 className="inline-block text-gray-900 text-lg sm:text-2xl font-bold px-5 py-1.5 rounded-2xl shadow-2xl"
                                 style={{ background: 'rgba(255,255,255,0.92)', border: '2px solid rgba(0,0,0,0.15)' }}>
                              現在跑者 - <span style={{ color: skin.displayAccent }}>{g.name}</span>
                              <span className="ml-2 text-gray-700 text-sm sm:text-base">個人第 {cnt} 圈</span>
                            </span>
                          )
                        })}
                      </div>
                    )
                  ) : (
                    <span className="inline-block text-gray-800 text-lg sm:text-2xl font-bold uppercase tracking-[0.3em] px-5 py-2 rounded-2xl shadow-2xl"
                         style={{ background: 'rgba(255,255,255,0.92)', border: '2px solid rgba(0,0,0,0.15)' }}>請選擇跑者</span>
                  )}
                </div>
                {/* 中：目前總圈數標籤 */}
                <span className="inline-block text-gray-900 text-lg sm:text-2xl font-bold mt-2 sm:mt-3 shrink-0 px-5 py-1.5 rounded-2xl shadow-2xl"
                     style={{ background: 'rgba(255,255,255,0.92)', border: '2px solid rgba(0,0,0,0.15)' }}>
                  目前總圈數
                </span>
                {/* 下：超大總圈數數字（佔滿剩餘空間約 90%） */}
                <div className="flex-1 w-full flex items-center justify-center min-h-0">
                  <span className="font-black tabular-nums leading-none"
                        style={{
                          color: skin.displayAccent,
                          fontSize: 'clamp(6rem, 72vh, 36rem)',
                          lineHeight: 0.9,
                          // 白色粗描邊 + 外層黑色柔和陰影做深度
                          textShadow: [
                            '-5px -5px 0 #fff', '5px -5px 0 #fff', '-5px 5px 0 #fff', '5px 5px 0 #fff',
                            '-5px 0 0 #fff', '5px 0 0 #fff', '0 -5px 0 #fff', '0 5px 0 #fff',
                            '0 10px 28px rgba(0,0,0,0.35)',
                            '0 0 48px rgba(255,255,255,0.6)',
                          ].join(', '),
                        }}>
                    {totalLaps}
                  </span>
                </div>
              </div>

              {/* ══ 手機版跑者順序面板呼叫按鈕（右側） ══ */}
              <button
                onClick={() => setDisplayRightOpen(true)}
                className="sm:hidden absolute right-2 top-1/2 -translate-y-1/2 z-20 w-8 h-16 rounded-l-xl bg-black/40 backdrop-blur border border-white/10 border-r-0 flex items-center justify-center text-white/60 hover:text-white hover:bg-black/60 transition-all rotate-180"
              ><ChevronRight className="w-4 h-4" /></button>
              {/* ══ 手機版遮罩 ══ */}
              {displayRightOpen && <div className="sm:hidden fixed inset-0 z-30 bg-black/50" onClick={() => setDisplayRightOpen(false)} />}
              {adminUnlocked && (
                <div className="absolute bottom-0 left-0 right-0 px-4 sm:px-8 pb-4">
                  <div className="rounded-2xl p-3 sm:p-4 mx-auto max-w-2xl" style={{ background: skin.displayCard, backdropFilter: 'blur(12px)' }}>
                    {/* 手動對時 + 記圈，一行 */}
                    <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
                      <div className="sm:w-36">
                        <div className="flex items-center gap-1.5 mb-1">
                          <label className="text-[10px] text-white/40 font-semibold uppercase tracking-wider">手動對時</label>
                          <button
                            onClick={() => setDisplayUseManualTime(!displayUseManualTime)}
                            className={`w-7 h-3 rounded-full transition-colors relative ${displayUseManualTime ? 'bg-green-500' : 'bg-white/20'}`}
                          >
                            <span className={`absolute top-[1px] w-2.5 h-2.5 bg-white rounded-full shadow transition-transform ${displayUseManualTime ? 'left-[14px]' : 'left-[1px]'}`}/>
                          </button>
                        </div>
                        <input
                          type="time"
                          value={displayManualTime}
                          onChange={e => setDisplayManualTime(e.target.value)}
                          disabled={!displayUseManualTime}
                          className={`w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-white/50 transition-colors ${!displayUseManualTime ? 'opacity-30' : ''}`}
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={recordDisplayLap}
                          disabled={!displayRunner}
                          className={`flex-1 py-2 rounded-xl text-base font-black shadow-lg transition-all duration-200 active:scale-95 hover:shadow-xl ${
                            displayRunner
                              ? 'btn-success animate-pulse-gentle'
                              : 'bg-white/10 text-white/30 cursor-not-allowed'
                          }`}
                        >
                          <span className="flex items-center justify-center gap-1">
                            <span>+</span>
                            <span>記圈</span>
                              {displayRunner && <Sparkles className="w-4 h-4 ml-1" />}
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ══ 手機版右側遮罩 ══ */}
              {displayRightOpen && <div className="sm:hidden fixed inset-0 z-30 bg-black/50" onClick={() => setDisplayRightOpen(false)} />}

              <div className={`absolute bottom-4 right-4 z-40 w-[280px] rounded-3xl bg-black/30 border border-white/10 p-4 backdrop-blur-xl text-white shadow-2xl transition-transform duration-300 sm:translate-x-0 ${displayRightOpen ? 'translate-x-0' : 'translate-x-[calc(100%+2rem)] sm:translate-x-0'}`}>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-white/50">跑者順序</div>
                    <div className="text-sm text-white/80">依登記時段排列</div>
                  </div>
                  {adminUnlocked && completedRunners.length > 0 && (
                    <button
                      onClick={() => setCompletedRunners([])}
                      className="text-[10px] text-white/60 hover:text-white underline"
                      title="清除所有已完成標記"
                    >重置</button>
                  )}
                </div>
                <div ref={runnerListRef} className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {groupedRunners.map((g, gIdx) => {
                    const groupCompleted = g.members.every(m => completedRunners.includes(m.token || m.name))
                    const groupIsCurrent = g.members.some(m => m.name === displayRunner)
                    return (
                      <div
                        key={g.slotLabel + '-' + g.rank}
                        data-runner-idx={gIdx}
                        className={`rounded-2xl px-3 py-2 transition ${
                          groupCompleted
                            ? 'bg-white/5 opacity-50'
                            : groupIsCurrent
                              ? 'bg-white/20 ring-2 ring-white/40'
                              : 'bg-white/5'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="text-[10px] text-white/50">{g.slotLabel}</div>
                          <div className="text-xs font-bold text-white/90">{g.rank}</div>
                        </div>
                        <div className="space-y-1">
                          {g.members.map(s => {
                            const key = s.token || s.name
                            const isCurrent = groupIsCurrent && !completedRunners.includes(key)
                            const isCompleted = completedRunners.includes(key)
                            return (
                              <button
                                key={key}
                                onClick={() => {
                                  if (!adminUnlocked) return
                                  if (isCompleted) return
                                  const passedKeys = []
                                  for (let i = 0; i < gIdx; i++) {
                                    groupedRunners[i].members.forEach(m => {
                                      const k = m.token || m.name
                                      if (!completedRunners.includes(k)) passedKeys.push(k)
                                    })
                                  }
                                  if (passedKeys.length > 0) {
                                    setCompletedRunners(prev => [...prev, ...passedKeys])
                                  }
                                  if (displayRunner !== s.name) {
                                    setDisplayRunner(s.name)
                                    const groupActiveMembers = g.members.filter(m => !completedRunners.includes(m.token || m.name))
                                    if (groupActiveMembers.length > 0) {
                                      const time = displayUseManualTime && displayManualTime ? displayManualTime + ':00' : getCurrentTime()
                                      const nowTs = Date.now()
                                      const groupLapId = `glap-${nowTs}`
                                      const newRecords = groupActiveMembers.map((m, idx) => ({
                                        id: nowTs + idx,
                                        participant: m.name,
                                        scheduleId: 0,
                                        className: '展示記錄',
                                        time,
                                        timestamp: nowTs,
                                        groupLapId,
                                      }))
                                      setLapRecords(prev => [...prev, ...newRecords])
                                      playBeep()
                                    }
                                  }
                                  setDisplayRightOpen(false)
                                  requestAnimationFrame(() => {
                                    const container = runnerListRef.current
                                    if (!container) return
                                    const topIdx = Math.max(0, gIdx - 1)
                                    const topRow = container.querySelector(`[data-runner-idx="${topIdx}"]`)
                                    if (topRow) {
                                      container.scrollTo({
                                        top: topRow.offsetTop - container.offsetTop,
                                        behavior: 'smooth',
                                      })
                                    }
                                  })
                                }}
                                disabled={isCompleted || !adminUnlocked}
                                className={`w-full flex items-center justify-between rounded-xl px-2 py-1.5 text-left transition ${
                                  isCompleted
                                    ? 'opacity-50 cursor-not-allowed line-through'
                                    : isCurrent
                                      ? 'bg-white/25'
                                      : adminUnlocked
                                        ? 'bg-white/5 hover:bg-white/15'
                                        : 'bg-white/5 cursor-default'
                                }`}
                              >
                                <div className="text-sm font-semibold truncate flex-1 min-w-0">{s.name}</div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {isCurrent && !isCompleted && (
                                    <ArrowRight className="w-4 h-4 animate-pulse" style={{ color: skin.displayAccent }} />
                                  )}
                                  {isCompleted && <Check className="w-4 h-4 text-emerald-400" />}
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
                {displayRunner && expectedSlot && (
                  <div className="mt-3 rounded-2xl bg-white/10 p-3">
                    <div className="text-[10px] text-white/50 uppercase tracking-[0.2em] mb-2">預期時間比較</div>
                    <div className="text-sm text-white">{displayRunner} 預定 {expectedSlot}</div>
                    <div className="mt-2 text-lg font-bold">
                      {scheduleDelta === null
                        ? '請先開始計時'
                        : scheduleDelta === 0
                          ? '剛好準時'
                          : scheduleDelta > 0
                            ? `慢 ${Math.abs(scheduleDelta)} 分鐘`
                            : `快 ${Math.abs(scheduleDelta)} 分鐘`}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 手動修改圈數彈窗 */}
            {showEditLapModal && (
              <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" onClick={() => setShowEditLapModal(false)}>
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
                <div className="relative w-full max-w-lg rounded-3xl bg-slate-950/95 border border-white/10 shadow-2xl p-6 text-white" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-xl font-bold">手動修改圈數</h3>
                      <p className="text-sm text-slate-400">可修改跑者、圈數與時間，或直接調整總圈數。</p>
                    </div>
                    <button onClick={() => setShowEditLapModal(false)} className="text-white/60 hover:text-white"><X className="w-5 h-5" /></button>
                  </div>
                  <div className="grid grid-cols-1 gap-4">
                    <div>
                      <label className="text-xs text-slate-400 uppercase tracking-[0.2em]">目前跑者修改</label>
                      <select
                        value={editLapRunner}
                        onChange={e => setEditLapRunner(e.target.value)}
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white focus:outline-none focus:border-sky-400"
                      >
                        <option value="">請選擇跑者</option>
                        {allRunners.map(name => <option key={name} value={name}>{name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 uppercase tracking-[0.2em]">跑者的第幾圈修改</label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={editLapNumber}
                        onChange={e => setEditLapNumber(e.target.value)}
                        placeholder="圈數編號"
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white focus:outline-none focus:border-sky-400"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 uppercase tracking-[0.2em]">時間修改</label>
                      <input
                        type="time"
                        value={editLapTime}
                        onChange={e => setEditLapTime(e.target.value)}
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white focus:outline-none focus:border-sky-400"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 uppercase tracking-[0.2em]">總圈數增減</label>
                      <input
                        type="number"
                        value={editLapAdjustment}
                        onChange={e => setEditLapAdjustment(e.target.value)}
                        placeholder="正數增加，負數減少"
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white focus:outline-none focus:border-sky-400"
                      />
                    </div>
                    {editLapError && (
                      <div className="rounded-2xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-200">
                        {editLapError}
                      </div>
                    )}
                  </div>
                  <div className="mt-6 flex items-center justify-end gap-3">
                    <button onClick={() => setShowEditLapModal(false)} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10">取消</button>
                    <button onClick={saveLapModification} className="rounded-2xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-400">儲存修改</button>
                  </div>
                </div>
              </div>
            )}

            {/* ══ 個人統計滑出面板 (Drawer) ══ */}
            {displayDrawerOpen && (
              <div className="fixed inset-0 z-[60] flex justify-end" onClick={() => setDisplayDrawerOpen(false)}>
                {/* 背景遮罩 */}
                <div className="absolute inset-0 bg-black/50 backdrop-blur-sm"/>
                {/* 面板 */}
                <div className="relative w-full max-w-md h-full overflow-y-auto shadow-2xl"
                  style={{ background: skin.displayBg }}
                  onClick={e => e.stopPropagation()}>
                  {/* 面板標題 */}
                  <div className="sticky top-0 z-10 px-5 py-4 flex items-center justify-between border-b border-white/10" style={{ background: skin.displayCard, backdropFilter: 'blur(12px)' }}>
                    <div>
                      <h2 className="text-lg font-black text-white">個人統計</h2>
                      <p className="text-xs text-white/40">共 {sortedStats.length} 位跑者，{totalLaps} 圈</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={exportDisplayLaps} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 flex items-center gap-1"><FileDown className="w-3 h-3" /> 匯出 CSV</button>
                      <button onClick={() => setDisplayDrawerOpen(false)} className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"><X className="w-4 h-4" /></button>
                    </div>
                  </div>
                  {/* 跑者列表 */}
                  <div className="p-4 space-y-2">
                    {sortedStats.length === 0 ? (
                      <div className="text-center text-white/30 py-16">尚無圈數記錄</div>
                    ) : sortedStats.map((s, idx) => {
                      const laps = getRunnerLaps(s.name).sort((a, b) => a.timestamp - b.timestamp)
                      return (
                        <details key={s.name} className="rounded-xl overflow-hidden group" style={{ background: skin.displayCard }}>
                          <summary className="flex items-center gap-3 p-4 cursor-pointer hover:bg-white/5 transition-colors list-none [&::-webkit-details-marker]:hidden">
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black shrink-0 ${
                              idx === 0 ? 'bg-yellow-500 text-yellow-900' : idx === 1 ? 'bg-gray-300 text-gray-700' : idx === 2 ? 'bg-amber-700 text-amber-100' : 'bg-white/10 text-white/50'
                            }`}>{idx + 1}</div>
                            <div className="flex-1 min-w-0">
                              <div className="font-bold text-white truncate">{s.name}</div>
                            </div>
                            <div className="text-3xl font-black shrink-0" style={{ color: skin.displayAccent }}>{s.totalLaps}</div>
                            <span className="text-xs text-white/30 shrink-0 ml-1">圈</span>
                            <ChevronRight className="text-white/20 w-4 h-4 ml-2 group-open:rotate-90 transition-transform" />
                          </summary>
                          <div className="px-4 pb-4 pt-1 border-t border-white/5">
                            <div className="grid grid-cols-4 sm:grid-cols-5 gap-1.5">
                              {laps.map((lap, i) => (
                                <div key={lap.id} className="rounded-lg bg-white/5 p-2 text-center group/lap relative">
                                  <div className="text-base font-black" style={{ color: skin.displayAccent }}>{i + 1}</div>
                                  <div className="text-[9px] text-white/40 font-mono">{lap.time}</div>
                                  <button
                                    onClick={() => deleteLapRecord(lap.id)}
                                    className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-transparent text-transparent group-hover/lap:bg-red-500 group-hover/lap:text-white flex items-center justify-center transition-all"
                                  ><X className="w-3 h-3" /></button>
                                </div>
                              ))}
                            </div>
                          </div>
                        </details>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
          )
        })()}

        {/* ═══════════════════════════════
            管理介面
        ═══════════════════════════════ */}
        {activeTab === 'admin' && !adminUnlocked && (
          <div className="max-w-sm mx-auto mt-12 animate-fade-in">
            <div className="card-dark overflow-hidden">
              <div className="px-8 pt-10 pb-8 text-center animate-slide-in"
                style={{ background: skin.adminGrad }}>
                <div className="w-20 h-20 rounded-3xl bg-white/20 backdrop-blur flex items-center justify-center mx-auto mb-4 shadow-lg animate-bounce-in"><Lock className="w-10 h-10 text-white" /></div>
                <h2 className="text-2xl font-black text-white mb-1">管理員驗證</h2>
                <p className="text-sm text-blue-200">請輸入管理密碼以繼續</p>
              </div>
              <div className="bg-white px-8 py-6">
                <div className="relative">
                  <input
                    type="password"
                    value={adminPwInput}
                    onChange={e => { setAdminPwInput(e.target.value); setAdminPwError(false) }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        if (adminPwInput === ADMIN_PASSWORD) { setAdminUnlocked(true); setAdminPwInput('') }
                        else { setAdminPwError(true); setAdminPwInput('') }
                      }
                    }}
                    placeholder="輸入密碼..."
                    className={`input-primary text-center ${adminPwError ? 'border-red-400 bg-red-50 focus:border-red-400' : ''}`}
                    autoFocus
                  />
                  {adminPwInput && !adminPwError && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-green-500 animate-pulse-gentle">
                      <Check className="w-5 h-5" />
                    </div>
                  )}
                </div>
                {adminPwError && (
                  <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-600 text-center mb-3 animate-fade-in">
                    <span className="flex items-center justify-center gap-2">
                      <XCircle className="w-5 h-5" />
                      <span>密碼錯誤，請再試一次</span>
                    </span>
                  </div>
                )}
                <button
                  onClick={() => {
                    if (adminPwInput === ADMIN_PASSWORD) { setAdminUnlocked(true); setAdminPwInput('') }
                    else { setAdminPwError(true); setAdminPwInput('') }
                  }}
                  className={`w-full btn-primary ${adminPwInput ? 'animate-pulse-gentle' : ''}`}
                >
                  <span className="flex items-center justify-center gap-2">
                    <Unlock className="w-5 h-5" />
                    <span>進入管理</span>
                    <ArrowRight className="w-4 h-4" />
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'admin' && adminUnlocked && (
          <div className="space-y-4">
            {/* 登出按鈕 */}
            <div className="flex justify-end">
              <button
                onClick={() => { setAdminUnlocked(false); setAdminPwInput('') }}
                className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1.5"
              ><Unlock className="w-3 h-3" /> 登出管理</button>
            </div>
            {/* 活動計時 */}
            <div className="bg-white rounded-xl shadow p-4 mb-4">
              <h2 className="font-bold text-gray-700 mb-3">活動計時</h2>
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                <p className="text-sm text-gray-500">開始後會顯示已進行時間，讓現場更好掌握進度。</p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={timerRunning ? resetTimer : startTimer}
                    className={`btn-primary ${timerRunning ? 'from-red-500 to-red-600 hover:from-red-600 hover:to-red-700' : ''}`}
                  >
                    {timerRunning ? '重設計時' : '開始計時'}
                  </button>
                  <div className="text-right">
                    <p className="text-xs text-gray-400">已進行</p>
                    <p className="text-lg font-black text-gray-800">{timerRunning ? elapsedTimeDisplay : '00:00:00'}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* 活動設定 */}
            <div className="bg-white rounded-xl shadow p-4">
              <h2 className="font-bold text-gray-700 mb-4">活動設定</h2>
              <div className="space-y-4">
                {/* 活動名稱 */}
                <div className="flex items-center gap-3">
                  <label className="text-sm text-gray-500 shrink-0 w-20">活動名稱</label>
                  {editingEventName ? (
                    <>
                      <input type="text" value={tempEventName} onChange={e => setTempEventName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { saveEventName(tempEventName.trim() || eventName); setEditingEventName(false) } if (e.key === 'Escape') setEditingEventName(false) }}
                        className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" autoFocus />
                      <button onClick={() => { saveEventName(tempEventName.trim() || eventName); setEditingEventName(false) }} className="bg-green-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-green-700">儲存</button>
                      <button onClick={() => setEditingEventName(false)} className="bg-gray-100 text-gray-600 px-3 py-2 rounded-lg text-sm hover:bg-gray-200">取消</button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 font-semibold text-gray-800">{eventName}</span>
                      <button onClick={() => { setTempEventName(eventName); setEditingEventName(true) }} className="bg-blue-50 text-blue-600 px-3 py-2 rounded-lg text-sm hover:bg-blue-100 flex items-center gap-1"><Pencil className="w-3 h-3" /> 修改</button>
                    </>
                  )}
                </div>

                {/* 活動日期 */}
                <div className="flex items-center gap-3">
                  <label className="text-sm text-gray-500 shrink-0 w-20">活動日期</label>
                  <input
                    type="text"
                    value={eventDate}
                    onChange={e => saveEventDate(e.target.value)}
                    placeholder="例：2026年5月10日（六）"
                    className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>

                {/* 結束時間 */}
                <div className="flex items-center gap-3">
                  <label className="text-sm text-gray-500 shrink-0 w-20">結束時間</label>
                  <div className="flex items-center gap-2 flex-1">
                    <div className="flex gap-1 flex-wrap">
                      {[16, 17, 18, 19, 20].map(h => (
                        <button
                          key={h}
                          onClick={() => saveExtraEndHour(h)}
                          className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                            extraEndHour === h
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                          }`}
                        >{h}:00</button>
                      ))}
                    </div>
                    {extraEndHour > 16 && (
                      <span className="text-xs text-green-600 bg-green-50 border border-green-200 px-2 py-1 rounded-lg">
                        已延長至 {extraEndHour}:00，新增 {(extraEndHour - 16) * 12} 個時段
                      </span>
                    )}
                  </div>
                </div>
                {/* 主題配色 */}
                <div className="flex items-center gap-3">
                  <label className="text-sm text-gray-500 shrink-0 w-20">主題配色</label>
                  <div className="flex gap-2 flex-wrap">
                    {Object.entries(SKINS).map(([key, s]) => (
                      <button
                        key={key}
                        onClick={() => setSkinKey(key)}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                          skinKey === key ? 'border-gray-800 ring-2 ring-gray-300' : 'border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <span className="w-4 h-4 rounded-full shrink-0 shadow-inner" style={{ background: s.header }}/>
                        {s.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* 報名管理：依人名 / 依時段切換 */}
            <div className="bg-white rounded-xl shadow p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <h2 className="font-bold text-gray-700">報名管理</h2>
                  {/* 切換檢視模式 */}
                  <div className="flex rounded-lg border overflow-hidden text-xs">
                    <button
                      onClick={() => setAdminViewMode('person')}
                      className={`px-3 py-1.5 font-medium transition-colors ${adminViewMode === 'person' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
                    >依人名</button>
                    <button
                      onClick={() => setAdminViewMode('slot')}
                      className={`px-3 py-1.5 font-medium transition-colors border-l ${adminViewMode === 'slot' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
                    >依時段</button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={printNotices} className="text-xs bg-blue-500 text-white px-3 py-1.5 rounded-lg hover:bg-blue-600 flex items-center gap-1"><ClipboardSignature className="w-3 h-3" /> 列印通知單</button>
                  <button onClick={exportSignups} className="text-xs bg-gray-100 text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-200 flex items-center gap-1"><FileDown className="w-3 h-3" /> 匯出</button>
                </div>
              </div>

              {signups.length === 0 ? <p className="text-gray-400 text-sm">尚無登記</p> : (
                <>
                  {/* ── 依人名（按時段排序，每時段每人一列，空時段顯示「無人登記」） ── */}
                  {adminViewMode === 'person' && (() => {
                    // 先收集有登記的人（依時段展開）與沒登記者（時段為 null）
                    const signupRows = []
                    signups.forEach(s => {
                      if (s.slots.length === 0) { signupRows.push({ s, slot: null }); return }
                      [...s.slots].sort().forEach(slot => signupRows.push({ s, slot }))
                    })
                    // 以時段分群
                    const bySlot = new Map()
                    signupRows.forEach(r => {
                      if (r.slot === null) return
                      if (!bySlot.has(r.slot)) bySlot.set(r.slot, [])
                      bySlot.get(r.slot).push(r.s)
                    })
                    // 產生完整列：遍歷所有時段，有人列多筆、沒人列一筆空
                    const rows = []
                    TIME_SLOTS.forEach(slot => {
                      const sgs = bySlot.get(slot) || []
                      if (sgs.length === 0) { rows.push({ slot, s: null }); return }
                      sgs.sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'))
                        .forEach(s => rows.push({ slot, s }))
                    })
                    // 未選時段的人放最後
                    signupRows.filter(r => r.slot === null).forEach(r => rows.push({ slot: null, s: r.s }))
                    return (
                      <div className="divide-y border rounded-lg overflow-hidden">
                        {rows.map((r, idx) => {
                          const { s, slot } = r
                          if (!s) {
                            return (
                              <div key={`empty-${slot}-${idx}`} className="flex items-center gap-2 sm:gap-3 px-2 sm:px-3 py-2 bg-gray-50">
                                <div className="shrink-0 w-16 sm:w-20 font-mono text-sm text-gray-500 font-semibold text-center">{slot}</div>
                                <span className="text-xs text-gray-400 italic">無人登記</span>
                              </div>
                            )
                          }
                          return (
                            <div key={`${s.id}-${slot || 'none'}-${idx}`} className="flex items-center gap-2 sm:gap-3 px-2 sm:px-3 py-2 hover:bg-gray-50">
                              <div className="shrink-0 w-16 sm:w-20 font-mono text-sm text-gray-700 font-semibold text-center">{slot || '—'}</div>
                              <button
                                onClick={() => { setAdminGridToken(s.token); setAdminGridSlots([...s.slots]) }}
                                className="font-semibold text-blue-600 hover:text-blue-800 hover:underline text-sm"
                              >{s.name}</button>
                              <span className="text-xs text-gray-400 font-mono">{s.token}</span>
                              <div className="text-xs text-gray-400 flex-1 min-w-0 truncate">共 {s.slots.length} 個時段</div>
                              <button
                                onClick={async () => { if (confirm(`確定要刪除「${s.name}」的全部登記？`)) await deleteDoc(doc(db, 'signups', s.token)) }}
                                className="text-red-400 hover:text-red-600 shrink-0"><Trash2 className="w-4 h-4" /></button>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}

                  {/* ── 依時段（條列式：每個時段一列，含空時段）── */}
                  {adminViewMode === 'slot' && (
                    <div className="divide-y border rounded-lg overflow-hidden">
                      {TIME_SLOTS.map(slot => {
                        const sgs = signups.filter(s => s.slots.includes(slot))
                        const count = sgs.length
                        const rowCls = count === 0
                          ? 'bg-gray-50'
                          : count <= 2
                          ? 'bg-yellow-50'
                          : count <= 4
                          ? 'bg-orange-50'
                          : 'bg-red-50'
                        const badgeCls = count === 0
                          ? 'bg-gray-200 text-gray-500'
                          : count <= 2
                          ? 'bg-yellow-200 text-yellow-800'
                          : count <= 4
                          ? 'bg-orange-200 text-orange-800'
                          : 'bg-red-200 text-red-800'
                        return (
                          <div key={slot} className={`flex items-center gap-2 sm:gap-3 px-2 sm:px-3 py-2 ${rowCls}`}>
                            <div className="shrink-0 w-14 sm:w-16 font-mono font-bold text-sm text-gray-700 text-center">{slot}</div>
                            <div className={`shrink-0 text-xs font-semibold rounded-full px-2 py-0.5 ${badgeCls}`}>{count} 人</div>
                            <div className="flex flex-wrap gap-1 flex-1 min-w-0">
                              {count === 0 ? (
                                <span className="text-xs text-gray-400 italic">無人登記</span>
                              ) : (
                                sgs.map(s => (
                                  <button key={s.id}
                                    onClick={() => { setAdminGridToken(s.token); setAdminGridSlots([...s.slots]) }}
                                    className="text-xs bg-white border border-blue-300 text-blue-700 hover:bg-blue-50 rounded-full px-2 py-0.5 font-medium"
                                    title={`點擊編輯 ${s.name} 的登記`}
                                  >{s.name}</button>
                                ))
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* 管理頁浮動時間軸視窗 */}
            {adminGridToken && (() => {
              const rec = signups.find(s => s.token === adminGridToken)
              if (!rec) return null

              // 管理員版的格子顏色（排除自己已選，計算他人數量）
              const adminSlotStatus = (slot) => {
                const othersCount = signups.filter(s => s.token !== adminGridToken && s.slots.includes(slot)).length
                if (adminGridSlots.includes(slot)) return 'selected'
                if (othersCount >= MAX_PER_SLOT) return 'full'
                if (othersCount === 1) return 'one'
                return 'empty'
              }
              const adminCellClass = (slot) => {
                const st = adminSlotStatus(slot)
                if (st === 'selected') return 'bg-blue-500 text-white border-blue-600 ring-2 ring-blue-300'
                if (st === 'full') return 'bg-red-100 border-red-300 text-red-600 cursor-not-allowed'
                if (st === 'one') return 'bg-orange-100 border-orange-300 text-orange-700 cursor-pointer hover:bg-orange-200'
                return 'bg-green-50 border-green-300 text-green-700 cursor-pointer hover:bg-green-100'
              }
              const toggleAdminSlot = (slot) => {
                const st = adminSlotStatus(slot)
                if (st === 'full') return
                setAdminGridSlots(prev =>
                  prev.includes(slot) ? prev.filter(s => s !== slot) : [...prev, slot]
                )
              }
              const saveAdminGrid = async () => {
                await setDoc(doc(db, 'signups', adminGridToken), { ...rec, slots: [...adminGridSlots] })
                setAdminGridToken(null)
                setAdminGridSlots([])
              }

              return (
                <div className="fixed inset-0 z-40 bg-black/50 flex items-end sm:items-start justify-center sm:overflow-y-auto sm:py-4 sm:px-4">
                  <div className="bg-white w-full sm:rounded-2xl sm:shadow-2xl sm:max-w-2xl
                    rounded-t-3xl shadow-2xl max-h-[92vh] flex flex-col overflow-hidden">
                    {/* 標題 */}
                    <div className="px-4 sm:px-5 py-3 sm:py-4 border-b flex items-center justify-between shrink-0">
                      <div className="absolute top-2 left-1/2 -translate-x-1/2 w-10 h-1 bg-gray-300 rounded-full sm:hidden"/>
                      <div className="mt-2 sm:mt-0">
                        <span className="font-bold text-gray-800 text-base sm:text-lg">{rec.name}</span>
                        <span className="text-gray-500 text-sm ml-2">修改時段登記</span>
                        <span className="text-xs text-gray-400 ml-2 font-mono hidden sm:inline">#{rec.token}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="hidden sm:block"><Legend /></div>
                        <button onClick={() => { setAdminGridToken(null); setAdminGridSlots([]) }} className="text-gray-400 hover:text-gray-600 leading-none ml-2"><X className="w-5 h-5" /></button>
                      </div>
                    </div>

                    {/* 已選提示 */}
                    {adminGridSlots.length > 0 && (
                      <div className="mx-3 sm:mx-5 mt-3 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 flex flex-wrap gap-1.5 items-center shrink-0">
                        <span className="text-xs text-blue-500 mr-1">已選：</span>
                        {[...adminGridSlots].sort().map(s => (
                          <span key={s} className="bg-blue-500 text-white text-xs px-2 py-0.5 rounded-full flex items-center gap-1">
                            {s}
                            <button onClick={() => toggleAdminSlot(s)} className="hover:text-blue-200"><X className="w-3 h-3" /></button>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* 時間軸（可捲動） */}
                    <div className="overflow-y-auto flex-1 p-3 sm:p-4 space-y-1">
                      {TIME_BLOCKS.map((block) => {
                        const blockSlots = getSlotsInBlock(block, TIME_SLOTS)
                        const anySelected = blockSlots.some(s => adminGridSlots.includes(s))
                        const activeLabelStyle = anySelected ? 'bg-blue-600 text-white border-blue-600' : LABEL_STYLE[block.type]
                        return (
                          <div key={block.label + block.start}
                            className={`flex items-start gap-1.5 sm:gap-2 px-1.5 sm:px-2 py-1.5 rounded-xl transition-colors ${anySelected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                            <div className={`shrink-0 w-14 sm:w-16 rounded-xl border text-center py-1.5 leading-tight ${activeLabelStyle}`}>
                            {ICON_MAP[block.type] && (() => {
                              const Icon = ICON_MAP[block.type];
                              return <div className="flex justify-center mb-0.5"><Icon className={`w-4 h-4 ${anySelected ? 'text-white' : skin.iconColor}`} /></div>
                            })()}
                              <div className="text-xs sm:text-sm font-bold">{block.label}</div>
                              <div className="text-[9px] sm:text-[10px] opacity-60 mt-0.5">{block.start}</div>
                              <div className="text-[9px] sm:text-[10px] opacity-60">–{block.end}</div>
                            </div>
                            <div className="flex flex-wrap gap-1 flex-1">
                              {blockSlots.map(slot => {
                                const st = adminSlotStatus(slot)
                                const names = signups.filter(s => s.token !== adminGridToken && s.slots.includes(slot)).map(s => s.name)
                                return (
                                  <button key={slot}
                                    onClick={() => toggleAdminSlot(slot)}
                                    title={names.length > 0 ? `${slot}：${names.join('、')}` : slot}
                                    className={`border rounded-lg text-center transition-all ${adminCellClass(slot)}`}
                                    style={{ width: '38px', height: '38px' }}
                                  >
                                    <div className="text-[10px] font-bold leading-none">{slot}</div>
                                    {names.length > 0 && (
                                      <div className="text-[8px] leading-tight mt-0.5 truncate px-0.5 opacity-80">{names[0]}{names.length > 1 ? `+${names.length-1}` : ''}</div>
                                    )}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {/* 底部 */}
                    <div className="border-t px-4 sm:px-5 py-3 sm:py-4 flex items-center justify-between gap-3 shrink-0">
                      <div className="text-sm text-gray-500">
                        已選 <span className="font-bold text-blue-600">{adminGridSlots.length}</span> 個時段
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={async () => { if (confirm(`確定刪除「${rec.name}」的所有登記？`)) { await deleteDoc(doc(db, 'signups', adminGridToken)); setAdminGridToken(null); setAdminGridSlots([]) } }}
                          className="px-3 sm:px-4 py-2 rounded-xl border border-red-200 text-sm text-red-500 hover:bg-red-50"
                        >刪除此人</button>
                        <button
                          onClick={() => { setAdminGridToken(null); setAdminGridSlots([]) }}
                          className="px-3 sm:px-4 py-2 rounded-xl border text-sm text-gray-600 hover:bg-gray-50"
                        >取消</button>
                        <button
                          onClick={saveAdminGrid}
                          className="px-4 sm:px-6 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
                        >儲存修改</button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* 統計資料 */}
            <div className="bg-white rounded-xl shadow p-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg" style={{ background: skin.cardGrad }}><BarChart3 className="w-5 h-5 text-white" /></div>
                <h2 className="font-bold text-gray-700 text-base sm:text-lg">統計資料</h2>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-4">
                {[
                  ['總圈數', lapRecords.length, skin.statCards[0], Activity],
                  ['參加人數', stats.length, skin.statCards[1], Users],
                  ['登記時段數', signups.reduce((a,s)=>a+s.slots.length,0), skin.statCards[2], CalendarCheck],
                ].map(([label, val, grad, Icon]) => (
                  <div key={label} className={`bg-gradient-to-br ${grad} rounded-2xl shadow p-3 sm:p-4 text-center text-white`}>
                    <div className="mb-2 flex justify-center"><Icon className="w-6 h-6 sm:w-8 sm:h-8 opacity-90" /></div>
                    <div className="text-2xl sm:text-3xl font-black leading-none">{val}</div>
                    <div className="text-[10px] sm:text-xs opacity-80 mt-1.5 leading-tight font-medium">{label}</div>
                  </div>
                ))}
              </div>
              {schedules.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-bold text-gray-600 mb-2">各時段圈數</h3>
                  <div className="space-y-2">
                    {schedules.map(s => {
                      const count = lapRecords.filter(r => r.scheduleId === s.id).length
                      const max = Math.max(...schedules.map(ss => lapRecords.filter(r => r.scheduleId === ss.id).length), 1)
                      return (
                        <div key={s.id} className="flex items-center gap-3">
                          <div className="w-14 text-sm text-gray-600 shrink-0">{s.time}</div>
                          <div className="text-sm text-gray-700 w-20 shrink-0 truncate">{s.class}</div>
                          <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                            <div className="bg-blue-400 h-4 rounded-full transition-all" style={{ width: `${(count/max)*100}%` }}/>
                          </div>
                          <div className="text-sm font-bold text-blue-600 w-8 text-right shrink-0">{count}</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              <div className="border-t pt-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold text-gray-600">個人圈數統計</h3>
                  <button onClick={exportResults} className="bg-blue-600 text-white px-3 py-1 rounded-lg text-xs hover:bg-blue-700 flex items-center gap-1"><FileDown className="w-3 h-3" /> 匯出 CSV</button>
                </div>
                {stats.length === 0 ? <p className="text-gray-400 text-sm">尚無記錄</p> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b text-gray-500 text-left">
                        <th className="pb-2 font-medium">姓名</th>
                        <th className="pb-2 font-medium text-right">總圈數</th>
                        <th className="pb-2 font-medium pl-4">參與時段</th>
                      </tr></thead>
                      <tbody>
                        {stats.map(s => (
                          <tr key={s.name} className="border-b last:border-0 hover:bg-gray-50">
                            <td className="py-2 font-medium text-gray-800">{s.name}</td>
                            <td className="py-2 text-right font-bold text-blue-600">{s.totalLaps}</td>
                            <td className="py-2 pl-4 text-gray-400 text-xs">{s.classes}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* 資料清除 */}
            <div className="bg-white rounded-xl shadow p-4 border border-red-100">
              <h2 className="font-bold text-red-600 mb-3">資料管理</h2>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => { if (confirm('確定清除所有圈數記錄？')) setLapRecords([]) }} className="bg-red-50 text-red-600 border border-red-200 px-4 py-2 rounded-lg text-sm hover:bg-red-100">清除圈數記錄</button>
                <button onClick={async () => {
                  if (!confirm('確定清除所有報名資料？')) return
                  const batch = writeBatch(db)
                  signups.forEach(s => batch.delete(doc(db, 'signups', s.token)))
                  await batch.commit()
                }} className="bg-red-50 text-red-600 border border-red-200 px-4 py-2 rounded-lg text-sm hover:bg-red-100">清除報名資料</button>
                <button onClick={async () => {
                  if (!confirm('確定清除所有資料？此動作無法復原！')) return
                  const batch = writeBatch(db)
                  signups.forEach(s => batch.delete(doc(db, 'signups', s.token)))
                  await batch.commit()
                  setParticipants([]); setSchedules([]); setLapRecords([])
                }} className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700">全部清除</button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* 查詢時段結果彈窗 */}
      {queryResult && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => { setQueryResult(null); setQueryToken('') }}/>
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 animate-bounce-in">
            <button
              onClick={() => { setQueryResult(null); setQueryToken('') }}
              className="absolute top-3 right-3 text-gray-400 hover:text-gray-600"
            ><X className="w-5 h-5" /></button>
            <div className="text-center mb-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center mx-auto mb-3 shadow-lg"><ClipboardSignature className="w-7 h-7 text-white" /></div>
              <h3 className="text-lg font-bold text-gray-800">您的登記資訊</h3>
            </div>
            <div className="space-y-3">
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="text-xs text-gray-400 mb-1">姓名</div>
                <div className="font-bold text-gray-800 text-lg">{queryResult.name}</div>
              </div>
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-3">
                <div className="text-xs text-blue-500 mb-1">修改碼</div>
                <div className="font-mono font-black text-blue-600 text-xl tracking-[0.2em]">{queryResult.token}</div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="text-xs text-gray-400 mb-2">已登記時段（{queryResult.slots.length} 個）</div>
                <div className="flex flex-wrap gap-1.5">
                  {[...queryResult.slots].sort().map(s => (
                    <span key={s} className="bg-blue-500 text-white text-xs px-2.5 py-1 rounded-full font-mono font-semibold">{s}</span>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => { setQueryResult(null); setQueryToken('') }}
                className="flex-1 btn-secondary"
              >關閉</button>
              <button
                onClick={() => {
                  const rec = queryResult
                  setEditToken(rec.token); setEditRecord(rec); setSignupNameInput(rec.name); setSignupSelectedSlots([...rec.slots]); setSignupStep('grid')
                  setQueryResult(null); setQueryToken('')
                }}
                className={`flex-1 bg-gradient-to-r ${skin.btnGrad} text-white py-2.5 rounded-xl font-bold shadow`}
              >修改</button>
            </div>
          </div>
        </div>
      )}

      {/* 確認對話框 */}
      {confirmDialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setConfirmDialog(null)}/>
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 animate-bounce-in">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center mx-auto mb-4 shadow-lg"><AlertTriangle className="w-8 h-8 text-white" /></div>
              <h3 className="text-lg font-bold text-gray-800 mb-2">{confirmDialog.title}</h3>
              <p className="text-gray-600 text-sm mb-6">{confirmDialog.message}</p>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    confirmDialog.onCancel?.()
                    setConfirmDialog(null)
                  }}
                  className="flex-1 btn-secondary"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    confirmDialog.onConfirm?.()
                    setConfirmDialog(null)
                  }}
                  className="flex-1 btn-danger"
                >
                  確認
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 工具提示 */}
      {tooltip && (
        <div
          className="fixed z-[90] bg-gray-800 text-white text-sm px-3 py-2 rounded-lg shadow-lg pointer-events-none animate-fade-in"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  )
}
