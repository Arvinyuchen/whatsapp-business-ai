const PHONE_PATTERN = /^\d{8,15}$/;
const BSUID_PATTERN = /^[A-Z]{2}\.(?:ENT\.)?[A-Za-z0-9]{1,128}$/;

export function normalizeWhatsAppAddress(value) {
  const input = String(value || '').trim();
  if (BSUID_PATTERN.test(input)) return { recipient: input };

  const digits = input.replace(/\D/g, '');
  const phoneNumber = digits.startsWith('610') ? `61${digits.slice(3)}` : digits;
  return PHONE_PATTERN.test(phoneNumber) ? { to: phoneNumber } : null;
}

export function conversationWhatsAppAddress(conversation) {
  const sourceAddress = normalizeWhatsAppAddress(conversation?.sourceId);
  const phoneNumber = conversation?.identity?.phoneNumber || sourceAddress?.to;
  const userId = conversation?.identity?.userId
    || conversation?.identity?.parentUserId
    || sourceAddress?.recipient;

  if (!phoneNumber && !userId) return null;
  return {
    ...(phoneNumber ? { to: phoneNumber } : {}),
    ...(userId ? { recipient: userId } : {})
  };
}

export function whatsappRecipientLabel(conversation) {
  const address = conversationWhatsAppAddress(conversation);
  if (!address) return 'Unknown WhatsApp recipient';

  const phoneLabel = address.to ? `+${address.to}` : '';
  const usernameLabel = conversation?.identity?.username
    ? `@${conversation.identity.username}`
    : '';
  return [usernameLabel, phoneLabel].filter(Boolean).join(' · ')
    || address.recipient;
}
