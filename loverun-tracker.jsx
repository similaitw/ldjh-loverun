import { useState, useEffect, useRef, useCallback } from 'react'
import { db } from './lib/firebase'
import {
  collection, doc, onSnapshot,
  setDoc, deleteDoc, writeBatch
} from 'firebase/firestore'

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

// 產生 token（8位隨機英數）
const genToken = () => Math.random().toString(36).slice(2, 10).toUpperCase()

const BEEP_SOUND = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmEfAzuM1O/1dy0FIHfI7NyOPggXZbjmqqtVFgw+ltv7w3QpBSmBzvHYhTZJQJ7Y8LlqHAY3kNTv1XIqBSl8xuzcjTwIC2m06vKVVQwNUKzlmn7tBA=='

// 每時段不限人數，純顯示用
const MAX_PER_SLOT = 0 // 已停用，保留供參考

// ── 主題 Skin ──
const SKINS = {
  ocean:  { name: '深海藍', header: 'linear-gradient(135deg, #1e3a5f 0%, #1d4ed8 50%, #0891b2 100%)', page: 'from-slate-200 via-blue-100 to-cyan-100', accent: 'blue', tabActive: 'bg-white text-blue-700 shadow-md', tabInactive: 'text-blue-100 hover:bg-white/20', subtextHeader: 'text-blue-200', badgeColor: 'text-yellow-300', btnGrad: 'from-blue-600 to-blue-500', btnHover: 'hover:from-blue-700 hover:to-blue-600', cardGrad: 'linear-gradient(135deg, #1e3a5f 0%, #1d4ed8 60%, #0891b2 100%)', adminGrad: 'linear-gradient(135deg, #1e3a5f 0%, #1d4ed8 100%)', statCards: ['from-blue-500 to-blue-600','from-emerald-500 to-emerald-600','from-violet-500 to-violet-600'] },
  sunset: { name: '日落橙', header: 'linear-gradient(135deg, #7c2d12 0%, #ea580c 50%, #f59e0b 100%)', page: 'from-orange-100 via-amber-100 to-yellow-100', accent: 'orange', tabActive: 'bg-white text-orange-700 shadow-md', tabInactive: 'text-orange-100 hover:bg-white/20', subtextHeader: 'text-orange-200', badgeColor: 'text-yellow-200', btnGrad: 'from-orange-600 to-amber-500', btnHover: 'hover:from-orange-700 hover:to-amber-600', cardGrad: 'linear-gradient(135deg, #7c2d12 0%, #ea580c 60%, #f59e0b 100%)', adminGrad: 'linear-gradient(135deg, #7c2d12 0%, #ea580c 100%)', statCards: ['from-orange-500 to-orange-600','from-amber-500 to-amber-600','from-rose-500 to-rose-600'] },
  forest: { name: '森林綠', header: 'linear-gradient(135deg, #14532d 0%, #16a34a 50%, #22d3ee 100%)', page: 'from-green-100 via-emerald-100 to-teal-100', accent: 'green', tabActive: 'bg-white text-green-700 shadow-md', tabInactive: 'text-green-100 hover:bg-white/20', subtextHeader: 'text-green-200', badgeColor: 'text-yellow-300', btnGrad: 'from-green-600 to-emerald-500', btnHover: 'hover:from-green-700 hover:to-emerald-600', cardGrad: 'linear-gradient(135deg, #14532d 0%, #16a34a 60%, #22d3ee 100%)', adminGrad: 'linear-gradient(135deg, #14532d 0%, #16a34a 100%)', statCards: ['from-green-500 to-green-600','from-teal-500 to-teal-600','from-cyan-500 to-cyan-600'] },
  sakura: { name: '櫻花粉', header: 'linear-gradient(135deg, #831843 0%, #db2777 50%, #f472b6 100%)', page: 'from-pink-100 via-rose-100 to-fuchsia-100', accent: 'pink', tabActive: 'bg-white text-pink-700 shadow-md', tabInactive: 'text-pink-100 hover:bg-white/20', subtextHeader: 'text-pink-200', badgeColor: 'text-yellow-200', btnGrad: 'from-pink-600 to-rose-500', btnHover: 'hover:from-pink-700 hover:to-rose-600', cardGrad: 'linear-gradient(135deg, #831843 0%, #db2777 60%, #f472b6 100%)', adminGrad: 'linear-gradient(135deg, #831843 0%, #db2777 100%)', statCards: ['from-pink-500 to-pink-600','from-rose-500 to-rose-600','from-fuchsia-500 to-fuchsia-600'] },
  night:  { name: '暗夜紫', header: 'linear-gradient(135deg, #312e81 0%, #7c3aed 50%, #a855f7 100%)', page: 'from-violet-100 via-purple-100 to-indigo-100', accent: 'purple', tabActive: 'bg-white text-purple-700 shadow-md', tabInactive: 'text-purple-100 hover:bg-white/20', subtextHeader: 'text-purple-200', badgeColor: 'text-yellow-300', btnGrad: 'from-purple-600 to-violet-500', btnHover: 'hover:from-purple-700 hover:to-violet-600', cardGrad: 'linear-gradient(135deg, #312e81 0%, #7c3aed 60%, #a855f7 100%)', adminGrad: 'linear-gradient(135deg, #312e81 0%, #7c3aed 100%)', statCards: ['from-purple-500 to-purple-600','from-violet-500 to-violet-600','from-indigo-500 to-indigo-600'] },
}

