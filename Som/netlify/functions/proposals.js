// netlify/functions/proposals.js

// Variante mit "pg" (klassischer Postgres-Client).
// Nutzt die von Netlify/Neon gesetzten Connection-Strings:
//  - DATABASE_URL (falls manuell gesetzt)
//  - Database_URL (so taucht sie im Netlify-Log auf)
//  - NETLIFY_DATABASE_URL
//  - NETLIFY_DATABASE_URL_UNPOOLED

const { Pool } = require('pg');

// Connection-String aus den verfügbaren Umgebungsvariablen ermitteln
const connectionString =
  process.env.DATABASE_URL ||
  process.env.Database_URL ||
  process.env.NETLIFY_DATABASE_URL ||
  process.env.NETLIFY_DATABASE_URL_UNPOOLED;

if (!connectionString) {
  console.error(
    'Keine Datenbank-URL gefunden! Bitte eine der Variablen setzen: ' +
    'DATABASE_URL, Database_URL, NETLIFY_DATABASE_URL oder NETLIFY_DATABASE_URL_UNPOOLED.'
  );
}

// Connection-Pool nur einmal erzeugen
const pool = new Pool({
  connectionString,
  // für Neon/Netlify meist erforderlich
  ssl: { rejectUnauthorized: false }
});

exports.handler = async (event, context) => {
  try {
    // CORS (optional etwas großzügig)
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: ''
      };
    }

    if (event.httpMethod === 'GET') {
      // Alle Proposals holen (optional: nach Kategorie / E-Mail filtern)
      const category = event.queryStringParameters?.category || null;
      const email = event.queryStringParameters?.email || null;

      let sql =
        'SELECT id, title, description, category, email, author, created_at FROM proposals';
      const values = [];
      const where = [];

      if (category) {
        values.push(category);
        where.push(`category = $${values.length}`);
      }
      if (email) {
        values.push(email);
        where.push(`email = $${values.length}`);
      }
      if (where.length > 0) {
        sql += ' WHERE ' + where.join(' AND ');
      }
      sql += ' ORDER BY created_at DESC';

      const { rows } = await pool.query(sql, values);

      return {
        statusCode: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(rows)
      };
    }

    if (event.httpMethod === 'POST') {
      if (!event.body) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Missing request body' })
        };
      }

      let data;
      try {
        data = JSON.parse(event.body);
      } catch (e) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Invalid JSON body' })
        };
      }

      const title = (data.title || '').trim();
      const description = (data.description || '').trim();
      const category = (data.category || '').trim();
      const email = (data.email || '').trim();
      const author = (data.author || '').trim();

      if (!title || !category) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'title i category són obligatoris' })
        };
      }

      const insertSql = `
        INSERT INTO proposals (title, description, category, email, author)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, title, description, category, email, author, created_at;
      `;
      const values = [title, description, category, email, author];

      const { rows } = await pool.query(insertSql, values);
      const proposal = rows[0];

      return {
        statusCode: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(proposal)
      };
    }

    // Andere Methoden nicht erlaubt
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  } catch (err) {
    console.error('Error in proposals function:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Internal Server Error' })
    };
  }
};
