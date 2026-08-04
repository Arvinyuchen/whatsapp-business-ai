const conversations = [
  {
    id: 'maria',
    name: 'Maria Chen',
    company: 'Northline Grocers',
    status: 'Priority customer',
    intent: 'Bulk order',
    confidence: 94,
    queue: ['order'],
    value: '$4,820',
    risk: 'Medium - requested same-day fulfilment',
    action: 'Confirm available cartons and reserve dispatch window',
    preview: 'Can you confirm 80 cartons for delivery today?',
    tags: ['Order', 'Stock check'],
    messages: [
      ['customer', 'Hi, can you confirm if the green tea cartons are available today?'],
      ['customer', 'We need 80 cartons delivered to Parramatta before 5pm if possible.'],
      ['agent', 'I can check stock and delivery capacity now. Do you want the same invoice account as last month?']
    ],
    replies: {
      helpful: 'Yes, we can help with that. I am checking live stock for 80 green tea cartons and the Parramatta delivery window now. If availability is confirmed, I will reserve the cartons under your usual invoice account and send the delivery ETA.',
      sales: 'We can support this order. I am checking availability for 80 green tea cartons and will reserve the stock once confirmed. I can also add the matching jasmine tea cartons at the current wholesale price if you want to top up the shipment.',
      ops: 'Stock check started for 80 green tea cartons. Next step is to confirm available cartons, reserve inventory, then create a same-day dispatch task for Parramatta before 5pm.'
    }
  },
  {
    id: 'sam',
    name: 'Sam Patel',
    company: 'Urban Homewares',
    status: 'Delivery follow-up',
    intent: 'Delivery status',
    confidence: 88,
    queue: ['delivery'],
    value: '$1,240',
    risk: 'Low - waiting on courier scan',
    action: 'Share tracking status and offer proactive update',
    preview: 'The customer says the tracking link has not moved.',
    tags: ['Delivery', 'Follow-up'],
    messages: [
      ['customer', 'Morning, the tracking link for order WH-3192 has not moved since yesterday.'],
      ['agent', 'Thanks for the order number. I am checking the courier event history now.']
    ],
    replies: {
      helpful: 'Thanks for waiting. I can see order WH-3192 was packed and handed to the courier yesterday afternoon. The tracking page is waiting for the next depot scan. I will keep this thread open and send you the next update as soon as it appears.',
      sales: 'Order WH-3192 has left our warehouse and is waiting for the next courier scan. I will monitor it for you and make sure you get a clear ETA before the end of the day.',
      ops: 'Courier tracking for WH-3192 is pending depot scan. Keep conversation open, monitor next event, and trigger a follow-up if the scan has not updated by 3pm.'
    }
  },
  {
    id: 'ava',
    name: 'Ava Williams',
    company: 'Direct customer',
    status: 'Needs human review',
    intent: 'Refund request',
    confidence: 81,
    queue: ['urgent'],
    value: '$340',
    risk: 'High - refund policy exception',
    action: 'Escalate to human support before sending final answer',
    preview: 'The customer wants a refund after the return window.',
    tags: ['Urgent', 'Refund'],
    messages: [
      ['customer', 'I need a refund on my order. It arrived late and I missed the birthday.'],
      ['customer', 'Your policy says 14 days but this was not my fault.'],
      ['agent', 'I am sorry the delivery timing caused that. I am reviewing the order details before confirming the next step.']
    ],
    replies: {
      helpful: 'I am sorry this caused a problem for the birthday. Because this may be outside the standard return window, I am escalating it to a support specialist now so we can review the delivery timing and give you a clear answer.',
      sales: 'I understand why you are asking for a refund. I am escalating this to our support team so they can review the delivery issue and confirm the best resolution for you.',
      ops: 'Refund request requires human review. Escalate with order timeline, delivery ETA history, and policy exception note before sending a final customer response.'
    }
  },
  {
    id: 'liam',
    name: 'Liam OConnor',
    company: 'Harbour Cafe Group',
    status: 'New lead',
    intent: 'Product recommendation',
    confidence: 76,
    queue: ['order'],
    value: '$2,100',
    risk: 'Low - quote requested',
    action: 'Recommend starter bundle and collect quantity',
    preview: 'Looking for supplies for three new cafe locations.',
    tags: ['Lead', 'Quote'],
    messages: [
      ['customer', 'We are opening three cafes next month. Can you recommend a starter pack for takeaway packaging?'],
      ['agent', 'Absolutely. I can suggest a pack based on your expected daily cup and food container volume.']
    ],
    replies: {
      helpful: 'A good starter pack for three cafes would include hot cups, cold cups, lids, napkins, kraft bags, and two food container sizes. If you share expected daily orders per location, I can estimate quantities and prepare a quote.',
      sales: 'For three new cafes, I recommend our launch bundle with cups, lids, napkins, bags, and food containers. It keeps each site stocked for the first trading period and qualifies for wholesale pricing once quantities are confirmed.',
      ops: 'Collect daily order volume per location, then calculate starter stock by category. Create a quote after volume and delivery date are confirmed.'
    }
  }
];

