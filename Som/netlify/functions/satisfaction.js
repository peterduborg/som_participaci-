// netlify/functions/satisfaction.js

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

exports.handler = async (event, context) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS'
  };

  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Method not allowed' })
      };
    }

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
    } catch {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid JSON body' })
      };
    }

    const action = data.action;

    // ---- getAverages ----
    if (action === 'getAverages') {
      const sql = `
        SELECT category, AVG(value)::float AS avg_value
        FROM satisfaction
        GROUP BY category
      `;
      const { rows } = await pool.query(sql);

      const averages = {};
      rows.forEach(r => {
        averages[r.category] = r.avg_value;
      });

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ averages })
      };
    }

    // ---- getUserRatings ----
    if (action === 'getUserRatings') {
      const email = (data.email || '').trim().toLowerCase();
      if (!email) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'email is required for getUserRatings' })
        };
      }

      const sql = `
        SELECT category, value
        FROM satisfaction
        WHERE email = $1
      `;
      const { rows } = await pool.query(sql, [email]);

      const ratings = {};
      rows.forEach(r => {
        ratings[r.category] = r.value;
      });

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ratings })
      };
    }

    // ---- saveRating ----
    if (action === 'saveRating') {
      const email = (data.email || '').trim().toLowerCase();
      const category = (data.category || '').trim();
      let value = Number(data.value);

      if (!email || !category || !Number.isFinite(value)) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            error: 'email, category i value són obligatoris'
          })
        };
      }

      if (value < 0) value = 0;
      if (value > 100) value = 100;

      const sql = `
        INSERT INTO satisfaction (email, category, value)
        VALUES ($1, $2, $3)
        ON CONFLICT (email, category)
        DO UPDATE SET value = EXCLUDED.value, updated_at = now()
        RETURNING id, email, category, value, updated_at;
      `;
      const values = [email, category, value];

      const { rows } = await pool.query(sql, values);
      const row = rows[0];

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: row })
      };
    }

    // ---- unbekannte Action ----
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Unknown action' })
    };

  } catch (err) {
    console.error('Error in satisfaction function:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Internal Server Error' })
    };
  }
};
