-- PostgreSQL Initialization Script for Uptime Kuma Multi-Tenancy
-- This script runs on first database initialization

-- Enable useful extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- For fuzzy text search

-- Create additional indexes for performance (will be created by migrations)
-- This is just a placeholder for any pre-migration setup

-- Grant privileges (in case we use separate app user later)
-- GRANT ALL PRIVILEGES ON DATABASE uptime_kuma TO kuma;

-- Log successful initialization
DO $$
BEGIN
    RAISE NOTICE 'Uptime Kuma PostgreSQL initialization complete';
END $$;
