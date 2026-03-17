const Anthropic = require('@anthropic-ai/sdk');
const {
  getConversation,
  createConversation,
  addMessage,
  updateConversation,
  STAGES,
} = require('./lib/conversation');
const {
  buildMessages,
  parseAgentResponse,
  getNextStage,
  getAgentForStage,
} = require('./lib/agents');

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'uau-verify-token';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Send message via WhatsApp Business API
async function sendWhatsAppMessage(to, text) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.log('[DEV MODE] Would send to', to, ':', text);
    return { ok: true, dev: true };
  }

  const url = `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }),
  });

  return response.json();
}

// Call Claude API to generate agent response
async function getAgentResponse(conversation, incomingMessage) {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const { system, messages } = buildMessages(conversation, incomingMessage);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 512,
    system,
    messages,
  });

  const responseText = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  return responseText;
}

// Process incoming message
async function processMessage(phoneNumber, customerName, messageText) {
  // Get or create conversation
  let conversation = getConversation(phoneNumber);
  if (!conversation) {
    conversation = createConversation(phoneNumber, customerName);
  }

  // Store incoming message
  addMessage(phoneNumber, 'user', messageText);

  // Get AI response for current stage
  const responseText = await getAgentResponse(conversation, messageText);
  const parsed = parseAgentResponse(responseText);

  // Store agent response
  addMessage(phoneNumber, 'assistant', parsed.message);

  // Check if current stage is complete, advance to next
  if (parsed.stageComplete) {
    const nextStage = getNextStage(conversation.stage);

    const updates = { stage: nextStage };

    // Store collected data
    if (parsed.data.customer_name) {
      updates.customerName = parsed.data.customer_name;
    }
    if (parsed.data.qualification) {
      updates.qualificationData = parsed.data.qualification;
    }
    if (parsed.data.needs) {
      updates.needsData = parsed.data.needs;
    }

    updateConversation(phoneNumber, updates);

    // Log stage transition
    const agent = getAgentForStage(nextStage);
    console.log(`[${phoneNumber}] Stage: ${conversation.stage} -> ${nextStage} (${agent.name})`);

    // If we completed all stages, log the full lead data
    if (nextStage === STAGES.COMPLETED) {
      const finalConv = getConversation(phoneNumber);
      console.log('[LEAD COMPLETO]', JSON.stringify({
        phone: phoneNumber,
        name: finalConv.customerName,
        qualification: finalConv.qualificationData,
        needs: finalConv.needsData,
        timestamp: new Date().toISOString(),
      }, null, 2));
    }
  }

  return parsed.message;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle CORS preflight
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Webhook verification (GET) - required by Meta
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN) {
      console.log('[WEBHOOK] Verified successfully');
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Verification failed' });
  }

  // Handle incoming messages (POST)
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    // Dev/test mode: direct message processing
    if (body.test === true) {
      try {
        const { phone, name, message } = body;
        if (!phone || !message) {
          return res.status(400).json({ error: 'phone and message are required' });
        }
        const reply = await processMessage(phone, name || '', message);
        const conv = getConversation(phone);
        return res.json({
          reply,
          stage: conv.stage,
          customerName: conv.customerName,
          qualificationData: conv.qualificationData,
          needsData: conv.needsData,
        });
      } catch (err) {
        console.error('[TEST ERROR]', err);
        return res.status(500).json({ error: err.message });
      }
    }

    // WhatsApp webhook payload processing
    try {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;

      // Only process message events
      if (value?.messages?.[0]) {
        const msg = value.messages[0];
        const contact = value.contacts?.[0];

        const phoneNumber = msg.from;
        const customerName = contact?.profile?.name || '';
        const messageText = msg.text?.body || '';

        if (messageText) {
          const reply = await processMessage(phoneNumber, customerName, messageText);
          await sendWhatsAppMessage(phoneNumber, reply);
        }
      }

      // Always return 200 to acknowledge webhook
      return res.status(200).json({ status: 'ok' });
    } catch (err) {
      console.error('[WEBHOOK ERROR]', err);
      // Still return 200 to prevent Meta from retrying
      return res.status(200).json({ status: 'error', message: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
