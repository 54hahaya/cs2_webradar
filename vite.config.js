import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // 相对路径：既能被中继(22006)从根目录托管，也能直接丢 GitHub Pages 子目录
  base: './',
  server: { 
    host: true,
    port: 5173,
    allowedHosts: true
  }
})
