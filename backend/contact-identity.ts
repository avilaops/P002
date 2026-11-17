import { query } from "./db.js";

const matchingKeys = `array_remove(array[
  case when crm_phone_key(c.phone,c.source) = crm_phone_key(t.phone,t.source) then 'telefone' end,
  case when c.email <> '' and lower(btrim(c.email)) = nullif(lower(btrim(t.email)),'') then 'e-mail' end,
  case when crm_document_key(c.cpf_cnpj) = crm_document_key(t.cpf_cnpj) then 'CPF/CNPJ' end
], null)`;

export async function duplicateContacts(tenantId: string, contactId: string) {
  const result = await query<{ id: string; name: string; phone: string | null; email: string | null; reasons: string[] }>(
    `select c.id,c.name,c.phone,c.email,${matchingKeys} as reasons
       from contacts t join contacts c on c.tenant_id=t.tenant_id and c.id<>t.id
      where t.tenant_id=$1 and t.id=$2 and (
        crm_phone_key(c.phone,c.source)=crm_phone_key(t.phone,t.source) or
        lower(btrim(c.email))=nullif(lower(btrim(t.email)),'') or
        crm_document_key(c.cpf_cnpj)=crm_document_key(t.cpf_cnpj))
      order by cardinality(${matchingKeys}) desc,c.name,c.id limit 20`,
    [tenantId, contactId],
  );
  return result.rows;
}

function conflict(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 422 });
}

/** Called inside the same transaction as the audit event. */
export async function mergeContact(tenantId: string, targetId: string, sourceId: string) {
  if (targetId === sourceId) conflict("Escolha duas fichas diferentes.");
  const params = [tenantId, targetId, sourceId];
  // Lock in stable order, including when two people choose opposite survivors.
  const locked = await query(
    `select *,crm_phone_key(phone,source) as phone_key,crm_document_key(cpf_cnpj) as document_key
       from contacts where tenant_id=$1 and id in ($2,$3) order by id for update`, params,
  );
  const target = locked.rows.find(row => row.id === targetId);
  const source = locked.rows.find(row => row.id === sourceId);
  if (!target || !source) throw Object.assign(new Error("Ficha não encontrada."), { statusCode: 404 });
  const identities = (row: typeof target) => [
    row.phone_key ?? row.phone?.trim(), row.email?.trim().toLowerCase(), row.document_key ?? row.cpf_cnpj?.trim(),
  ];
  const left = identities(target);
  const right = identities(source);
  if (!left.some((key, i) => key && key === right[i])) conflict("As fichas precisam ter telefone, e-mail ou documento em comum.");
  if (left.some((key, i) => key && right[i] && key !== right[i])) conflict("Há telefones, e-mails ou documentos diferentes. Confira as duas fichas.");

  const ambiguous = await query(`select 1 from channel_contacts a join channel_contacts b
      on b.tenant_id=a.tenant_id and b.channel_id=a.channel_id
      join channels ch on ch.id=a.channel_id and ch.provider in ('messenger','instagram')
      where a.tenant_id=$1 and a.contact_id=$2 and b.contact_id=$3 and a.external_id<>b.external_id limit 1`, params);
  if (ambiguous.rowCount) conflict("As fichas têm destinatários diferentes no mesmo canal.");

  await query(`insert into contact_merges(tenant_id,original_id,contact_id,original_record)
    select $1,c.id,$2,to_jsonb(c) from contacts c where c.tenant_id=$1 and c.id=$3`, params);
  for (const table of ["leads", "tasks", "conversations", "newsletter_deliveries", "mail_senders", "channel_contacts", "webchat_sessions", "lead_meetings", "contact_merges"]) {
    await query(`update ${table} set contact_id=$2 where tenant_id=$1 and contact_id=$3`, params);
  }
  // A unique-key collision aborts the whole transaction if both records have competing external links.
  await query(`update external_references set entity_id=$2 where tenant_id=$1 and entity_id=$3 and entity_type in ('contact','customer')`, params);
  await query(`update ai_suggestions set entity_id=$2 where tenant_id=$1 and entity_id=$3 and entity_type='contact'`, params);
  await query("delete from contacts where tenant_id=$1 and id=$2", [tenantId, sourceId]);
  // Keep the provider's routable address, the stricter subscription choice and the original media key.
  const avatar = target.avatar_storage_key ? target : source;
  const phone = source.source === "whatsapp" && source.phone ? source.phone : target.phone || source.phone;
  const result = await query(`update contacts set
    phone=$3,email=coalesce(nullif(email,''),$4),cpf_cnpj=coalesce(nullif(cpf_cnpj,''),$5),
    company=coalesce(nullif(company,''),$6),company_id=coalesce(company_id,$7),assigned_user_id=coalesce(assigned_user_id,$8),
    tags=array(select distinct tag from unnest(tags || $9::text[]) tag order by tag),
    newsletter_status=case when newsletter_status='subscribed' then $10 else newsletter_status end,
    unsubscribed_at=greatest(unsubscribed_at,$11),legal_basis=coalesce(legal_basis,$12),
    avatar_storage_key=$13,avatar_storage_provider=$14,avatar_mime_type=$15,avatar_synced_at=$16,
    import_id=null,updated_at=now() where tenant_id=$1 and id=$2 returning *`,
    [tenantId,targetId,phone,source.email,source.cpf_cnpj,source.company,source.company_id,source.assigned_user_id,
      source.tags,source.newsletter_status,source.unsubscribed_at,source.legal_basis,avatar.avatar_storage_key,
      avatar.avatar_storage_provider,avatar.avatar_mime_type,avatar.avatar_synced_at]);
  return result.rows[0];
}
