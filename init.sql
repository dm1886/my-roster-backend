-- init.sql
-- Auto-creates tables on first PostgreSQL startup

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Main users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_number VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    rank VARCHAR(50),
    is_current_user BOOLEAN DEFAULT FALSE,
    registered_at TIMESTAMP DEFAULT NOW(),
    last_login_at TIMESTAMP DEFAULT NOW(),
    
    -- Password Reset Fields
    reset_password_token VARCHAR(255),
    reset_password_expires BIGINT,
    
    -- iCrew Credentials (encrypted)
    icrew_username VARCHAR(255),
    icrew_password_encrypted TEXT,
    icrew_credentials_updated_at TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_staff_number ON users(staff_number);
CREATE INDEX IF NOT EXISTS idx_users_is_current ON users(is_current_user) WHERE is_current_user = true;
CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_password_token) WHERE reset_password_token IS NOT NULL;

-- Ensure only ONE user can be current
CREATE UNIQUE INDEX IF NOT EXISTS idx_only_one_current_user 
ON users(is_current_user) WHERE is_current_user = true;

-- Auto-update timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();