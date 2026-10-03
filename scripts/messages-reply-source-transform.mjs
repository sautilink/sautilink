function replaceRequired(source, search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`Messages reply transform could not find ${label}.`);
  }
  return source.replace(search, replacement);
}

const THREAD_SELECT = "id, conversation_id, sender_id, body, sent_at, deleted_at";
const THREAD_REPLY_SELECT = "id, conversation_id, sender_id, body, message_kind, sent_at, edited_at, deleted_at, reply_to_message_id";

export function transformMessagesReplySource(filePath, source) {
  if (!String(filePath || '').endsWith('app.js')) return source;
  if (source.includes('data-reply-dm-message') && source.includes('reply_to_message_id: replyToMessageId')) return source;

  let output = source.replaceAll(THREAD_SELECT, THREAD_REPLY_SELECT);
  if (output === source) {
    throw new Error('Messages reply transform could not find the DM thread select contract.');
  }

  const renderSource = `function renderDirectMessage(message) {
  const own = message.sender_id === currentMemberId;
  const deleted = Boolean(message.deleted_at);
  const row = document.createElement('article');
  row.className = \`dm-message \${own ? 'own' : 'incoming'}\${deleted ? ' deleted' : ''}\`;
  row.dataset.messageId = String(message.id);
  row.dataset.sentAt = String(message.sent_at || '');
  row.dataset.ownMessage = String(own);

  const body = document.createElement('p');
  body.textContent = deleted ? 'Message deleted.' : String(message.body || '');

  const meta = document.createElement('span');
  meta.className = 'dm-message-meta';
  const time = document.createElement('time');
  time.dateTime = message.sent_at || '';
  time.textContent = formatSautiTime(message.sent_at);
  meta.append(time);

  if (!deleted) {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'dm-message-action';
    if (own) {
      action.dataset.deleteDmMessage = String(message.id);
      action.textContent = 'Delete';
    } else {
      action.dataset.reportDmMessage = String(message.id);
      action.textContent = 'Report';
    }
    meta.append(action);
  }

  row.append(body, meta);
  return row;
}`;

  const renderReplacement = `async function hydrateDmReplyTargets(conversationId, messages) {
  const byMessageId = new Map(messages.map((message) => [String(message.id), message]));
  const missingIds = [...new Set(messages
    .map((message) => String(message.reply_to_message_id || ''))
    .filter((id) => id && !byMessageId.has(id)))];
  if (missingIds.length) {
    const { data } = await supabase
      .from('dm_messages')
      .select('id, conversation_id, sender_id, body, message_kind, deleted_at')
      .eq('conversation_id', conversationId)
      .in('id', missingIds);
    for (const original of data || []) byMessageId.set(String(original.id), original);
  }
  return messages.map((message) => message.reply_to_message_id
    ? { ...message, reply: byMessageId.get(String(message.reply_to_message_id)) || null }
    : message);
}

function dmReplyPreview(message) {
  if (!message) return 'Message';
  if (message.deleted_at) return 'Message deleted.';
  const text = String(message.body || '').trim().replace(/\\s+/g, ' ');
  if (text) return text.length > 140 ? \`\${text.slice(0, 137)}…\` : text;
  if (message.message_kind === 'photo') return 'Photo';
  if (message.message_kind === 'voice') return 'Voice message';
  if (message.message_kind === 'file') return 'File';
  return 'Message';
}

function dmReplyAuthor(message) {
  if (!message) return 'Reply';
  if (message.sender_id === currentMemberId) return 'You';
  return activeConversation?.peer?.display_name
    || activeConversation?.peer?.username
    || 'Reply';
}

function renderDirectMessage(message) {
  const own = message.sender_id === currentMemberId;
  const deleted = Boolean(message.deleted_at);
  const row = document.createElement('article');
  row.className = \`dm-message \${own ? 'own' : 'incoming'}\${deleted ? ' deleted' : ''}\`;
  row.dataset.messageId = String(message.id);
  row.dataset.sentAt = String(message.sent_at || '');
  row.dataset.ownMessage = String(own);
  row.dataset.messageKind = String(message.message_kind || 'text');
  if (message.reply_to_message_id) row.dataset.replyToMessageId = String(message.reply_to_message_id);

  if (message.reply_to_message_id) {
    const quote = document.createElement('button');
    quote.type = 'button';
    quote.className = 'dm-reply-context';
    quote.dataset.jumpToDmMessage = String(message.reply_to_message_id);
    quote.setAttribute('aria-label', \`Open replied message from \${dmReplyAuthor(message.reply)}\`);

    const author = document.createElement('strong');
    author.textContent = dmReplyAuthor(message.reply);
    const preview = document.createElement('span');
    preview.textContent = dmReplyPreview(message.reply);
    quote.append(author, preview);
    row.append(quote);
  }

  const body = document.createElement('p');
  body.textContent = deleted ? 'Message deleted.' : String(message.body || '');

  const meta = document.createElement('span');
  meta.className = 'dm-message-meta';
  const time = document.createElement('time');
  time.dateTime = message.sent_at || '';
  time.textContent = formatSautiTime(message.sent_at);
  meta.append(time);

  if (message.edited_at && !deleted) {
    const edited = document.createElement('span');
    edited.className = 'dm-message-edited';
    edited.textContent = 'Edited';
    meta.append(edited);
  }

  if (!deleted) {
    const reply = document.createElement('button');
    reply.type = 'button';
    reply.className = 'dm-message-action dm-message-reply-action';
    reply.dataset.replyDmMessage = String(message.id);
    reply.textContent = 'Reply';
    meta.append(reply);

    if (own && (message.message_kind || 'text') === 'text') {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'dm-message-action';
      edit.dataset.editDmMessage = String(message.id);
      edit.textContent = 'Edit';
      meta.append(edit);
    }

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'dm-message-action';
    if (own) {
      action.dataset.deleteDmMessage = String(message.id);
      action.textContent = 'Delete';
    } else {
      action.dataset.reportDmMessage = String(message.id);
      action.textContent = 'Report';
    }
    meta.append(action);
  }

  row.append(body, meta);
  return row;
}`;

  output = replaceRequired(output, renderSource, renderReplacement, 'direct message renderer');

  output = replaceRequired(output,
    `  if (error) throw error;
  return (data || []).reverse();
}

function dmCalendarKey`,
    `  if (error) throw error;
  return hydrateDmReplyTargets(conversationId, (data || []).reverse());
}

function dmCalendarKey`,
    'realtime thread reply hydration');

  output = replaceRequired(output,
    `    if (aroundTarget) messages = aroundTarget;
  }
  renderDmTimeline(feed, messages);
  empty.hidden = messages.length > 0;`,
    `    if (aroundTarget) messages = aroundTarget;
  }
  messages = await hydrateDmReplyTargets(conversation.id, messages);
  if (requestId !== messagesRequest) return;
  renderDmTimeline(feed, messages);
  empty.hidden = messages.length > 0;`,
    'initial thread reply hydration');

  const threadResetSource = `  empty.hidden = true;
  feed.replaceChildren();
  byId('message-body').value = '';`;
  const threadResetReplacement = `  empty.hidden = true;
  feed.replaceChildren();
  window.__sautilinkClearMessageReply?.();
  byId('message-body').value = '';`;
  output = replaceRequired(output, threadResetSource, threadResetReplacement, 'thread reply reset');

  const sendSetupSource = `  submit.disabled = true;
  submit.setAttribute('aria-busy', 'true');
  const previous = submit.textContent;
  submit.textContent = 'Sending…';

  try {
    const { error } = await supabase
      .from('dm_messages')
      .insert({
        conversation_id: activeConversation.id,
        sender_id: currentMemberId,
        body,
      });`;

  const sendSetupReplacement = `  submit.disabled = true;
  submit.setAttribute('aria-busy', 'true');
  submit.dataset.sending = 'true';
  const previousLabel = submit.getAttribute('aria-label') || 'Send message';
  submit.setAttribute('aria-label', 'Sending message');
  const replyToMessageId = Number.parseInt(String(byId('message-composer')?.dataset.replyToMessageId || ''), 10);
  const insertPayload = {
    conversation_id: activeConversation.id,
    sender_id: currentMemberId,
    body,
  };
  if (Number.isSafeInteger(replyToMessageId) && replyToMessageId > 0) {
    insertPayload.reply_to_message_id = replyToMessageId;
  }

  try {
    const { error } = await supabase
      .from('dm_messages')
      .insert(insertPayload);`;

  output = replaceRequired(output, sendSetupSource, sendSetupReplacement, 'direct message send setup');

  const sendSuccessSource = `    textarea.value = '';
    updateMessageComposerState();
    await broadcastDmTyping(false);`;
  const sendSuccessReplacement = `    textarea.value = '';
    window.__sautilinkClearMessageReply?.();
    updateMessageComposerState();
    await broadcastDmTyping(false);`;
  output = replaceRequired(output, sendSuccessSource, sendSuccessReplacement, 'direct message reply clear');

  const sendFinallySource = `  } finally {
    submit.textContent = previous;
    submit.removeAttribute('aria-busy');
    updateMessageComposerState();
  }
}`;
  const sendFinallyReplacement = `  } finally {
    submit.removeAttribute('aria-busy');
    delete submit.dataset.sending;
    submit.setAttribute('aria-label', previousLabel);
    updateMessageComposerState();
  }
}`;
  output = replaceRequired(output, sendFinallySource, sendFinallyReplacement, 'send icon restoration');

  return output;
}
