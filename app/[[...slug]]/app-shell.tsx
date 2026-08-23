'use client'

import dynamic from 'next/dynamic'

// src/App.tsx reads window.location and localStorage while initialising its
// state, so it must only ever run in the browser.
const App = dynamic(() => import('../../src/App'), { ssr: false })

export default function AppShell() {
  return <App />
}
