import { Router } from "express";
import { pool } from "../db.js";

export const conversationsRouter = Router();

// List conversations
conversationsRouter.get("/", async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    let query = `
      SELECT c.*,
             COUNT(m.id)::int AS message_count,
             MAX(m.created_at) AS last_message_at
      FROM conversations c
      LEFT JOIN messages m ON m.conversation_id = c.id
    `;
    const params = [];
    if (status) {
      params.push(status);
      query += ` WHERE c.status = $${params.length}`;
    }
    query += ` GROUP BY c.id ORDER BY c.updated_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal error" });
  }
});

// Get single conversation with messages
conversationsRouter.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const conv = await pool.query("SELECT * FROM conversations WHERE id = $1", [id]);
    if (!conv.rows.length) return res.status(404).json({ error: "Not found" });

    const messages = await pool.query(
      "SELECT id, role, content, pii_redacted, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC",
      [id]
    );
    res.json({ ...conv.rows[0], messages: messages.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal error" });
  }
});

// Cancel a conversation
conversationsRouter.patch("/:id/cancel", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "UPDATE conversations SET status = 'cancelled', updated_at = NOW() WHERE id = $1 RETURNING *",
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Not found" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Internal error" });
  }
});

// Delete a conversation
conversationsRouter.delete("/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM conversations WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Internal error" });
  }
});
