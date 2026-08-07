function formatFallbackTimestamp(timestamp) {
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Time unavailable';

  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(seconds * 1000));
}

function capitalise(value) {
  const text = String(value || '').trim().toLowerCase();
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : 'Updated';
}

export function sortWhatsAppEvents(events) {
  return [...events].sort((left, right) => {
    return (Number(right.timestamp) || 0) - (Number(left.timestamp) || 0);
  });
}

export function presentWhatsAppEvent(event, {
  formatTimestamp = formatFallbackTimestamp
} = {}) {
  const timestamp = formatTimestamp(event.timestamp);

  if (event.type === 'message.received') {
    return {
      id: event.messageId || 'Inbound message',
      kind: 'inbound',
      marker: '←',
      label: 'Inbound message',
      subject: event.contactName || event.from || 'Unknown contact',
      detail: event.text || 'Message received without a text preview.',
      timestamp
    };
  }

  if (event.type === 'message.status') {
    const status = String(event.status || 'updated').toLowerCase();
    return {
      id: event.messageId || 'Outbound message',
      kind: ['failed', 'undelivered'].includes(status) ? 'failed' : 'status',
      marker: status === 'read' ? '✓✓' : '✓',
      label: 'Delivery status',
      subject: `Message ${capitalise(status).toLowerCase()}`,
      detail: event.recipient ? `To ${event.recipient}` : 'Recipient unavailable',
      timestamp
    };
  }

  return {
    id: event.messageId || 'WhatsApp event',
    kind: 'unknown',
    marker: '·',
    label: 'WhatsApp event',
    subject: 'Activity received',
    detail: 'This event type does not have a preview yet.',
    timestamp
  };
}
