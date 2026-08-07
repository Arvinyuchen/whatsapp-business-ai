async function readJson(response) {
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error || 'The live workspace request failed.');
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function loadLiveWorkspace({ token, fetchImpl = fetch }) {
  if (!token) throw new Error('Enter the operator token to load the live workspace.');
  const response = await fetchImpl('/api/workspace', {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`
    }
  });
  return readJson(response);
}

export async function applyLiveConversationAction({
  token,
  conversationId,
  action,
  fetchImpl = fetch
}) {
  if (!token) throw new Error('Load the live workspace before changing this conversation.');
  if (!conversationId) throw new Error('A live conversation is required.');
  if (!['escalate', 'defer'].includes(action)) throw new Error('Unsupported conversation action.');

  const response = await fetchImpl(
    `/api/conversations/${encodeURIComponent(conversationId)}/actions`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ action })
    }
  );
  return readJson(response);
}

export async function generateLiveReplyDraft({
  token,
  conversationId,
  tone,
  fetchImpl = fetch
}) {
  if (!token) throw new Error('Load the live workspace before generating an AI draft.');
  if (!conversationId) throw new Error('A live conversation is required.');
  const response = await fetchImpl(
    `/api/conversations/${encodeURIComponent(conversationId)}/draft`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ tone })
    }
  );
  return readJson(response);
}
