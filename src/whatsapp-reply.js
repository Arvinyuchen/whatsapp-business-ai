export async function sendWhatsAppReply({
  token,
  to,
  body,
  fetchImpl = fetch
}) {
  const recipient = String(to || '').trim();
  const reply = String(body || '').trim();

  if (!token) throw new Error('Load the live workspace before sending a WhatsApp reply.');
  if (!/^\d{8,15}$/.test(recipient)) throw new Error('This conversation has an invalid WhatsApp recipient.');
  if (!reply) throw new Error('Reply cannot be empty.');

  const response = await fetchImpl('/api/whatsapp/messages', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ to: recipient, body: reply })
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || 'WhatsApp could not accept the reply.');
  }

  return { messageId: payload.messageId };
}
