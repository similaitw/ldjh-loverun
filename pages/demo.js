import React from 'react';
import Head from 'next/head';

export default function DemoPage() {
  // 為 LoveRun 專案量身打造的 Lucide SVG 清單
  const showcaseData = [
    {
      category: "導覽列與頁籤 (Header & Tabs)",
      items: [
        { old: "🏃‍♀️", name: "Activity", label: "活動 Logo", path: <path d="M22 12h-4l-3 9L9 3l-3 9H2"/> },
        { old: "📋", name: "ClipboardList", label: "報名登記", path: <><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></> },
        { old: "📺", name: "Monitor", label: "大螢幕展示", path: <><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></> },
        { old: "⚙️", name: "Settings", label: "後台管理", path: <><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></> }
      ]
    },
    {
      category: "首頁總覽卡片 (Stats Dashboard)",
      items: [
        { old: "👥", name: "Users", label: "已登記人數", path: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></> },
        { old: "📅", name: "CalendarCheck", label: "已佔用時段", path: <><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/><path d="m9 16 2 2 4-4"/></> },
        { old: "✨", name: "Timer", label: "可用時段", path: <><line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/></> },
        { old: "📥", name: "Download", label: "匯出按鈕", path: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></> }
      ]
    },
    {
      category: "報名與狀態流程 (Signup Flow)",
      items: [
        { old: "📋", name: "ClipboardSignature", label: "時段登記", path: <><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-.5"/><path d="M16 4h2a2 2 0 0 1 1.73 1"/><path d="M18.42 9.61a2.1 2.1 0 1 1 2.97 2.97L16.95 17 13 18l.99-3.95 4.43-4.44Z"/><path d="M8 18h1"/></> },
        { old: "🎉", name: "PartyPopper", label: "登記成功", path: <><path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01"/><path d="M22 8h.01"/><path d="M15 2h.01"/><path d="M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12v0c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11v0c-.11.7-.72 1.22-1.43 1.22H17"/><path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98v0C9.52 4.9 9 5.52 9 6.23V7"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"/></> },
        { old: "🔑", name: "KeyRound", label: "修改金鑰", path: <><path d="M2 18v3c0 .6.4 1 1 1h4v-3h3v-3h2l1.4-1.4a6.5 6.5 0 1 0-4-4Z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></> }
      ]
    },
    {
      category: "時間行程標籤 (Schedule & Other)",
      items: [
        { old: "🎬", name: "Clapperboard", label: "影片回顧", path: <><path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.4-2.2 1.5-2.5l13.5-4c1.1-.3 2.2.4 2.5 1.5z"/><path d="m6.2 5.3 3.1 3.9"/><path d="m12.4 3.4 3.1 4"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></> },
        { old: "☕", name: "Coffee", label: "下課", path: <><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><line x1="6" x2="6" y1="2" y2="4"/><line x1="10" x2="10" y1="2" y2="4"/><line x1="14" x2="14" y1="2" y2="4"/></> },
        { old: "🍱", name: "Utensils", label: "午餐", path: <><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></> },
        { old: "😴", name: "Moon", label: "午休", path: <><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></> },
        { old: "⏰", name: "Clock", label: "預備", path: <><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/><path d="M6.38 18.7 4 21"/><path d="M17.64 18.67 20 21"/></> }
      ]
    }
  ];

  return (
    <div className="min-h-screen bg-slate-50 font-sans p-6 md:p-12">
      <Head>
        <title>LoveRun 圖示替換展示 | 不干擾主專案</title>
      </Head>

      <div className="max-w-5xl mx-auto">
        <div className="mb-10 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 text-white mb-4 shadow-lg">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 2l3 6 6 .5-4.5 4L18 19l-6-3-6 3 1.5-6.5L3 8.5 9 8z" /></svg>
          </div>
          <h1 className="text-4xl font-extrabold text-slate-800 mb-3 tracking-tight">Loverun 專屬圖示預覽</h1>
          <p className="text-slate-500 text-lg">
            以下是為你挑選的 Lucide 圖示，用來取代原本的 Emoji。<br/>
            你會發現線條圖示能讓整個專案看起來更專業、乾淨，且更具有一致性！
          </p>
        </div>

        {showcaseData.map((section, idx) => (
          <div key={idx} className="mb-10">
            <h2 className="text-xl font-bold text-slate-700 mb-4 px-2 border-l-4 border-blue-500">{section.category}</h2>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {section.items.map((item, i) => (
                <div key={i} className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm hover:shadow-md transition-shadow group flex items-center justify-between">
                  
                  {/* 舊版 Emoji */}
                  <div className="flex flex-col items-center justify-center gap-2 w-16 opacity-50 grayscale group-hover:opacity-100 transition-all">
                    <div className="text-3xl">{item.old}</div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">OLD</div>
                  </div>

                  {/* 箭頭 */}
                  <div className="text-slate-300 group-hover:text-blue-400 transition-colors">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                  </div>

                  {/* 新版 Lucide Icon */}
                  <div className="flex flex-col items-center justify-center gap-2 w-24">
                    <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        {item.path}
                      </svg>
                    </div>
                    <div className="text-center">
                      <div className="text-sm font-bold text-slate-700">{item.label}</div>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5">{item.name}</div>
                    </div>
                  </div>

                </div>
              ))}
            </div>
          </div>
        ))}

        {/* 教學區塊 */}
        <div className="mt-12 bg-slate-900 rounded-3xl p-8 text-white shadow-2xl">
          <h3 className="text-2xl font-bold mb-4 flex items-center gap-3">
            <span className="text-green-400">✨</span> 決定好要升級了嗎？
          </h3>
          <p className="text-slate-300 mb-6 leading-relaxed">
            這些圖示將會完美融入你目前的 Tailwind 色彩主題（深海藍、日落橙等），它們會自動根據文字顏色改變，並且不會像 Emoji 在不同設備（Mac, Windows, iOS）上長得不一樣。
          </p>
          
          <div className="bg-black/50 rounded-xl p-5 font-mono text-sm border border-slate-700">
            <div className="text-slate-500 mb-2">// 1. 在終端機執行安裝指令</div>
            <div className="text-green-400 mb-6">$ npm install lucide-react</div>
            
            <div className="text-slate-500 mb-2">// 2. 然後在 loverun-tracker.jsx 頂部引入</div>
            <div className="text-blue-300">import <span className="text-slate-300">{`{ Activity, ClipboardList, Monitor, Settings, Users }`}</span> from <span className="text-yellow-300">'lucide-react'</span>;</div>
          </div>
        </div>

      </div>
    </div>
  );
}