import {createRoot} from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import {initTheme} from './store/useTheme'

// 首屏之前先把主题贴到 <html>，避免浅色内容闪一下再变深色
initTheme()

createRoot(document.getElementById('root')!).render(<App />)
