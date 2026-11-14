import { publicTextIndex } from '../../lib/seo'

export const dynamic = 'force-static'

export function GET() {
  return new Response(publicTextIndex(), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
