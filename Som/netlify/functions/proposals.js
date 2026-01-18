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

// Upload-Regeln (Server-seitig erzwingen)
const MAX_FILE_BYTES = 500 * 1024; // 500KB
const ALLOWED_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg']);

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
  };
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(obj)
  };
}

function getQuery(event) {
  return event.queryStringParameters || {};
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS proposals (
      id          SERIAL PRIMARY KEY,
      title       TEXT NOT NULL,
      description TEXT NOT NULL,
      category    TEXT NOT NULL,
      author      TEXT NOT NULL,
      email       TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS attachment_filename TEXT;`);
  await pool.query(`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS attachment_mime TEXT;`);
  await pool.query(`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS attachment_size INTEGER;`);
  await pool.query(`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS attachment_data BYTEA;`);

  // optional: updated_at für spätere Auswertungen (nicht zwingend)
  await pool.query(`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;`);

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
}

function decodeAttachment(att) {
  if (!att) return null;

  const filename = String(att.filename || '').trim();
  const mime = String(att.mime || '').trim().toLowerCase();
  const base64 = String(att.base64 || '').trim();

  if (!filename || !mime || !base64) {
    throw new Error('Attachment unvollständig (filename/mime/base64).');
  }
  if (!ALLOWED_MIME.has(mime)) {
    throw new Error('Attachment mime nicht erlaubt (nur PDF/PNG/JPG).');
  }

  let buf;
  try {
    buf = Buffer.from(base64, 'base64');
  } catch {
    throw new Error('Attachment base64 ist ungültig.');
  }

  if (!buf || !buf.length) {
    throw new Error('Attachment ist leer.');
  }
  if (buf.length > MAX_FILE_BYTES) {
    throw new Error('Attachment zu groß (max. 500KB).');
  }

  return { filename, mime, size: buf.length, data: buf };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  try {
    await ensureSchema();

    // ---------- GET: Download attachment (binary) ----------
    // /.netlify/functions/proposals?download=1&id=123
    if (event.httpMethod === 'GET') {
      const q = getQuery(event);
      const isDownload = q.download === '1' || q.download === 'true';
      if (isDownload) {
        const id = parseInt(q.id, 10);
        if (!id) return json(400, { error: 'Missing or invalid id' });

        const r = await pool.query(
          `SELECT attachment_filename, attachment_mime, attachment_data
             FROM proposals
            WHERE id = $1`,
          [id]
        );

        if (r.rowCount === 0) return json(404, { error: 'Proposal not found' });

        const row = r.rows[0];
        if (!row.attachment_data || !row.attachment_mime || !row.attachment_filename) {
          return json(404, { error: 'No attachment for this proposal' });
        }

        const buf = row.attachment_data;
        return {
          statusCode: 200,
          headers: {
            ...corsHeaders(),
            'Content-Type': row.attachment_mime,
            // inline -> Browser versucht zu öffnen
            'Content-Disposition': `inline; filename="${String(row.attachment_filename).replace(/"/g, '')}"`
          },
          isBase64Encoded: true,
          body: Buffer.from(buf).toString('base64')
        };
      }

      // ---------- GET: alle Proposals (ohne attachment_data) ----------
      const res = await pool.query(
        `SELECT id, title, description, category, author, email, created_at,
                attachment_filename, attachment_mime, attachment_size, updated_at
           FROM proposals
          ORDER BY created_at DESC`
      );
      return {
        statusCode: 200,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(res.rows)
      };
    }

    // ---------- POST: neue Proposal anlegen ----------
    if (event.httpMethod === 'POST') {
      if (!event.body) return json(400, { error: 'Missing body' });

      let data;
      try {
        data = JSON.parse(event.body);
      } catch {
        return json(400, { error: 'Invalid JSON' });
      }

      const title = (data.title || '').trim();
      const desc = (data.description || data.desc || '').trim();
      const category = (data.category || '').trim();
      const author = (data.author || data.username || '').trim() || 'Usuari';
      const email = (data.email || data.user_email || '').trim().toLowerCase();

      if (!title || !desc || !category || !email) {
        return json(400, { error: 'Falten camps per crear la proposta.' });
      }

      let att = null;
      if (data.attachment) {
        try {
          att = decodeAttachment(data.attachment);
        } catch (e) {
          return json(400, { error: e.message || 'Invalid attachment' });
        }
      }

      const insertRes = await pool.query(
        `INSERT INTO proposals
           (title, description, category, author, email,
            attachment_filename, attachment_mime, attachment_size, attachment_data, updated_at)
         VALUES
           ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
         RETURNING id, title, description, category, author, email, created_at,
                   attachment_filename, attachment_mime, attachment_size, updated_at`,
        [
          title,
          desc,
          category,
          author,
          email,
          att ? att.filename : null,
          att ? att.mime : null,
          att ? att.size : null,
          att ? att.data : null
        ]
      );

      return {
        statusCode: 200,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposal: insertRes.rows[0] })
      };
    }

    // ---------- PUT: Proposal bearbeiten (nur Ersteller) ----------
    // Payload: { id, email, title, description, category, attachment?, attachmentRemove? }
    if (event.httpMethod === 'PUT') {
      if (!event.body) return json(400, { ok: false, error: 'Missing body' });

      let data;
      try {
        data = JSON.parse(event.body);
      } catch {
        return json(400, { ok: false, error: 'Invalid JSON' });
      }

      const id = parseInt(data.id, 10);
      const email = (data.email || '').trim().toLowerCase();
      if (!id || !email) {
        return json(400, { ok: false, error: 'Falten dades per editar la proposta.' });
      }

      const existingRes = await pool.query(
        `SELECT id, title, description, category, author, email, created_at,
                attachment_filename, attachment_mime, attachment_size, attachment_data
           FROM proposals
          WHERE id = $1`,
        [id]
      );

      if (existingRes.rowCount === 0) {
        return json(404, { ok: false, error: 'Proposta no trobada.' });
      }

      const existing = existingRes.rows[0];
      if (String(existing.email || '').toLowerCase() !== email) {
        return json(403, { ok: false, error: 'Només el creador pot editar aquesta proposta.' });
      }

      // Felder übernehmen / validieren
      const hasTitle = Object.prototype.hasOwnProperty.call(data, 'title');
      const hasDesc = Object.prototype.hasOwnProperty.call(data, 'description') || Object.prototype.hasOwnProperty.call(data, 'desc');
      const hasCat = Object.prototype.hasOwnProperty.call(data, 'category');

      const incomingTitle = hasTitle ? String(data.title || '').trim() : null;
      const incomingDesc = hasDesc ? String((data.description || data.desc) || '').trim() : null;
      const incomingCat = hasCat ? String(data.category || '').trim() : null;

      if (hasTitle && !incomingTitle) return json(400, { ok: false, error: 'Títol buit no permès.' });
      if (hasDesc && !incomingDesc) return json(400, { ok: false, error: 'Descripció buida no permès.' });
      if (hasCat && !incomingCat) return json(400, { ok: false, error: 'Categoria buida no permès.' });

      const newTitle = hasTitle ? incomingTitle : existing.title;
      const newDesc = hasDesc ? incomingDesc : existing.description;
      const newCat = hasCat ? incomingCat : existing.category;

      // Attachment-Logik:
      // - attachmentRemove === true => remove
      // - attachment vorhanden => replace
      // - sonst => keep
      const remove = !!data.attachmentRemove;

      let attFilename = existing.attachment_filename;
      let attMime = existing.attachment_mime;
      let attSize = existing.attachment_size;
      let attData = existing.attachment_data;

      if (remove) {
        attFilename = null;
        attMime = null;
        attSize = null;
        attData = null;
      } else if (data.attachment) {
        let att;
        try {
          att = decodeAttachment(data.attachment);
        } catch (e) {
          return json(400, { ok: false, error: e.message || 'Invalid attachment' });
        }
        attFilename = att.filename;
        attMime = att.mime;
        attSize = att.size;
        attData = att.data;
      }

      const upd = await pool.query(
        `UPDATE proposals
            SET title = $1,
                description = $2,
                category = $3,
                attachment_filename = $4,
                attachment_mime = $5,
                attachment_size = $6,
                attachment_data = $7,
                updated_at = now()
          WHERE id = $8
          RETURNING id, title, description, category, author, email, created_at,
                    attachment_filename, attachment_mime, attachment_size, updated_at`,
        [newTitle, newDesc, newCat, attFilename, attMime, attSize, attData, id]
      );

      return {
        statusCode: 200,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, proposal: upd.rows[0] })
      };
    }

    // ---------- DELETE: Proposal löschen (nur Ersteller) ----------
    if (event.httpMethod === 'DELETE') {
      if (!event.body) return json(400, { ok: false, error: 'Missing body' });

      let data;
      try {
        data = JSON.parse(event.body);
      } catch {
        return json(400, { ok: false, error: 'Invalid JSON' });
      }

      const id = parseInt(data.id, 10);
      const email = (data.email || '').trim().toLowerCase();
      if (!id || !email) {
        return json(400, { ok: false, error: 'Falten dades per esborrar la proposta.' });
      }

      const pRes = await pool.query(`SELECT id, email FROM proposals WHERE id = $1`, [id]);
      if (pRes.rowCount === 0) return json(404, { ok: false, error: 'Proposta no trobada.' });

      const proposal = pRes.rows[0];
      if (String(proposal.email || '').toLowerCase() !== email) {
        return json(403, { ok: false, error: 'Només el creador pot esborrar aquesta proposta.' });
      }

      try { await pool.query('DELETE FROM votes WHERE proposal_id = $1', [String(id)]); }
      catch (e) { console.warn('DELETE from votes failed (non-critical):', e.message || e); }

      try { await pool.query('DELETE FROM comments WHERE proposal_id = $1', [id]); }
      catch (e) { console.warn('DELETE from comments failed (non-critical):', e.message || e); }

      try { await pool.query('DELETE FROM proposal_votes WHERE proposal_id = $1', [id]); }
      catch (e) { console.warn('DELETE from proposal_votes failed (non-critical):', e.message || e); }

      await pool.query('DELETE FROM proposals WHERE id = $1', [id]);

      return {
        statusCode: 200,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true })
      };
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('Error in proposals function:', err);
    return json(500, { error: err.message || 'Internal Server Error' });
  }
};
