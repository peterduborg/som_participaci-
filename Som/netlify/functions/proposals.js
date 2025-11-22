// netlify/functions/proposals.js
const { Pool } = require('pg');

const connectionString =
  process.env.DATABASE_URL ||
  process.env.Database_URL ||
  process.env.NETLIFY_DATABASE_URL ||
  process.env.NETLIFY_DATABASE_URL_UNPOOLED;

console.log(
  'PROPOSALS FUNCTION START, connectionString prefix:',
  (connectionString || 'UNDEFINED').slice(0, 40)
);

if (!connectionString) {
  throw new Error('DATABASE_URL / Database_URL / NETLIFY_DATABASE_URL not set');
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

exports.handler = async (event, context) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS'
  };

  // CORS Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    // Tabellen anlegen (falls noch nicht vorhanden)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS proposals (
        id         SERIAL PRIMARY KEY,
        title      TEXT NOT NULL,
        description TEXT NOT NULL,
        category   TEXT NOT NULL,
        author     TEXT NOT NULL,
        email      TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // Legacy-Tabelle für Stimmen (kann parallel zur neuen votes-Tabelle existieren)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS proposal_votes (
        id          SERIAL PRIMARY KEY,
        proposal_id INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
        email       TEXT NOT NULL,
        value       INTEGER NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (proposal_id, email)
      );
    `);

    // ---------- GET: alle Proposals laden ----------
    if (event.httpMethod === 'GET') {
      const res = await pool.query(
        `SELECT id, title, description, category, author, email, created_at
         FROM proposals
         ORDER BY created_at DESC`
      );
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(res.rows)
      };
    }

    // ---------- POST: neue Proposal anlegen ----------
    if (event.httpMethod === 'POST') {
      if (!event.body) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Missing body' })
        };
      }

      let data;
      try {
        data = JSON.parse(event.body);
      } catch {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Invalid JSON' })
        };
      }

      const title    = (data.title || '').trim();
      const desc     = (data.description || data.desc || '').trim();
      const category = (data.category || '').trim();
      const author   = (data.author || data.username || '').trim() || 'Usuari';
      const email    = (data.email || data.user_email || '').trim().toLowerCase();

      if (!title || !desc || !category || !email) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Falten camps per crear la proposta.' })
        };
      }

      const insertRes = await pool.query(
        `INSERT INTO proposals (title, description, category, author, email)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id, title, description, category, author, email, created_at`,
        [title, desc, category, author, email]
      );

      const proposal = insertRes.rows[0];
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposal })
      };
    }

    // ---------- DELETE: Proposal löschen (nur Ersteller) ----------
    if (event.httpMethod === 'DELETE') {
      if (!event.body) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, error: 'Missing body' })
        };
      }

      let data;
      try {
        data = JSON.parse(event.body);
      } catch {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, error: 'Invalid JSON' })
        };
      }

      const id    = parseInt(data.id, 10);
      const email = (data.email || '').trim().toLowerCase();

      if (!id || !email) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, error: 'Falten dades per esborrar la proposta.' })
        };
      }

      // Prüfen, ob Proposal existiert und dem User gehört
      const pRes = await pool.query(
        `SELECT id, email
           FROM proposals
          WHERE id = $1`,
        [id]
      );

      if (pRes.rowCount === 0) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, error: 'Proposta no trobada.' })
        };
      }

      const proposal = pRes.rows[0];
      if (proposal.email.toLowerCase() !== email) {
        return {
          statusCode: 403,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, error: 'Només el creador pot esborrar aquesta proposta.' })
        };
      }

      // ------------ NEU: alles, was an der Proposal hängt, aufräumen ------------

      // 1) Neue votes-Tabelle (user_email / proposal_id TEXT / points)
      try {
        await pool.query(
          'DELETE FROM votes WHERE proposal_id = $1',
          [String(id)]          // proposal_id ist in votes als TEXT gespeichert
        );
      } catch (e) {
        console.warn('DELETE from votes failed (non-critical):', e.message || e);
      }

      // 2) Kommentare zur Proposal (comment_votes hängen via FK ON DELETE CASCADE dran)
      try {
        await pool.query(
          'DELETE FROM comments WHERE proposal_id = $1',
          [id]
        );
      } catch (e) {
        console.warn('DELETE from comments failed (non-critical):', e.message || e);
      }

      // 3) Legacy proposal_votes zur Sicherheit ebenfalls löschen
      try {
        await pool.query(
          'DELETE FROM proposal_votes WHERE proposal_id = $1',
          [id]
        );
      } catch (e) {
        console.warn('DELETE from proposal_votes failed (non-critical):', e.message || e);
      }

      // 4) Danach die Proposal selbst löschen
      await pool.query(
        'DELETE FROM proposals WHERE id = $1',
        [id]
      );

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true })
      };
    }

    // ---------- Methode nicht erlaubt ----------
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };

  } catch (err) {
    console.error('Error in proposals function:', err);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Internal Server Error' })
    };
  }
};
