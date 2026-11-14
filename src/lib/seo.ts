import type { Metadata } from 'next'

export const siteUrl = 'https://crm.avilaops.com'

export const publicPages = [
  {
    path: '/',
    title: 'CRM com IA para vendas e atendimento • Avila Ops',
    description: 'Organize contatos, conversas, oportunidades e tarefas no CRM da Avila Ops. Atendimento, automação e inteligência artificial com supervisão da equipe.',
  },
  {
    path: '/docs/',
    title: 'Documentação do CRM • Avila Ops',
    description: 'Conheça os recursos, o acesso e as integrações do Avila CRM para organizar atendimento, contatos, vendas e automações da sua equipe.',
  },
  {
    path: '/privacidade/',
    title: 'Privacidade • Avila CRM',
    description: 'Saiba como o Avila CRM trata dados de contatos, conversas e oportunidades, protege o acesso e recebe solicitações sobre dados da organização.',
  },
  {
    path: '/termos/',
    title: 'Termos de uso • Avila CRM',
    description: 'Consulte as condições de uso do Avila CRM, as responsabilidades da organização e as regras de acesso e utilização das integrações.',
  },
] as const

export type PublicPath = (typeof publicPages)[number]['path']

function publicPage(path: PublicPath) {
  const page = publicPages.find(candidate => candidate.path === path)
  if (!page) throw new Error('Página pública não cadastrada')
  return page
}

export function publicPageMetadata(path: PublicPath): Metadata {
  const page = publicPage(path)
  const url = siteUrl + page.path
  const images = [{ url: `${siteUrl}/og-default.png`, width: 1200, height: 630, alt: 'Avila CRM • vendas e atendimento' }]
  return {
    title: { absolute: page.title },
    description: page.description,
    alternates: { canonical: url },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1, 'max-video-preview': -1 },
    },
    openGraph: { title: page.title, description: page.description, url, siteName: 'Avila CRM', locale: 'pt_BR', type: 'website', images },
    twitter: { card: 'summary_large_image', title: page.title, description: page.description, images: images.map(image => image.url) },
  }
}

export const privateMetadata: Metadata = {
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
  // A tela autenticada não deve herdar o canonical da apresentação pública.
  alternates: { canonical: null },
}

export function publicStructuredData(path: PublicPath) {
  const page = publicPage(path)
  const url = siteUrl + path
  const graph: Record<string, unknown>[] = [
    { '@type': 'Organization', '@id': 'https://avilaops.com/#organization', name: 'Avila Ops', url: 'https://avilaops.com/' },
    { '@type': 'WebSite', '@id': `${siteUrl}/#website`, name: 'Avila CRM', url: `${siteUrl}/`, inLanguage: 'pt-BR', publisher: { '@id': 'https://avilaops.com/#organization' } },
    { '@type': 'WebPage', '@id': `${url}#webpage`, url, name: page.title, description: page.description, inLanguage: 'pt-BR', isPartOf: { '@id': `${siteUrl}/#website` } },
  ]
  if (path === '/') {
    graph.push({ '@type': 'WebApplication', '@id': `${siteUrl}/#software`, name: 'Avila CRM', url, description: page.description, applicationCategory: 'BusinessApplication', operatingSystem: 'Web', inLanguage: 'pt-BR', publisher: { '@id': 'https://avilaops.com/#organization' } })
  }
  return { '@context': 'https://schema.org', '@graph': graph }
}

export function publicTextIndex() {
  return [
    '# Avila CRM',
    '',
    '> CRM da Avila Ops para organizar atendimento, contatos, conversas, oportunidades e tarefas, com automação e IA supervisionadas pela equipe.',
    '',
    '## Páginas públicas oficiais',
    '',
    ...publicPages.map(page => `- [${page.title}](${siteUrl}${page.path}): ${page.description}`),
    '',
    '## Sobre o produto',
    '',
    'O acesso à área de trabalho usa a conta Avila Ops. Os recursos e integrações dependem da configuração e das permissões da organização.',
    'Preços e condições comerciais devem ser confirmados com a Avila Ops. Não inferir preços, avaliações ou garantias de resultados.',
    '',
  ].join('\n')
}
