export async function sendWhatsAppReply({
  token,
  conversationId,
  to,
  recipient,
  body,
  idempotencyKey = crypto.randomUUID(),
  fetchImpl = fetch
}) {
  const phoneNumber = String(to || '').trim();
  const userId = String(recipient || '').trim();
  const reply = String(body || '').trim();

  if (!token) throw new Error('Load the live workspace before sending a WhatsApp reply.');
  const phoneIsValid = !phoneNumber || /^\d{8,15}$/.test(phoneNumber);
  const bsuidIsValid = !userId
    || /^[A-Z]{2}\.(?:ENT\.)?[A-Za-z0-9]{1,128}$/.test(userId);
  if ((!phoneNumber && !userId) || !phoneIsValid || !bsuidIsValid) {
    throw new Error('This conversation has an invalid WhatsApp recipient.');
  }
  if (!reply) throw new Error('Reply cannot be empty.');

  const response = await fetchImpl('/api/whatsapp/messages', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey
    },
    body: JSON.stringify({
      ...(phoneNumber ? { to: phoneNumber } : {}),
      ...(userId ? { recipient: userId } : {}),
      body: reply,
      ...(conversationId ? { conversationId } : {})
    })
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || 'WhatsApp could not accept the reply.');
  }

  return {
    messageId: payload.messageId,
    ...(payload.conversation ? { conversation: payload.conversation } : {})
  };
}
