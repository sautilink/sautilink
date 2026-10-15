const pendingRequests = new Map();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Retain the same request UUID when transport fails or the 202 response is lost.
// A changed Room/body/ordered-media snapshot gets a different request UUID.
export function roomPublishRequestId(snapshot) {
  const key = JSON.stringify(snapshot);
  if (!pendingRequests.has(key)) {
    if (pendingRequests.size >= 32) pendingRequests.delete(pendingRequests.keys().next().value);
    pendingRequests.set(key, crypto.randomUUID());
  }
  return pendingRequests.get(key);
}

export function confirmRoomPublishRequest(snapshot) {
  pendingRequests.delete(JSON.stringify(snapshot));
}

export function roomPublishOutcome(response, payload) {
  if (!response.ok || payload?.ok === false) throw new Error(payload?.error?.message || 'The Room post could not be submitted.');
  if (response.status === 202) {
    const submission = payload?.data?.submission;
    if (payload?.data?.published === false && submission?.state === 'pending' && UUID.test(submission.id || '')) {
      return { pending: true, id: submission.id };
    }
    throw new Error('The Room submission was not confirmed. Retry this draft.');
  }
  if (UUID.test(payload?.data?.post?.id || '')) return { pending: false, id: payload.data.post.id };
  throw new Error('The post was not confirmed. Retry this draft.');
}
