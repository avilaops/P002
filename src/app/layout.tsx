import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { SessionStateProvider } from '../components/crm/SessionState'
import { AnimatedSidebarProvider } from '../components/ui/animated-sidebar'
import { publicPageMetadata, siteUrl } from '../lib/seo'
import '../index.css'

export const metadata: Metadata = {
  ...publicPageMetadata('/'),
  metadataBase: new URL(siteUrl),
  title: { default: 'CRM com IA para vendas e atendimento • Avila Ops', template: '%s • Avila CRM' },
  applicationName: 'Avila CRM',
  icons: {
    icon: [
      { url: '/favicon.png', type: 'image/png', sizes: '96x96' },
    ],
    shortcut: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
  manifest: '/site.webmanifest',
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#0b0d10' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="pt-BR"><body><AnimatedSidebarProvider><SessionStateProvider>{children}</SessionStateProvider></AnimatedSidebarProvider></body></html>
}
