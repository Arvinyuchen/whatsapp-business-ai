export function createWhatsAppClient({
  accessToken,
  phoneNumberId,
  whatsappBusinessAccountId,
  graphVersion = 'v25.0',
  requestTimeoutMs = 15_000,
  fetchAdapter = fetch
}) {
  const missing = [
    !accessToken && 'WHATSAPP_ACCESS_TOKEN',
    !phoneNumberId && 'WHATSAPP_PHONE_NUMBER_ID'
  ].filter(Boolean);

  async function fetchMeta(url, options = {}) {
    try {
      return await fetchAdapter(url, {
        ...options,
        signal: AbortSignal.timeout(requestTimeoutMs)
      });
    } catch (error) {
      if (['AbortError', 'TimeoutError'].includes(error.name)) {
        throw new Error('WhatsApp request timed out. Try again.');
      }
      throw error;
    }
  }

  return {
    getStatus() {
      return {
        configured: missing.length === 0,
        graphVersion,
        missing: [...missing]
      };
    },

    async listTemplates() {
      if (!accessToken || !whatsappBusinessAccountId) {
        throw new Error('WhatsApp template management is not configured.');
      }

      const response = await fetchMeta(
        `https://graph.facebook.com/${graphVersion}/${whatsappBusinessAccountId}/message_templates?fields=id,name,status,language,category,components&limit=100`,
        {
          headers: { authorization: `Bearer ${accessToken}` }
        }
      );
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(
          `WhatsApp templates failed: ${payload.error?.message || response.statusText}`
        );
      }

      return (payload.data || []).map((template) => ({
        id: template.id,
        name: template.name,
        status: template.status,
        language: template.language,
        category: template.category,
        body: template.components?.find((component) => component.type === 'BODY')?.text || ''
      }));
    },

    async sendTemplate({ to, name, language = 'en_US' }) {
      if (!accessToken || !phoneNumberId) {
        throw new Error('WhatsApp Cloud API is not configured.');
      }

      const response = await fetchMeta(
        `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'template',
            template: {
              name,
              language: { code: language }
            }
          })
        }
      );
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(`WhatsApp send failed: ${payload.error?.message || response.statusText}`);
      }

      return { messageId: payload.messages[0].id };
    },

    async sendText({ to, body }) {
      if (!accessToken || !phoneNumberId) {
        throw new Error('WhatsApp Cloud API is not configured.');
      }

      const response = await fetchMeta(
        `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'text',
            text: { body, preview_url: false }
          })
        }
      );
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(`WhatsApp send failed: ${payload.error?.message || response.statusText}`);
      }

      return { messageId: payload.messages[0].id };
    }
  };
}
