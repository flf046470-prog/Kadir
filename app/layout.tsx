import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import '../src/index.css'

export const metadata: Metadata = {
  title: 'Patagonia Underground — Trevelin, Patagonia',
  description:
    'Patagonia Underground — a future project taking shape in Trevelin, Chubut, Argentina. Follow the real journey from the beginning.',
  alternates: {
    canonical: '/',
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: 'Patagonia Underground — A project taking shape in Patagonia',
    description:
      'Discover the story, the place and the transparent journey behind Patagonia Underground.',
    type: 'website',
    siteName: 'Patagonia Underground',
    locale: 'en_US',
  },
}

export const viewport: Viewport = {
  themeColor: '#17231d',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
