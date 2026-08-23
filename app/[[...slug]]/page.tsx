import type { Metadata } from 'next'
import { notFoundMeta, pageMeta } from '../../src/page-meta'
import AppShell from './app-shell'

export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }): Promise<Metadata> {
  const { slug } = await params
  const path = slug?.length ? `/${slug.join('/')}` : '/'
  const [title, description] = pageMeta[path] || notFoundMeta
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title, description, type: 'website', url: path },
  }
}

export default function Page() {
  return <AppShell />
}
