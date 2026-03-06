// In-memory store for rooms (persists while serverless function is warm)
const rooms = global.__rooms || (global.__rooms = new Map());

// Clean rooms older than 30 minutes
function cleanup() {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (now - room.created > 30 * 60 * 1000) rooms.delete(id);
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  cleanup();

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { action } = body;

    if (action === 'create') {
      const roomId = Math.random().toString(36).slice(2, 8).toUpperCase();
      rooms.set(roomId, { created: Date.now(), notes: [] });
      return res.json({ roomId });
    }

    if (action === 'addNote') {
      const { roomId, note } = body;
      const room = rooms.get(roomId);
      if (!room) return res.status(404).json({ error: 'Sala não encontrada' });
      const noteData = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        text: note.text || '',
        color: note.color || '#FDFD96',
        timestamp: Date.now(),
      };
      room.notes.push(noteData);
      return res.json({ ok: true, note: noteData });
    }

    return res.status(400).json({ error: 'Ação inválida' });
  }

  if (req.method === 'GET') {
    const roomId = req.query.roomId;
    const since = parseInt(req.query.since) || 0;

    if (!roomId) return res.status(400).json({ error: 'roomId obrigatório' });

    const room = rooms.get(roomId);
    if (!room) return res.status(404).json({ error: 'Sala não encontrada' });

    const newNotes = room.notes.filter(n => n.timestamp > since);
    return res.json({ notes: newNotes, timestamp: Date.now() });
  }

  res.status(405).json({ error: 'Método não permitido' });
};
