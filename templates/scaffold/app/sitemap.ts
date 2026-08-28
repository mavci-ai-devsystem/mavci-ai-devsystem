import type { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const base = '__SITE_URL__'
  const routes = ['', '/privacy', '/terms', '/kvkk', '/cookies', '/contact']
  return routes.map((r) => ({ url: base + r, lastModified: new Date() }))
}