// ── 往年回顧資料 ──
const PAST_EVENTS = [
  { year: '往年', type: 'video', title: '羅東愛心路跑精彩回顧', url: 'https://www.youtube.com/watch?v=9HWyDIqItB4', embedId: '9HWyDIqItB4' },
  { year: '往年', type: 'album', title: '活動照片集', url: 'https://photos.app.goo.gl/ofwnpgqwH3dgF2mB7' },
]

export default function LoveRunTracker() {
  const [participants, setParticipants] = useState([])
  const [schedules, setSchedules] = useState([])
  const [lapRecords, setLapRecords] = useState([])
  // signups: { id, name, token, slots: ['08:00','08:05',...], note, createdAt }
  const [signups, setSignups] = useState([])
  const [eventName, setEventName] = useState('羅東愛心路跑')
  const [activeTab, setActiveTab] = useState('signup')
  const [skinKey, setSkinKey] = useState('ocean')
  const [currentParticipant, setCurrentParticipant] = useState('')
  const [currentSchedule, setCurrentSchedule] = useState('')
  const [currentTime, setCurrentTime] = useState('')
  const [isFullscreen, setIsFullscreen] = useState(false)

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

  // 管理頁報名視窗
  const [adminGridToken, setAdminGridToken] = useState(null)   // 正在管理的 token
  const [adminGridSlots, setAdminGridSlots] = useState([])     // 暫存修改中的時段
  const [adminViewMode, setAdminViewMode] = useState('person') // 'person' | 'slot'

  const audioRef = useRef(null)
  const displayRef = useRef(null)

  // ── 本地資料（localStorage） ──
  useEffect(() => {
    try {
      const p = localStorage.getItem('loverun_participants')
      const sc = localStorage.getItem('loverun_schedules')
      const lr = localStorage.getItem('loverun_lapRecords')
      if (p) setParticipants(JSON.parse(p))
      if (sc) setSchedules(JSON.parse(sc))
      if (lr) setLapRecords(JSON.parse(lr))
      const sk = localStorage.getItem('loverun_skin')
      if (sk && SKINS[sk]) setSkinKey(sk)
    } catch (e) {}
  }, [])

  useEffect(() => { localStorage.setItem('loverun_participants', JSON.stringify(participants)) }, [participants])
  useEffect(() => { localStorage.setItem('loverun_schedules', JSON.stringify(schedules)) }, [schedules])
  useEffect(() => { localStorage.setItem('loverun_lapRecords', JSON.stringify(lapRecords)) }, [lapRecords])
  useEffect(() => { localStorage.setItem('loverun_skin', skinKey) }, [skinKey])

  const skin = SKINS[skinKey]

  // ── Firestore 即時監聽：報名資料 ──
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'signups'), (snapshot) => {
      const data = snapshot.docs.map(d => d.data())
      setSignups(data)
    })
    return () => unsub()
  }, [])

  // ── Firestore 即時監聽：設定（活動名稱、結束時間） ──
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'main'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data()
        if (data.eventName) setEventName(data.eventName)
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
  const ICON_MAP = { period: '', free: '', break: '☕', meal: '🍱', rest: '😴', extra: '⏰' }

  // 圖例元件（共用）
  const Legend = () => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-200 border border-green-400 inline-block"/>空</span>
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-200 border border-yellow-400 inline-block"/>1–2人</span>
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-200 border border-orange-400 inline-block"/>3–4人</span>
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-200 border border-red-400 inline-block"/>5人+</span>
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-500 inline-block"/>已選</span>
    </div>
  )

  const TABS = [
    { key: 'signup', label: '📋 報名登記' },
    { key: 'display', label: '📺 展示' },
    { key: 'admin', label: '⚙️ 管理' },
  ]

  return (
    <div className={`min-h-screen bg-gradient-to-br ${skin.page}`}>
      <audio ref={audioRef} preload="auto"><source src={BEEP_SOUND} type="audio/wav" /></audio>

      {/* 標題列 */}
      <header className="sticky top-0 z-10 shadow-lg"
        style={{ background: skin.header }}>
        <div className="max-w-3xl mx-auto px-4 pt-3 pb-1 flex items-center justify-between gap-4">
          <button onClick={() => setActiveTab('signup')} className="text-left hover:opacity-90 transition-opacity flex items-center gap-3 min-w-0">
            <span className="text-2xl sm:text-3xl shrink-0">🏃‍♀️</span>
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-extrabold text-white leading-tight tracking-wide truncate">{eventName}</h1>
              <p className={`text-[11px] ${skin.subtextHeader} font-medium`}>時段登記系統</p>
            </div>
          </button>
          <div className="flex items-center gap-3">
            {/* 主題切換 */}
            <div className="relative group">
              <button className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-sm transition-colors" title="切換主題">🎨</button>
              <div className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-2xl border border-gray-200 p-2 hidden group-hover:block min-w-[120px] z-50">
                {Object.entries(SKINS).map(([key, s]) => (
                  <button key={key} onClick={() => setSkinKey(key)}
                    className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2 ${skinKey === key ? 'bg-gray-100 font-bold' : 'hover:bg-gray-50'}`}>
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: s.header }}/>
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-xl sm:text-2xl font-mono font-bold text-white tabular-nums">{currentTime}</div>
              <div className={`text-[11px] ${skin.subtextHeader}`}>已登記 <span className={`font-bold ${skin.badgeColor}`}>{signups.length}</span> 人</div>
            </div>
          </div>
        </div>
        <div className="max-w-3xl mx-auto px-3 flex gap-1 py-2 overflow-x-auto">
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${
                activeTab === tab.key ? skin.tabActive : skin.tabInactive
              }`}>{tab.label}</button>
          ))}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-3 sm:px-4 py-4 sm:py-6">

        {/* ═══════════════════════════════
            報名登記
        ═══════════════════════════════ */}
        {activeTab === 'signup' && (
          <div>
            {/* 修改模式提示橫幅 */}
            {editToken && editRecord && (
              <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center justify-between">
                <div className="text-sm text-blue-700">
                  ✏️ 修改模式：<span className="font-bold">{editRecord.name}</span> 的登記
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
                    { label: '已登記人數', value: signups.length, color: skin.statCards[0], icon: '👥' },
                    { label: '已佔用時段', value: [...new Set(signups.flatMap(s => s.slots))].length, color: skin.statCards[1], icon: '📅' },
                    { label: '可用時段', value: Math.max(0, TIME_SLOTS.length - [...new Set(signups.flatMap(s => s.slots))].length), color: skin.statCards[2], icon: '✨' },
                  ].map(({ label, value, color, icon }) => (
                    <div key={label} className={`bg-gradient-to-br ${color} rounded-2xl p-3 text-white text-center shadow-md`}>
                      <div className="text-base sm:text-lg mb-0.5">{icon}</div>
                      <div className="text-xl sm:text-2xl font-black leading-none">{value}</div>
                      <div className="text-[9px] sm:text-[10px] opacity-80 mt-1 leading-tight">{label}</div>
                    </div>
                  ))}
                </div>

                {/* 登記表單卡片 */}
                <div className="bg-white rounded-2xl shadow-xl p-4 sm:p-6 border border-gray-100">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white text-lg shadow">📋</div>
                    <div>
                      <h2 className="text-base sm:text-lg font-extrabold text-gray-800 leading-tight">時段登記</h2>
                      <p className="text-xs text-gray-400">輸入姓名後選擇想登記的時段</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={signupNameInput}
                      onChange={e => setSignupNameInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && signupNameInput.trim()) setSignupStep('grid') }}
                      placeholder="請輸入您的姓名..."
                      list="participant-list"
                      className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-blue-400 transition-colors"
                      autoFocus
                    />
                    <datalist id="participant-list">
                      {participants.map(n => <option key={n} value={n} />)}
                    </datalist>
                    <button
                      onClick={() => { if (signupNameInput.trim()) setSignupStep('grid') }}
                      disabled={!signupNameInput.trim()}
                      className={`w-full bg-gradient-to-r ${skin.btnGrad} disabled:from-gray-200 disabled:to-gray-200 disabled:text-gray-400 text-white py-3 rounded-xl text-base font-bold ${skin.btnHover} transition-all shadow-md disabled:shadow-none`}
                    >選擇時段 →</button>
                  </div>

                  {/* 已有登記可查詢 */}
                  {signups.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-dashed">
                      <p className="text-xs text-gray-400 mb-2">已有登記？輸入修改碼查詢</p>
                      <input
                        type="text"
                        placeholder="修改碼（8碼）"
                        maxLength={8}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            const t = e.target.value.trim().toUpperCase()
                            const rec = signups.find(s => s.token === t)
                            if (rec) { setEditToken(t); setEditRecord(rec); setSignupNameInput(rec.name); setSignupSelectedSlots([...rec.slots]); setSignupStep('grid') }
                            else alert('找不到此修改碼')
                          }
                        }}
                        className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 font-mono uppercase"
                      />
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
                    <div className="absolute inset-0 z-20 bg-white/70 rounded-t-3xl sm:rounded-2xl flex flex-col items-center justify-center gap-3">
                      <svg className="animate-spin h-10 w-10 text-blue-500" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                      </svg>
                      <div className="text-blue-600 font-semibold text-base">正在儲存登記…</div>
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
                      >×</button>
                    </div>
                  </div>

                  {/* 系統建議時段 */}
                  {signupSelectedSlots.length === 0 && (
                    <div className="mx-3 sm:mx-5 mt-3 bg-green-50 border border-green-200 rounded-xl px-3 py-2 flex items-center justify-between gap-3">
                      <div className="text-xs sm:text-sm text-green-700">💡 系統可自動排入較空時段，或直接點選格子</div>
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
                          <button onClick={() => toggleSlot(s)} className="hover:text-blue-200">×</button>
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
                          <div className={`shrink-0 w-12 sm:w-14 rounded-lg border text-center py-1 leading-tight ${activeLabelStyle}`}>
                            {ICON_MAP[block.type] && <div className="text-xs leading-none mb-0.5">{ICON_MAP[block.type]}</div>}
                            <div className="text-[10px] sm:text-xs font-bold">{block.label}</div>
                            <div className="text-[8px] opacity-60 mt-0.5">{block.start}</div>
                            <div className="text-[8px] opacity-60">–{block.end}</div>
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
                    <div className="text-5xl mb-3">{editRecord ? '✏️' : '🎉'}</div>
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
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-lg">🔑</span>
                    <span className="text-sm font-bold text-gray-700">您的修改碼（請妥善保存）</span>
                  </div>
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-3 mb-3 text-center">
                    <div className="text-3xl font-mono font-black text-blue-600 tracking-[0.3em]">{signupDoneToken}</div>
                  </div>
                  <button
                    onClick={() => copyLink(signupDoneToken)}
                    className={`w-full bg-gradient-to-r ${skin.btnGrad} text-white py-2.5 rounded-xl text-sm font-bold ${skin.btnHover} transition-all shadow`}
                  >📋 複製修改連結</button>
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
                    <span className="w-7 h-7 rounded-xl bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center text-white text-xs shadow">📊</span>
                    <h2 className="font-extrabold text-gray-800">登記狀況總覽</h2>
                  </div>
                  <button onClick={exportSignups} className="text-xs bg-gray-100 text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-200 font-medium">📥 匯出</button>
                </div>
                {/* 圖例 */}
                <div className="flex items-center gap-3 text-xs text-gray-500 mb-3">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-200 border border-green-400 inline-block"/>空</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-200 border border-yellow-400 inline-block"/>1–2人</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-200 border border-orange-400 inline-block"/>3–4人</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-200 border border-red-400 inline-block"/>5人+</span>
                </div>
                {/* 依 TIME_BLOCKS 軸呈現 */}
                <div className="space-y-1">
                  {TIME_BLOCKS.map((block) => {
                    const blockSlots = getSlotsInBlock(block, TIME_SLOTS)
                    return (
                      <div key={block.label + block.start} className="flex items-start gap-1.5 sm:gap-2 px-1.5 sm:px-2 py-1 rounded-xl hover:bg-gray-50">
                        {/* 左側標籤 */}
                        <div className={`shrink-0 w-12 sm:w-14 rounded-lg border text-center py-1 leading-tight ${LABEL_STYLE[block.type]}`}>
                          {ICON_MAP[block.type] && <div className="text-xs leading-none mb-0.5">{ICON_MAP[block.type]}</div>}
                          <div className="text-[10px] sm:text-xs font-bold">{block.label}</div>
                          <div className="text-[8px] opacity-60 mt-0.5">{block.start}</div>
                          <div className="text-[8px] opacity-60">–{block.end}</div>
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
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-7 h-7 rounded-xl bg-gradient-to-br from-rose-500 to-orange-500 flex items-center justify-center text-white text-xs shadow">🎬</span>
                  <h2 className="font-extrabold text-gray-800">往年活動回顧</h2>
                </div>
                <div className="space-y-4">
                  {PAST_EVENTS.filter(e => e.type === 'video').map((ev, i) => (
                    <div key={i}>
                      <h3 className="text-sm font-bold text-gray-600 mb-2 flex items-center gap-1.5">
                        <span className="text-red-500">▶</span> {ev.title}
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
                      <div className="flex items-center gap-3">
                        <span className="text-3xl">📸</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-gray-700 group-hover:text-emerald-700 transition-colors">{ev.title}</div>
                          <div className="text-xs text-gray-400 mt-0.5">點擊前往 Google 相簿瀏覽</div>
                        </div>
                        <span className="text-emerald-400 text-xl shrink-0 group-hover:translate-x-1 transition-transform">→</span>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════
            大螢幕展示
        ═══════════════════════════════ */}
        {activeTab === 'display' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="font-bold text-gray-700">大螢幕展示模式</h2>
              <button onClick={toggleFullscreen} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700">
                {isFullscreen ? '退出全螢幕' : '🖥️ 全螢幕'}
              </button>
            </div>
            <div ref={displayRef} className={`bg-gray-900 rounded-xl text-white p-6 ${isFullscreen ? 'fixed inset-0 z-50 rounded-none overflow-y-auto' : ''}`}>
              <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl sm:text-4xl font-bold text-yellow-400">🏃‍♀️ {eventName}</h1>
                <div className="text-right">
                  <div className="text-3xl sm:text-5xl font-mono font-bold">{currentTime}</div>
                  <div className="text-sm text-gray-400">總記錄 {lapRecords.length} 圈</div>
                </div>
              </div>
              {stats.length === 0 ? (
                <div className="text-center text-gray-500 py-16 text-xl">等待記錄中...</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {stats.slice(0,15).map(s => (
                    <div key={s.name} className="bg-gray-800 rounded-xl p-4 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-xl sm:text-2xl font-bold truncate">{s.name}</div>
                        <div className="text-xs text-gray-400 truncate">{s.classes}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-3xl sm:text-4xl font-bold text-green-400">{s.totalLaps}</div>
                        <div className="text-xs text-gray-400">圈</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════
            管理介面
        ═══════════════════════════════ */}
        {activeTab === 'admin' && !adminUnlocked && (
          <div className="max-w-sm mx-auto mt-12">
            <div className="rounded-3xl shadow-2xl overflow-hidden">
              <div className="px-8 pt-10 pb-8 text-center"
                style={{ background: skin.adminGrad }}>
                <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center text-4xl mx-auto mb-4 shadow-inner">🔒</div>
                <h2 className="text-xl font-black text-white mb-1">管理員驗證</h2>
                <p className="text-sm text-blue-200">請輸入管理密碼以繼續</p>
              </div>
              <div className="bg-white px-8 py-6">
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
                  className={`w-full border-2 rounded-xl px-4 py-3 text-base text-center focus:outline-none mb-3 transition-colors ${adminPwError ? 'border-red-400 bg-red-50' : 'border-gray-200 focus:border-blue-400'}`}
                  autoFocus
                />
                {adminPwError && (
                  <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-600 text-center mb-3">
                    ❌ 密碼錯誤，請再試一次
                  </div>
                )}
                <button
                  onClick={() => {
                    if (adminPwInput === ADMIN_PASSWORD) { setAdminUnlocked(true); setAdminPwInput('') }
                    else { setAdminPwError(true); setAdminPwInput('') }
                  }}
                  className={`w-full bg-gradient-to-r ${skin.btnGrad} text-white py-3 rounded-xl text-base font-bold ${skin.btnHover} transition-all shadow-md`}
                >進入管理 →</button>
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
                className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
              >🔓 登出管理</button>
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
                      <button onClick={() => { setTempEventName(eventName); setEditingEventName(true) }} className="bg-blue-50 text-blue-600 px-3 py-2 rounded-lg text-sm hover:bg-blue-100">✏️ 修改</button>
                    </>
                  )}
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

            {/* 快速新增參加者 */}
            <div className="bg-white rounded-xl shadow p-4">
              <h2 className="font-bold text-gray-700 mb-3">快速新增參加者</h2>
              <div className="flex gap-2 mb-2">
                <input type="text" value={newParticipantName} onChange={e => setNewParticipantName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addParticipant()} placeholder="輸入姓名後按 Enter..."
                  className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" autoFocus />
                <button onClick={addParticipant} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 shrink-0">新增</button>
              </div>
              <textarea value={bulkParticipants} onChange={e => setBulkParticipants(e.target.value)}
                placeholder="批次匯入：小明,小華,小美（逗號或換行分隔）" rows={2}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 mb-2" />
              <button onClick={addBulkParticipants} className="bg-green-600 text-white px-4 py-1.5 rounded-lg text-sm hover:bg-green-700">批次新增</button>
              {participants.length > 0 && (
                <div className="mt-3 pt-3 border-t">
                  <div className="text-xs text-gray-400 mb-2">目前 {participants.length} 位參加者</div>
                  <div className="flex flex-wrap gap-1.5">
                    {participants.map(name => (
                      <span key={name} className="flex items-center gap-1 bg-gray-100 text-gray-700 text-xs px-2 py-1 rounded-full">
                        {name}
                        <button onClick={() => deleteParticipant(name)} className="text-gray-400 hover:text-red-500 leading-none">×</button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 時段安排 */}
            <div className="bg-white rounded-xl shadow p-4">
              <h2 className="font-bold text-gray-700 mb-3">時段安排（供圈數記錄用）</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">班級／活動名稱</label>
                  <input type="text" value={newSchedule.class} onChange={e => setNewSchedule({...newSchedule, class: e.target.value})}
                    placeholder="例：一年甲班"
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">開始時間</label>
                  <select value={newSchedule.time} onChange={e => setNewSchedule({...newSchedule, time: e.target.value})}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                    {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">時長（分鐘）</label>
                  <input type="number" value={newSchedule.duration} onChange={e => setNewSchedule({...newSchedule, duration: e.target.value})}
                    min={5} max={120} step={5}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
              </div>
              <button onClick={addSchedule} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700">新增時段</button>
              {schedules.length > 0 && (
                <div className="mt-4 space-y-2">
                  <div className="text-xs text-gray-500 font-medium">已安排時段（共 {schedules.length} 個）</div>
                  {schedules.map(s => (
                    <div key={s.id} className="border rounded-lg p-3 flex items-center justify-between gap-2">
                      {editingSchedule?.id === s.id ? (
                        <div className="flex-1 grid grid-cols-3 gap-2">
                          <input type="text" value={editingSchedule.class} onChange={e => setEditingSchedule({...editingSchedule, class: e.target.value})}
                            className="border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                          <select value={editingSchedule.time} onChange={e => setEditingSchedule({...editingSchedule, time: e.target.value})}
                            className="border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400">
                            {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                          <input type="number" value={editingSchedule.duration} onChange={e => setEditingSchedule({...editingSchedule, duration: parseInt(e.target.value)})}
                            min={5} max={120} step={5}
                            className="border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                        </div>
                      ) : (
                        <div className="flex-1">
                          <span className="font-medium text-gray-800">{s.class}</span>
                          <span className="ml-3 text-sm text-gray-500">{s.time}</span>
                          <span className="ml-2 text-sm text-gray-400">{s.duration} 分鐘</span>
                        </div>
                      )}
                      <div className="flex gap-2 shrink-0">
                        {editingSchedule?.id === s.id ? (
                          <><button onClick={saveEditSchedule} className="text-green-600 text-sm">✓ 儲存</button><button onClick={() => setEditingSchedule(null)} className="text-gray-400 text-sm">✕</button></>
                        ) : (
                          <><button onClick={() => setEditingSchedule({...s})} className="text-blue-400 hover:text-blue-600">✏️</button><button onClick={() => deleteSchedule(s.id)} className="text-red-400 hover:text-red-600">🗑️</button></>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
                <button onClick={exportSignups} className="text-xs bg-gray-100 text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-200">📥 匯出</button>
              </div>

              {signups.length === 0 ? <p className="text-gray-400 text-sm">尚無登記</p> : (
                <>
                  {/* ── 依人名 ── */}
                  {adminViewMode === 'person' && (
                    <div className="space-y-2">
                      {signups.map(s => (
                        <div key={s.id} className="border rounded-lg p-3 flex items-center justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <button
                              onClick={() => { setAdminGridToken(s.token); setAdminGridSlots([...s.slots]) }}
                              className="font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                            >{s.name}</button>
                            <span className="text-xs text-gray-400 ml-2 font-mono">{s.token}</span>
                            <div className="text-xs text-gray-400 ml-1 inline">{s.slots.length} 個時段</div>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {[...s.slots].sort().map(slot => (
                                <span key={slot} className="text-xs bg-blue-50 text-blue-600 border border-blue-200 px-1.5 py-0.5 rounded">{slot}</span>
                              ))}
                            </div>
                          </div>
                          <button
                            onClick={async () => { if (confirm(`確定要刪除「${s.name}」的登記？`)) await deleteDoc(doc(db, 'signups', s.token)) }}
                            className="text-red-400 hover:text-red-600 shrink-0">🗑️</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ── 依時段（TIME_BLOCKS 軸）── */}
                  {adminViewMode === 'slot' && (
                    <div className="space-y-1">
                      {TIME_BLOCKS.map((block) => {
                        const blockSlots = getSlotsInBlock(block, TIME_SLOTS)
                        return (
                          <div key={block.label + block.start} className="flex items-start gap-1.5 sm:gap-2 px-1.5 sm:px-2 py-1 rounded-xl hover:bg-gray-50">
                            <div className={`shrink-0 w-12 sm:w-14 rounded-lg border text-center py-1 leading-tight ${LABEL_STYLE[block.type]}`}>
                              {ICON_MAP[block.type] && <div className="text-xs leading-none mb-0.5">{ICON_MAP[block.type]}</div>}
                              <div className="text-[10px] sm:text-xs font-bold">{block.label}</div>
                              <div className="text-[8px] opacity-60 mt-0.5">{block.start}</div>
                              <div className="text-[8px] opacity-60">–{block.end}</div>
                            </div>
                            <div className="flex flex-wrap gap-0.5 sm:gap-1 flex-1">
                              {blockSlots.map(slot => {
                                const sgs = signups.filter(s => s.slots.includes(slot))
                                const count = sgs.length
                                const cellCls = count === 0
                                  ? 'bg-green-50 border-green-300 text-green-600'
                                  : count <= 2
                                  ? 'bg-yellow-50 border-yellow-300 text-yellow-700'
                                  : count <= 4
                                  ? 'bg-orange-50 border-orange-300 text-orange-700'
                                  : 'bg-red-50 border-red-300 text-red-700'
                                return (
                                  <div key={slot} className={`border rounded-lg text-center ${cellCls}`}
                                    style={{ width: '44px', minHeight: '44px' }}>
                                    <div className="text-[10px] font-bold leading-none pt-1">{slot}</div>
                                    {count > 0 ? (
                                      <div className="text-[9px] font-semibold opacity-60 mt-0.5">{count}人</div>
                                    ) : (
                                      <div className="text-[8px] opacity-30 mt-0.5">空</div>
                                    )}
                                    {sgs.length > 0 && (
                                      <div className="mt-0.5 px-0.5 pb-1">
                                        {sgs.map(s => (
                                          <button key={s.id}
                                            onClick={() => { setAdminGridToken(s.token); setAdminGridSlots([...s.slots]) }}
                                            className="block w-full text-[8px] leading-tight truncate hover:underline font-medium"
                                            title={`點擊編輯 ${s.name} 的登記`}
                                          >{s.name}</button>
                                        ))}
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
                        <button onClick={() => { setAdminGridToken(null); setAdminGridSlots([]) }} className="text-gray-400 hover:text-gray-600 text-2xl leading-none ml-2">×</button>
                      </div>
                    </div>

                    {/* 已選提示 */}
                    {adminGridSlots.length > 0 && (
                      <div className="mx-3 sm:mx-5 mt-3 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 flex flex-wrap gap-1.5 items-center shrink-0">
                        <span className="text-xs text-blue-500 mr-1">已選：</span>
                        {[...adminGridSlots].sort().map(s => (
                          <span key={s} className="bg-blue-500 text-white text-xs px-2 py-0.5 rounded-full flex items-center gap-1">
                            {s}
                            <button onClick={() => toggleAdminSlot(s)} className="hover:text-blue-200">×</button>
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
                            <div className={`shrink-0 w-12 sm:w-14 rounded-lg border text-center py-1 leading-tight ${activeLabelStyle}`}>
                              {ICON_MAP[block.type] && <div className="text-xs leading-none mb-0.5">{ICON_MAP[block.type]}</div>}
                              <div className="text-[10px] sm:text-xs font-bold">{block.label}</div>
                              <div className="text-[8px] opacity-60 mt-0.5">{block.start}</div>
                              <div className="text-[8px] opacity-60">–{block.end}</div>
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
              <h2 className="font-bold text-gray-700 mb-4">📊 統計資料</h2>
              <div className="grid grid-cols-3 gap-3 mb-4">
                {[
                  ['總圈數', lapRecords.length, skin.statCards[0], '🏃'],
                  ['參加人數', stats.length, skin.statCards[1], '👥'],
                  ['登記時段數', signups.reduce((a,s)=>a+s.slots.length,0), skin.statCards[2], '📅'],
                ].map(([label, val, grad, icon]) => (
                  <div key={label} className={`bg-gradient-to-br ${grad} rounded-2xl shadow p-3 text-center text-white`}>
                    <div className="text-lg mb-0.5">{icon}</div>
                    <div className="text-2xl font-black leading-none">{val}</div>
                    <div className="text-[10px] opacity-80 mt-1 leading-tight">{label}</div>
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
                  <button onClick={exportResults} className="bg-blue-600 text-white px-3 py-1 rounded-lg text-xs hover:bg-blue-700">📥 匯出 CSV</button>
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
    </div>
  )
}
