import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { query } from "./db.js";
import { imapClient, loadMailAccount, sendMail, type MailAccount, type OutgoingEmail } from "./mail.js";

type Target = { to: string; subject: string; messageId: string; references: string };
type Claim = { acquired: boolean; fingerprint: string; state: string };
type Dependencies = {
  requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<{ id: string; tenant_id: string } | null>;
  decryptSecret: (value: string | null) => string | null;
  loadAccount?: typeof loadMailAccount;
  fetchTarget?: typeof fetchTarget;
  send?: typeof sendMail;
  claim?: typeof claimReply;
  lookup?: typeof lookupReply;
  finish?: typeof finishReply;
};

const UNCERTAIN_SEND = "O envio pode ter ocorrido. Peça a um administrador para verificar a entrega antes de tentar uma nova resposta.";

function messageIds(value: string) {
  return (value.match(/<[^<>\s]+@[^<>\s]+>/g) ?? []).filter(id =>
    [...id].every(character => character.charCodeAt(0) > 32 && character.charCodeAt(0) !== 127),
  );
}

export function replyEmail(target: Target, text: string): OutgoingEmail {
  if (!z.email().safeParse(target.to).success || /[\r\n]/.test(target.to)) throw new Error("Invalid recipient");
  const subject = target.subject.replace(/[\r\n]+/g, " ").slice(0, 200);
  const originalId = messageIds(target.messageId)[0];
  const headers: Record<string, string> = {};
  if (originalId) {
    headers["In-Reply-To"] = originalId;
    headers.References = [...new Set([...messageIds(target.references).slice(-20), originalId])].join(" ");
  }
  return { to: target.to, subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`, text, html: "", headers };
}

async function fetchTarget(account: MailAccount, uid: number): Promise<Target> {
  const client = imapClient(account);
  try {
    await client.connect();
    await client.mailboxOpen("INBOX", { readOnly: true });
    const original = await client.fetchOne(String(uid), { envelope: true, headers: ["references"], uid: true }, { uid: true });
    if (!original) throw new Error("Message missing");
    const envelope = original.envelope;
    const recipients = envelope?.replyTo?.length ? envelope.replyTo : envelope?.from;
    const to = recipients?.[0]?.address ?? "";
    const references = (original.headers?.toString("utf8") ?? "").replace(/\r?\n[ \t]+/g, " ").match(/^references:\s*(.*)$/im)?.[1] ?? "";
    return { to, subject: envelope?.subject ?? "(sem assunto)", messageId: envelope?.messageId ?? "", references };
  } finally {
    await client.logout().catch(() => client.close());
  }
}

// A chave primária do evento faz a reserva atômica entre processos e reinícios.
// Reservas incertas permanecem pendentes: SMTP não oferece exactly-once.
async function claimReply(id: string, fingerprint: string, tenantId: string, userId: string): Promise<Claim> {
  const result = await query(
    `insert into events (id, tenant_id, actor_user_id, entity_type, event_type, payload)
     values ($1, $2, $3, 'mail', 'mail.reply', $4::jsonb) on conflict (id) do nothing returning id`,
    [id, tenantId, userId, JSON.stringify({ fingerprint, state: "pending" })],
  );
  if (result.rows.length) return { acquired: true, fingerprint, state: "pending" };
  return (await lookupReply(id, tenantId)) ?? { acquired: false, fingerprint: "", state: "pending" };
}

async function lookupReply(id: string, tenantId: string): Promise<Claim | null> {
  const existing = await query<{ payload: { fingerprint: string; state: string } }>(
    "select payload from events where id = $1 and tenant_id = $2", [id, tenantId],
  );
  const payload = existing.rows[0]?.payload;
  return payload ? { acquired: false, fingerprint: payload.fingerprint, state: payload.state } : null;
}

async function finishReply(id: string, tenantId: string, messageId: string) {
  await query("update events set payload = payload || $3::jsonb where id = $1 and tenant_id = $2", [id, tenantId, JSON.stringify({ state: "sent", messageId })]);
}

export function registerMailReplyRoutes(app: FastifyInstance, deps: Dependencies) {
  app.post("/api/mail/messages/:uid/reply", async (request, reply) => {
    const user = await deps.requireAuth(request, reply);
    if (!user) return;
    const params = z.object({ uid: z.coerce.number().int().positive() }).safeParse(request.params);
    const input = z.object({ text: z.string().trim().min(1).max(50_000), requestId: z.uuid() }).safeParse(request.body);
    if (!params.success || !input.success) return reply.code(400).send({ error: "Informe uma resposta válida." });
    try {
      const account = await (deps.loadAccount ?? loadMailAccount)(user.tenant_id, deps.decryptSecret);
      if (!account) return reply.code(409).send({ error: "Cadastre a conta de e-mail em Configurações de email." });
      const hash = createHash("sha256").update(`mail.reply:${user.tenant_id}:${input.data.requestId}`).digest("hex");
      const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
      const fingerprint = createHash("sha256").update(JSON.stringify([account.user, params.data.uid, input.data.text])).digest("hex");
      const existing = await (deps.lookup ?? lookupReply)(id, user.tenant_id);
      if (existing) {
        if (existing.fingerprint === fingerprint && existing.state === "sent") return { ok: true };
        return reply.code(409).send({ error: UNCERTAIN_SEND });
      }
      const target = await (deps.fetchTarget ?? fetchTarget)(account, params.data.uid);
      const email = replyEmail(target, input.data.text);
      const claim = await (deps.claim ?? claimReply)(id, fingerprint, user.tenant_id, user.id);
      if (!claim.acquired) {
        if (claim.fingerprint === fingerprint && claim.state === "sent") return { ok: true };
        return reply.code(409).send({ error: UNCERTAIN_SEND });
      }
      const messageId = await (deps.send ?? sendMail)(account, email);
      await (deps.finish ?? finishReply)(id, user.tenant_id, messageId);
      return { ok: true };
    } catch {
      return reply.code(502).send({ error: `Não foi possível confirmar o envio. ${UNCERTAIN_SEND}` });
    }
  });
}
