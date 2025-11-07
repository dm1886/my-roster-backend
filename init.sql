-- init.sql
-- MyRoster Database Schema - Air Macau Support (Multi-Airline Ready)

-- ==================== AIRLINES TABLE ====================
CREATE TABLE IF NOT EXISTS airlines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(3) NOT NULL UNIQUE,  -- IATA code: "NX"
    name VARCHAR(255) NOT NULL,        -- "Air Macau"
    country VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    portal_url VARCHAR(500),           -- URL to airline's crew portal
    portal_type VARCHAR(50),           -- "icrew"
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ==================== USERS TABLE ====================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_number VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    rank VARCHAR(100),
    
    -- 🆕 AIRLINE ASSOCIATION (defaults to Air Macau for now)
    airline_id UUID REFERENCES airlines(id) ON DELETE SET NULL,
    airline_code VARCHAR(3) DEFAULT 'NX',  -- Default to Air Macau
    
    -- App user flag
    is_current_user BOOLEAN DEFAULT false,
    
    -- Portal credentials (encrypted)
    icrew_username VARCHAR(255),
    icrew_password_encrypted TEXT,
    icrew_credentials_updated_at TIMESTAMP,
    
    -- Password reset
    reset_password_token VARCHAR(255),
    reset_password_expires BIGINT,
    
    -- Timestamps
    registered_at TIMESTAMP DEFAULT NOW(),
    last_login_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT fk_user_airline FOREIGN KEY (airline_id) REFERENCES airlines(id)
);

-- ==================== 🆕 UNKNOWN ROSTERS TABLE ====================
CREATE TABLE IF NOT EXISTS unknown_rosters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- User who reported this unknown roster
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    staff_number VARCHAR(50),
    
    -- Raw roster data
    raw_text TEXT NOT NULL,
    iso_date VARCHAR(10),              -- "YYYY-MM-DD"
    weekday VARCHAR(10),               -- "Mon", "Tue", etc.
    day_number INTEGER,                -- 1-31
    
    -- Parser context
    detected_kind VARCHAR(50),         -- "unknown", "flight", etc.
    detected_type VARCHAR(50),         -- "Unknown", etc.
    rule_id VARCHAR(100),              -- "detector.unknown.v1"
    
    -- App & device info
    app_version VARCHAR(50),
    device_model VARCHAR(100),
    ios_version VARCHAR(50),
    
    -- Status tracking
    status VARCHAR(20) DEFAULT 'pending',  -- 'pending', 'resolved', 'ignored'
    resolved_at TIMESTAMP,
    resolved_by VARCHAR(100),
    resolution_notes TEXT,
    
    -- Metadata
    reported_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Count duplicate reports
    report_count INTEGER DEFAULT 1,
    last_reported_at TIMESTAMP DEFAULT NOW()
);

-- ==================== INDEXES ====================
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_staff_number ON users(staff_number);
CREATE INDEX IF NOT EXISTS idx_users_airline ON users(airline_id);
CREATE INDEX IF NOT EXISTS idx_airlines_code ON airlines(code);
CREATE INDEX IF NOT EXISTS idx_airlines_active ON airlines(is_active);

-- 🆕 NEW: Unknown rosters indexes
CREATE INDEX IF NOT EXISTS idx_unknown_rosters_user_id ON unknown_rosters(user_id);
CREATE INDEX IF NOT EXISTS idx_unknown_rosters_status ON unknown_rosters(status);
CREATE INDEX IF NOT EXISTS idx_unknown_rosters_reported_at ON unknown_rosters(reported_at);
CREATE INDEX IF NOT EXISTS idx_unknown_rosters_iso_date ON unknown_rosters(iso_date);
CREATE INDEX IF NOT EXISTS idx_unknown_rosters_raw_text_hash ON unknown_rosters(md5(raw_text));

-- ==================== INSERT AIR MACAU (Only Active Airline) ====================
INSERT INTO airlines (code, name, country, is_active, portal_url, portal_type)
VALUES 
    ('NX', 'Air Macau', 'Macau SAR', true, 'https://icrew.airmacau.com.mo', 'icrew')
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    is_active = EXCLUDED.is_active,
    portal_url = EXCLUDED.portal_url,
    portal_type = EXCLUDED.portal_type;

-- ==================== UPDATED_AT TRIGGER ====================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_airlines_updated_at BEFORE UPDATE ON airlines
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 🆕 NEW: Unknown rosters trigger
CREATE TRIGGER update_unknown_rosters_updated_at BEFORE UPDATE ON unknown_rosters
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
