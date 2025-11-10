-- init.sql
-- MyRoster Database Schema - Air Macau Support (Multi-Airline Ready)
-- ✅ FIXED: All VARCHAR sizes increased to prevent "value too long" errors

-- ==================== AIRLINES TABLE ====================
CREATE TABLE IF NOT EXISTS airlines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(3) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    country VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    portal_url VARCHAR(500),
    portal_type VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
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
    
    airline_id UUID REFERENCES airlines(id) ON DELETE SET NULL,
    airline_code VARCHAR(3) DEFAULT 'NX',
    
    is_current_user BOOLEAN DEFAULT false,
    
    icrew_username VARCHAR(255),
    icrew_password_encrypted TEXT,
    icrew_credentials_updated_at TIMESTAMPTZ,
    
    reset_password_token VARCHAR(255),
    reset_password_expires BIGINT,
    
    registered_at TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT fk_user_airline FOREIGN KEY (airline_id) REFERENCES airlines(id)
);

-- ==================== UNKNOWN ROSTERS TABLE ====================
CREATE TABLE IF NOT EXISTS unknown_rosters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    staff_number VARCHAR(50),
    
    raw_text TEXT NOT NULL,
    iso_date VARCHAR(20),
    weekday VARCHAR(20),
    day_number INTEGER,
    
    detected_kind VARCHAR(50),
    detected_type VARCHAR(50),
    rule_id VARCHAR(100),
    
    app_version VARCHAR(50),
    device_model VARCHAR(100),
    ios_version VARCHAR(50),
    
    status VARCHAR(20) DEFAULT 'pending',
    resolved_at TIMESTAMPTZ,
    resolved_by VARCHAR(100),
    resolution_notes TEXT,
    
    reported_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    report_count INTEGER DEFAULT 1,
    last_reported_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== ROSTER SYNC TABLES ====================

-- ROSTER PERIODS
CREATE TABLE IF NOT EXISTS roster_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    crew_id VARCHAR(50) NOT NULL,
    period_start VARCHAR(20) NOT NULL,
    period_end VARCHAR(20) NOT NULL,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT unique_user_period UNIQUE (user_id, crew_id, period_start, period_end)
);

-- ROSTER VERSIONS
CREATE TABLE IF NOT EXISTS roster_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_id UUID NOT NULL REFERENCES roster_periods(id) ON DELETE CASCADE,
    
    version_number INTEGER NOT NULL,
    source_file_name VARCHAR(255) NOT NULL,
    source_file_size BIGINT,
    parsed_at TIMESTAMPTZ DEFAULT NOW(),
    
    name VARCHAR(255),
    flight_time VARCHAR(50),
    generated_at VARCHAR(100),
    
    json_data JSONB NOT NULL,
    
    pdf_file_path VARCHAR(500),
    
    app_version VARCHAR(50),
    device_model VARCHAR(100),
    ios_version VARCHAR(50),
    
    CONSTRAINT unique_period_version UNIQUE (period_id, version_number)
);

-- ROSTER DAYS
CREATE TABLE IF NOT EXISTS roster_days (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_id UUID NOT NULL REFERENCES roster_periods(id) ON DELETE CASCADE,
    source_version_id UUID NOT NULL REFERENCES roster_versions(id) ON DELETE CASCADE,
    
    date DATE NOT NULL,
    day_number INTEGER NOT NULL,
    weekday VARCHAR(20) NOT NULL,
    iso_date VARCHAR(20),
    
    raw_text TEXT NOT NULL,
    
    parsed_data JSONB,
    
    is_active_for_date BOOLEAN DEFAULT true,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT idx_period_date UNIQUE (period_id, date, source_version_id)
);

-- DUTY ASSIGNMENTS
CREATE TABLE IF NOT EXISTS duty_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    roster_day_id UUID NOT NULL REFERENCES roster_days(id) ON DELETE CASCADE,
    
    sequence_order INTEGER NOT NULL,
    duty_kind VARCHAR(50) NOT NULL,
    duty_type VARCHAR(100),
    rule_id VARCHAR(100) NOT NULL,
    
    check_in VARCHAR(20),
    check_in_station VARCHAR(20),
    check_in_date TIMESTAMPTZ,
    check_out VARCHAR(20),
    check_out_station VARCHAR(20),
    check_out_date TIMESTAMPTZ,
    
    is_instructor_duty BOOLEAN,
    learning_title VARCHAR(255),
    
    notes JSONB DEFAULT '[]'::jsonb,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- SECTORS
CREATE TABLE IF NOT EXISTS sectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    duty_assignment_id UUID NOT NULL REFERENCES duty_assignments(id) ON DELETE CASCADE,
    
    flight_number VARCHAR(20) NOT NULL,
    dep_iata VARCHAR(3) NOT NULL,
    arr_iata VARCHAR(3) NOT NULL,
    dep_time VARCHAR(20) NOT NULL,
    arr_time VARCHAR(20) NOT NULL,
    aircraft VARCHAR(20),
    
    dep_time_dt TIMESTAMPTZ,
    arr_time_dt TIMESTAMPTZ,
    
    kind_training_duty VARCHAR(50) DEFAULT 'none',
    
    cockpit_crew JSONB DEFAULT '[]'::jsonb,
    cabin_crew JSONB DEFAULT '[]'::jsonb,
    
    dep_time_is_local BOOLEAN DEFAULT false,
    arr_time_is_local BOOLEAN DEFAULT false,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- SYNC METADATA
