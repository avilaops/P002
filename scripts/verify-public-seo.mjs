import assert from 'node:assert/strict'
import test from 'node:test'

const base = process.env.CRM_SEO_BASE_URL || 'http://127.0.0.1:5173'
const origin = 'https://crm.avilaops.com'
const publicPaths = ['/', '/docs/', '/privacidade/', '/termos/']

async function get(path) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(60_000) })
  return { response, text: await response.text() }
}

function robotsOf(html) {
  return [...html.matchAll(/<meta\s+name="robots"\s+content="([^"]*)"/g)].map(match => match[1]).join(',')
}

test('página inicial entrega apresentação e indexação já no HTML', async () => {
  const { response, text } = await get('/')
  assert.equal(response.status, 200)
  assert.match(text, /Relacionamentos bem cuidados viram crescimento\./)
  assert.match(robotsOf(text), /\bindex\b/)
  assert.doesNotMatch(robotsOf(text), /\bnoindex\b|\bnofollow\b/)
})

test('páginas públicas têm canonical próprio, título e descrição únicos e JSON-LD', async () => {
  const titles = new Set()
  const descriptions = new Set()
  for (const path of publicPaths) {
    const { response, text } = await get(path)
    assert.equal(response.status, 200, path)
    assert.ok(text.includes(`rel="canonical" href="${origin}${path}"`), `canonical de ${path}`)
    assert.doesNotMatch(robotsOf(text), /\bnoindex\b|\bnofollow\b/, path)
    const title = text.match(/<title>([^<]+)<\/title>/)?.[1]
    const description = text.match(/<meta name="description" content="([^"]+)"/)?.[1]
    assert.ok(title && description, path)
    titles.add(title)
    descriptions.add(description)
    const jsonLd = [...text.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)]
    assert.ok(jsonLd.length > 0, `dados estruturados de ${path}`)
    for (const [, json] of jsonLd) assert.equal(JSON.parse(json)['@context'], 'https://schema.org')
  }
  assert.equal(titles.size, publicPaths.length)
  assert.equal(descriptions.size, publicPaths.length)
})

test('rotas internas mantêm noindex em todos os grupos e reuniões', async () => {
  const paths = ['/communications/inbox/', '/mail/inbox/', '/leads/pipeline/', '/calendar/', '/segments/', '/lists/contacts/', '/ai-agent/', '/automations/', '/settings/', '/meet/seo-verification/']
  for (const path of paths) {
    const { response, text } = await get(path)
    assert.equal(response.status, 200, path)
    assert.match(robotsOf(text), /\bnoindex\b/, path)
  }
})

test('sitemap lista somente os quatro endereços públicos e canônicos', async () => {
  const { response, text } = await get('/sitemap.xml')
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /xml/)
  const urls = [...text.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1])
  assert.deepEqual(urls.sort(), publicPaths.map(path => origin + path).sort())
  assert.equal(new Set(urls).size, urls.length)
})

test('robots e llms anunciam conteúdo público sem dados internos', async () => {
  const robots = await get('/robots.txt')
  assert.equal(robots.response.status, 200)
  assert.match(robots.response.headers.get('content-type'), /text\/plain/)
  assert.ok(robots.text.includes(`Sitemap: ${origin}/sitemap.xml`))
  assert.doesNotMatch(robots.text, /Disallow:\s*\/\s*$/m)
  const llms = await get('/llms.txt')
  assert.equal(llms.response.status, 200)
  assert.match(llms.response.headers.get('content-type'), /text\/plain/)
  for (const path of publicPaths) assert.ok(llms.text.includes(origin + path), path)
  assert.doesNotMatch(llms.text, /\/communications\/|\/lists\/|\/settings\/|\/meet\//)
})

test('endereços inexistentes continuam retornando 404', async () => {
  const { response } = await get('/pagina-publica-inexistente-seo/')
  assert.equal(response.status, 404)
})
