// In-memory conversation store (persists while serverless function is warm)
const conversations = global.__conversations || (global.__conversations = new Map());

// Conversation stages
const STAGES = {
  GREETING: 'greeting',
  QUALIFICATION: 'qualification',
  NEEDS: 'needs',
  COMPLETED: 'completed',
};

// Clean conversations older than 24 hours
function cleanup() {
  const now = Date.now();
  for (const [id, conv] of conversations) {
    if (now - conv.updatedAt > 24 * 60 * 60 * 1000) {
      conversations.delete(id);
    }
  }
}

function getConversation(phoneNumber) {
  cleanup();
  return conversations.get(phoneNumber) || null;
}

function createConversation(phoneNumber, customerName) {
  const conv = {
    phoneNumber,
    customerName: customerName || '',
    stage: STAGES.GREETING,
    messages: [],
    qualificationData: {},
    needsData: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  conversations.set(phoneNumber, conv);
  return conv;
}

function updateConversation(phoneNumber, updates) {
  const conv = conversations.get(phoneNumber);
  if (!conv) return null;
  Object.assign(conv, updates, { updatedAt: Date.now() });
  return conv;
}

function addMessage(phoneNumber, role, content) {
  const conv = conversations.get(phoneNumber);
  if (!conv) return null;
  conv.messages.push({ role, content, timestamp: Date.now() });
  conv.updatedAt = Date.now();
  return conv;
}

module.exports = {
  STAGES,
  getConversation,
  createConversation,
  updateConversation,
  addMessage,
};