CREATE TABLE IF NOT EXISTS roster_sync_metadata (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    period_id UUID REFERENCES roster_periods(id) ON DELETE CASCADE,
    
    last_sync_at TIMESTAMPTZ DEFAULT NOW(),
    sync_status VARCHAR(20) DEFAULT 'success',
    sync_direction VARCHAR(10) NOT NULL,
    
    conflict_detected BOOLEAN DEFAULT false,
    conflict_resolved BOOLEAN DEFAULT false,
    conflict_resolution_strategy VARCHAR(50),
    
    days_synced INTEGER,
    bytes_transferred BIGINT,
    
    error_message TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== INDEXES ====================
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_staff_number ON users(staff_number);
CREATE INDEX IF NOT EXISTS idx_users_airline ON users(airline_id);
CREATE INDEX IF NOT EXISTS idx_airlines_code ON airlines(code);
CREATE INDEX IF NOT EXISTS idx_airlines_active ON airlines(is_active);

CREATE INDEX IF NOT EXISTS idx_unknown_rosters_user_id ON unknown_rosters(user_id);
CREATE INDEX IF NOT EXISTS idx_unknown_rosters_status ON unknown_rosters(status);
CREATE INDEX IF NOT EXISTS idx_unknown_rosters_reported_at ON unknown_rosters(reported_at);
CREATE INDEX IF NOT EXISTS idx_unknown_rosters_iso_date ON unknown_rosters(iso_date);
CREATE INDEX IF NOT EXISTS idx_unknown_rosters_raw_text_hash ON unknown_rosters(md5(raw_text));

CREATE INDEX IF NOT EXISTS idx_roster_periods_user ON roster_periods(user_id);
CREATE INDEX IF NOT EXISTS idx_roster_periods_dates ON roster_periods(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_roster_versions_period ON roster_versions(period_id);
CREATE INDEX IF NOT EXISTS idx_roster_versions_parsed_at ON roster_versions(parsed_at DESC);
CREATE INDEX IF NOT EXISTS idx_roster_days_period ON roster_days(period_id);
CREATE INDEX IF NOT EXISTS idx_roster_days_date ON roster_days(date);
CREATE INDEX IF NOT EXISTS idx_roster_days_active ON roster_days(is_active_for_date);
CREATE INDEX IF NOT EXISTS idx_roster_days_version ON roster_days(source_version_id);
CREATE INDEX IF NOT EXISTS idx_duty_assignments_day ON duty_assignments(roster_day_id);
CREATE INDEX IF NOT EXISTS idx_duty_assignments_kind ON duty_assignments(duty_kind);
CREATE INDEX IF NOT EXISTS idx_sectors_duty ON sectors(duty_assignment_id);
CREATE INDEX IF NOT EXISTS idx_sectors_flight ON sectors(flight_number);
CREATE INDEX IF NOT EXISTS idx_sectors_route ON sectors(dep_iata, arr_iata);
CREATE INDEX IF NOT EXISTS idx_sectors_times ON sectors(dep_time_dt, arr_time_dt);
CREATE INDEX IF NOT EXISTS idx_sync_metadata_user ON roster_sync_metadata(user_id);
CREATE INDEX IF NOT EXISTS idx_sync_metadata_period ON roster_sync_metadata(period_id);
CREATE INDEX IF NOT EXISTS idx_sync_metadata_time ON roster_sync_metadata(last_sync_at DESC);

-- ==================== INSERT AIR MACAU ====================
INSERT INTO airlines (code, name, country, is_active, portal_url, portal_type)
VALUES 
    ('NX', 'Air Macau', 'Macau SAR', true, 'https://icrew.airmacau.com.mo', 'icrew')
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    is_active = EXCLUDED.is_active,
    portal_url = EXCLUDED.portal_url,
    portal_type = EXCLUDED.portal_type;

-- ==================== TRIGGERS ====================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = TG_TABLE_NAME
          AND column_name = 'updated_at'
    ) THEN
        NEW.updated_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_airlines_updated_at BEFORE UPDATE ON airlines
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_unknown_rosters_updated_at BEFORE UPDATE ON unknown_rosters
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_roster_periods_updated_at BEFORE UPDATE ON roster_periods
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_roster_days_updated_at BEFORE UPDATE ON roster_days
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==================== VIEWS ====================
CREATE OR REPLACE VIEW roster_changes_summary AS
SELECT 
    rd.period_id,
    rd.date,
    COUNT(DISTINCT rd.source_version_id) as version_count,
    MAX(rd.updated_at) as latest_update,
    BOOL_OR(rd.is_active_for_date) as has_active_version
FROM roster_days rd
GROUP BY rd.period_id, rd.date
HAVING COUNT(DISTINCT rd.source_version_id) > 1;

-- ==================== COMMENTS ====================
COMMENT ON TABLE roster_periods IS 'Master container for roster periods';
COMMENT ON TABLE roster_versions IS 'Each PDF parse creates a new version with full JSON payload';
COMMENT ON TABLE roster_days IS 'Individual calendar days with version tracking';
COMMENT ON TABLE duty_assignments IS 'Duty assignments within a roster day';
COMMENT ON TABLE sectors IS 'Individual flight sectors within a duty assignment';
COMMENT ON TABLE roster_sync_metadata IS 'Tracks synchronization operations';

COMMENT ON COLUMN roster_days.is_active_for_date IS 'Current active version for this date';
COMMENT ON COLUMN roster_days.date IS 'Stored in UTC for consistency';
COMMENT ON COLUMN duty_assignments.check_in_date IS 'UTC timestamp';
COMMENT ON COLUMN duty_assignments.check_out_date IS 'UTC timestamp';
COMMENT ON COLUMN sectors.dep_time_dt IS 'UTC timestamp';
COMMENT ON COLUMN sectors.arr_time_dt IS 'UTC timestamp';