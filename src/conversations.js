export const seedConversations = [
  {
    id: 'maria',
    name: 'Maria Chen',
    company: 'Northline Grocers',
    status: 'Priority customer',
    workflow: 'open',
    intent: 'Bulk order',
    confidence: 94,
    queue: ['order'],
    value: '$4,820',
    valueAmount: 4820,
    risk: 'Same-day fulfilment depends on stock and dispatch capacity',
    riskLevel: 'medium',
    action: 'Confirm available cartons and reserve a dispatch window',
    preview: 'Can you confirm 80 cartons for delivery today?',
    tags: ['Order', 'Stock check'],
    messages: [
      ['customer', 'Hi, can you confirm if the green tea cartons are available today?'],
      ['customer', 'We need 80 cartons delivered to Parramatta before 5pm if possible.'],
      ['agent', 'I can check stock and delivery capacity now. Do you want the same invoice account as last month?']
    ],
    activity: [
      { type: 'detected', label: 'Bulk order intent detected' },
      { type: 'checked', label: 'Stock check prepared' }
    ],
    replies: {
      helpful: 'Yes, we can help with that. I am checking live stock for 80 green tea cartons and the Parramatta delivery window now. If availability is confirmed, I will reserve the cartons under your usual invoice account and send the delivery ETA.',
      sales: 'We can support this order. I am checking availability for 80 green tea cartons and will reserve the stock once confirmed. I can also add matching jasmine tea cartons at the current wholesale price if you want to top up the shipment.',
      ops: 'Stock check started for 80 green tea cartons. Next step: confirm available cartons, reserve inventory, then create a same-day dispatch task for Parramatta before 5pm.'
    }
  },
  {
    id: 'sam',
    name: 'Sam Patel',
    company: 'Urban Homewares',
    status: 'Delivery follow-up',
    workflow: 'open',
    intent: 'Delivery status',
    confidence: 88,
    queue: ['delivery'],
    value: '$1,240',
    valueAmount: 1240,
    risk: 'Courier scan is late but the parcel is in transit',
    riskLevel: 'low',
    action: 'Share the latest tracking status and monitor the next scan',
    preview: 'The customer says the tracking link has not moved.',
    tags: ['Delivery', 'Follow-up'],
    messages: [
      ['customer', 'Morning, the tracking link for order WH-3192 has not moved since yesterday.'],
      ['agent', 'Thanks for the order number. I am checking the courier event history now.']
    ],
    activity: [
      { type: 'detected', label: 'Delivery follow-up detected' },
      { type: 'checked', label: 'Courier hand-off confirmed' }
    ],
    replies: {
      helpful: 'Thanks for waiting. Order WH-3192 was packed and handed to the courier yesterday afternoon. The tracking page is waiting for the next depot scan. I will keep this thread open and send the next update as soon as it appears.',
      sales: 'Order WH-3192 has left our warehouse and is waiting for the next courier scan. I will monitor it for you and make sure you get a clear ETA before the end of the day.',
      ops: 'Courier tracking for WH-3192 is pending a depot scan. Keep the conversation open, monitor the next event, and trigger a follow-up if it has not updated by 3pm.'
    }
  },
  {
    id: 'ava',
    name: 'Ava Williams',
    company: 'Direct customer',
    status: 'Needs human review',
    workflow: 'needs_review',
    intent: 'Refund request',
    confidence: 81,
    queue: ['urgent'],
    value: '$340',
    valueAmount: 340,
    risk: 'The request may require an exception to the return policy',
    riskLevel: 'high',
    action: 'Escalate to support before confirming the outcome',
    preview: 'The customer wants a refund after the return window.',
    tags: ['Urgent', 'Refund'],
    messages: [
      ['customer', 'I need a refund on my order. It arrived late and I missed the birthday.'],
      ['customer', 'Your policy says 14 days but this was not my fault.'],
      ['agent', 'I am reviewing the order details before confirming the next step.']
    ],
    activity: [
      { type: 'detected', label: 'Refund request detected' },
      { type: 'guardrail', label: 'Policy exception guardrail triggered' }
    ],
    replies: {
      helpful: 'I understand why you are asking for a refund. Because this may fall outside the standard return window, I am escalating it to a support specialist so we can review the delivery timing and give you a clear answer.',
      sales: 'I understand why you are asking for a refund. I am escalating this to our support team so they can review the delivery issue and confirm the best resolution for you.',
      ops: 'Refund request requires human review. Escalate with the order timeline, delivery ETA history, and policy exception note before sending a final outcome.'
    }
  },
  {
    id: 'liam',
    name: 'Liam OConnor',
    company: 'Harbour Cafe Group',
    status: 'New lead',
    workflow: 'open',
    intent: 'Product recommendation',
    confidence: 76,
    queue: ['order'],
    value: '$2,100',
    valueAmount: 2100,
    risk: 'Quote depends on volume per location',
    riskLevel: 'low',
    action: 'Recommend a starter bundle and collect expected volume',
    preview: 'Looking for supplies for three new cafe locations.',
    tags: ['Lead', 'Quote'],
    messages: [
      ['customer', 'We are opening three cafes next month. Can you recommend a starter pack for takeaway packaging?'],
      ['agent', 'I can suggest a pack based on your expected daily cup and food container volume.']
    ],
    activity: [
      { type: 'detected', label: 'Multi-site sales lead detected' },
      { type: 'guardrail', label: 'Daily volume is still required' }
    ],
    replies: {
      helpful: 'A useful starter pack for three cafes includes hot cups, cold cups, lids, napkins, kraft bags, and two food-container sizes. Share the expected daily orders per location and I can estimate quantities and prepare a quote.',
      sales: 'For three new cafes, I recommend our launch bundle with cups, lids, napkins, bags, and food containers. It keeps each site stocked for the opening period and qualifies for wholesale pricing once quantities are confirmed.',
      ops: 'Collect daily order volume per location, then calculate starter stock by category. Create a quote after volume and delivery dates are confirmed.'
    }
  }
];
