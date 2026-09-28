import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import 'leaflet/dist/leaflet.css'
import './globals.css'

export const metadata: Metadata = {
  title: 'MOOOBER | 屯門牛叫車',
  description: '使用免費開源地圖，預約屯門、元朗及天水圍的牛車行程。',
  generator: 'v0.app',
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#f4f4f0',
  userScalable: false,
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-Hant" className="light">
      <body>
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
