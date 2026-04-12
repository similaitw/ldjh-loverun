import { initializeApp, getApps } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: "AIzaSyD_o1EB-ums3FDvbv_YzkCthR3_JO3LSPk",
  authDomain: "ldjh-loverun.firebaseapp.com",
  projectId: "ldjh-loverun",
  storageBucket: "ldjh-loverun.firebasestorage.app",
  messagingSenderId: "393975688539",
  appId: "1:393975688539:web:7c57482ebf656170c3be7e"
}

// 避免 Next.js 熱更新重複初始化
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]
export const db = getFirestore(app)
