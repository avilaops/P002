type Json = Record<string, any>

/** Addresses are identifiers, not always phone numbers (groups and privacy LIDs). */
export function evolutionAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (/^\d{8,16}@s\.whatsapp\.net$/.test(value)) return value.split('@')[0]
  if (/^\d{5,30}(?:-\d{1,20})?@g\.us$/.test(value) || /^\d{5,30}@lid$/.test(value)) return value
  return null
}

export function evolutionMessage(item: Json) {
  const jid = item.key?.remoteJid
  const address = evolutionAddress(jid)
  const externalId = item.key?.id
  const seconds = Number(item.messageTimestamp)
  if (!address || typeof externalId !== 'string' || !externalId || !Number.isFinite(seconds) || seconds < 946684800 || seconds * 1000 > Date.now() + 300_000) return null
  let content = item.message
  for (let depth = 0; depth < 5; depth++) {
    const wrapped = content?.ephemeralMessage?.message ?? content?.viewOnceMessage?.message ?? content?.viewOnceMessageV2?.message ?? content?.documentWithCaptionMessage?.message
    if (!wrapped) break
    content = wrapped
  }
  if (!content || typeof content !== 'object') return null
  const plain = content.conversation ?? content.extendedTextMessage?.text
  let type = 'text'
  let text = typeof plain === 'string' ? plain : ''
  let media: Json | null = null
  for (const [key, label] of [['image', 'Imagem'], ['video', 'Vídeo'], ['audio', 'Áudio'], ['document', 'Documento'], ['sticker', 'Figurinha']]) {
    if (content[`${key}Message`]) {
      type = key
      media = content[`${key}Message`]
      text = typeof media?.caption === 'string' && media.caption ? media.caption : `[${label}]`
      break
    }
  }
  if (!text) {
    const location = content.locationMessage ?? content.liveLocationMessage
    if (location) { type = 'location'; text = `[Localização] ${location.name ?? ''} ${location.address ?? ''} (${location.degreesLatitude}, ${location.degreesLongitude})`.trim() }
    else if (content.contactMessage) { type = 'contact'; text = `[Contato] ${content.contactMessage.displayName ?? ''}\n${content.contactMessage.vcard ?? ''}` }
    else if (content.contactsArrayMessage) { type = 'contact'; text = `[Contatos]\n${(content.contactsArrayMessage.contacts ?? []).map((c: Json) => c.vcard ?? c.displayName ?? '').join('\n')}` }
    else if (content.reactionMessage) { type = 'reaction'; text = `[Reação] ${content.reactionMessage.text ?? 'removida'}` }
    else if (content.pollCreationMessage || content.pollCreationMessageV3) { type = 'poll'; text = `[Enquete] ${(content.pollCreationMessage ?? content.pollCreationMessageV3).name ?? ''}` }
    else if (content.pollUpdateMessage) { type = 'poll'; text = '[Voto em enquete • conteúdo protegido pelo WhatsApp]' }
    else if (content.albumMessage) { type = 'album'; text = '[Álbum • os arquivos disponíveis aparecem como mensagens individuais]' }
    else if (content.buttonsResponseMessage || content.listResponseMessage || content.templateButtonReplyMessage) { text = content.buttonsResponseMessage?.selectedDisplayText ?? content.listResponseMessage?.title ?? content.templateButtonReplyMessage?.selectedDisplayText ?? '[Resposta interativa]' }
    else if (Object.keys(content).some(key => !['messageContextInfo', 'senderKeyDistributionMessage', 'protocolMessage'].includes(key))) { type = 'unsupported'; text = '[Mensagem em formato ainda não exibido]' }
    else return null
  }
  return { address, jid, externalId, type, text: text.slice(0, 65_000), media, fromMe: item.key.fromMe === true, sentAt: new Date(seconds * 1000).toISOString() }
}
