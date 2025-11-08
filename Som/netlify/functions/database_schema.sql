-- Taula d'usuaris amb gestió completa
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    is_admin BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    requires_password_change BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    last_login TIMESTAMP,
    created_by INTEGER REFERENCES users(id)
);

-- Taula de tokens per reset de password
CREATE TABLE password_reset_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Taula de propostes
CREATE TABLE proposals (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(100) NOT NULL,
    author_id INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Taula de comentaris
CREATE TABLE comments (
    id SERIAL PRIMARY KEY,
    proposal_id INTEGER REFERENCES proposals(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    text TEXT NOT NULL,
    likes INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Taula de likes de comentaris
CREATE TABLE comment_likes (
    comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
    user_email VARCHAR(255) NOT NULL,
    PRIMARY KEY (comment_id, user_email)
);

-- Taula de vots
CREATE TABLE votes (
    user_id INTEGER REFERENCES users(id),
    proposal_id INTEGER REFERENCES proposals(id) ON DELETE CASCADE,
    points INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, proposal_id)
);

-- Taula de satisfacció per categories
CREATE TABLE satisfaction (
    user_id INTEGER REFERENCES users(id),
    category VARCHAR(100) NOT NULL,
    value INTEGER NOT NULL CHECK (value >= 0 AND value <= 100),
    updated_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, category)
);

-- Crear usuari admin
-- Email: duborg@gmx.de
-- Password: Admin123! (CANVIAR IMMEDIATAMENT al primer login!)
INSERT INTO users (username, email, password, is_admin, requires_password_change)
VALUES (
    'duborg',
    'duborg@gmx.de',
    '$2a$10$YpZ8qN5rL3xM2wK9vB7HuO8tR6sP4nQ1mA3jF5kD7hL9oC2eU6wV',
    TRUE,
    TRUE
);

-- Propostes inicials per Matadepera
INSERT INTO proposals (title, description, category, author_id) VALUES
('Reducció del Trànsit', 'Reducció del volum de trànsit al centre de Matadepera mitjançant la construcció de vies de circumval·lació.', 'vida_quotidiana', NULL),
('Embelliment del Poble', 'Definició d''estàndards estètics elevats. Fer complir les normes existents davant la negligència i el vandalisme. Prohibició de cartells publicitaris, rètols, etc. Tolerància zero amb els grafitis.', 'estat_poble', NULL),
('Fluïdesa del Trànsit', 'Límits de velocitat uniformes. Eliminació de senyals de stop a les vies principals. Eliminació de ressalts al paviment.', 'vida_quotidiana', NULL),
('Obertura del Parc Can Vinyers', 'Obertura immediata del parc. Les millores es poden dur a terme posteriorment.', 'entorn_natural', NULL);

-- Índexs per millor rendiment
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX idx_proposals_author ON proposals(author_id);
CREATE INDEX idx_votes_user ON votes(user_id);
CREATE INDEX idx_votes_proposal ON votes(proposal_id);