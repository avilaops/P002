import createMDX from '@next/mdx'

const withMDX = createMDX({})

export default withMDX({
  pageExtensions: ['ts', 'tsx', 'md', 'mdx'],
  trailingSlash: true,
  poweredByHeader: false,
  experimental: { proxyTimeout: 110000 },
  async headers() {
    return [{ source: '/meet/:path*', headers: [
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), display-capture=(self), geolocation=()' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'Cache-Control', value: 'no-store' },
      { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
    ] }]
  },
  env: {
    NEXT_PUBLIC_SUPORTE_WHATSAPP: process.env.NEXT_PUBLIC_SUPORTE_WHATSAPP ?? process.env.VITE_SUPORTE_WHATSAPP ?? '',
    NEXT_PUBLIC_SUPORTE_EMAIL: process.env.NEXT_PUBLIC_SUPORTE_EMAIL ?? process.env.VITE_SUPORTE_EMAIL ?? '',
  },
  async rewrites() {
    if (process.env.NODE_ENV === 'production') return []
    const api = process.env.CRM_API_ORIGIN ?? 'http://127.0.0.1:3001'
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }, { source: '/mcp', destination: `${api}/mcp` }]
  },
})