const state = {
  selectedId: conversations[0].id,
  tone: 'helpful',
  filter: 'all'
};

const elements = {
  queueFilter: document.querySelector('#queueFilter'),
  conversationList: document.querySelector('#conversationList'),
  chatStatus: document.querySelector('#chatStatus'),
  chatName: document.querySelector('#chatName'),
  chatIntent: document.querySelector('#chatIntent'),
  chatConfidence: document.querySelector('#chatConfidence'),
  messageThread: document.querySelector('#messageThread'),
  replyDraft: document.querySelector('#replyDraft'),
  detailIntent: document.querySelector('#detailIntent'),
  detailAction: document.querySelector('#detailAction'),
  detailValue: document.querySelector('#detailValue'),
  detailRisk: document.querySelector('#detailRisk'),
  rewriteButton: document.querySelector('#rewriteButton'),
  sendButton: document.querySelector('#sendButton'),
  stockCheckToggle: document.querySelector('#stockCheckToggle'),
  toneOptions: document.querySelectorAll('.tone-option')
};

function getSelectedConversation() {
  return conversations.find((conversation) => conversation.id === state.selectedId) || conversations[0];
}

function renderConversationList() {
  const filtered = conversations.filter((conversation) => {
    return state.filter === 'all' || conversation.queue.includes(state.filter);
  });

  elements.conversationList.innerHTML = filtered
    .map((conversation) => {
      const active = conversation.id === state.selectedId ? ' active' : '';
      const tags = conversation.tags.map((tag) => `<span>${tag}</span>`).join('');

      return `
        <button class="conversation-item${active}" type="button" data-id="${conversation.id}">
          <span class="conversation-topline">
            <strong>${conversation.name}</strong>
            <small>${conversation.confidence}%</small>
          </span>
          <span class="conversation-company">${conversation.company}</span>
          <span class="conversation-preview">${conversation.preview}</span>
          <span class="tag-row">${tags}</span>
        </button>
      `;
    })
    .join('');

  elements.conversationList.querySelectorAll('.conversation-item').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedId = button.dataset.id;
      render();
    });
  });
}

function renderMessages(conversation) {
  elements.messageThread.innerHTML = conversation.messages
    .map(([sender, text]) => {
      return `<div class="message ${sender}"><span>${text}</span></div>`;
    })
    .join('');
}

function renderDetails(conversation) {
  elements.chatStatus.textContent = conversation.status;
  elements.chatName.textContent = conversation.name;
  elements.chatIntent.textContent = conversation.intent;
  elements.chatConfidence.textContent = `${conversation.confidence}%`;
  elements.detailIntent.textContent = conversation.intent;
  elements.detailAction.textContent = conversation.action;
  elements.detailValue.textContent = conversation.value;
  elements.detailRisk.textContent = conversation.risk;
}

function renderReply(conversation) {
  const suffix = elements.stockCheckToggle.checked
    ? ' I will include stock availability in the reply before confirming.'
    : '';

  elements.replyDraft.value = `${conversation.replies[state.tone]}${suffix}`;
}

function render() {
  const conversation = getSelectedConversation();

  renderConversationList();
  renderMessages(conversation);
  renderDetails(conversation);
  renderReply(conversation);
}

elements.queueFilter.addEventListener('change', (event) => {
  state.filter = event.target.value;
  const visibleConversation = conversations.find((conversation) => {
    return state.filter === 'all' || conversation.queue.includes(state.filter);
  });

  if (visibleConversation) {
    state.selectedId = visibleConversation.id;
  }

  render();
});

elements.toneOptions.forEach((button) => {
  button.addEventListener('click', () => {
    elements.toneOptions.forEach((option) => option.classList.remove('active'));
    button.classList.add('active');
    state.tone = button.dataset.tone;
    renderReply(getSelectedConversation());
  });
});

elements.stockCheckToggle.addEventListener('change', () => {
  renderReply(getSelectedConversation());
});

elements.rewriteButton.addEventListener('click', () => {
  const conversation = getSelectedConversation();
  const opening =
    state.tone === 'ops'
      ? 'Operational note:'
      : state.tone === 'sales'
        ? 'Thanks for reaching out.'
        : 'Thanks for the details.';

  elements.replyDraft.value = `${opening} ${conversation.replies[state.tone]}`;
});

elements.sendButton.addEventListener('click', () => {
  const conversation = getSelectedConversation();
  conversation.messages.push(['agent', elements.replyDraft.value]);
  renderMessages(conversation);
  elements.messageThread.scrollTop = elements.messageThread.scrollHeight;
});

render();
