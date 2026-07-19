-- Craftopia Registrations Schema (Updated with Admin Table)
-- Copy and paste this script into your Supabase SQL Editor (https://supabase.com/dashboard/project/gmvzwakcouuwvbapjtso/sql) and click "Run".

-- 1. Create the registrations table (or update it if it already exists)
CREATE TABLE IF NOT EXISTS registrations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    chat_id BIGINT NOT NULL,
    name TEXT,
    phone TEXT,
    receipt_number TEXT,
    receipt_image_url TEXT,
    payment_method TEXT,
    status TEXT DEFAULT 'pending',
    step TEXT DEFAULT 'start',
    invite_link TEXT,
    rejection_reason TEXT,
    referred_by_chat_id BIGINT,
    referral_paid BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Ensure correct columns are added if the table already existed
ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_chat_id_key;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS referred_by_chat_id BIGINT;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS referral_paid BOOLEAN DEFAULT false;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS receipt_image_url TEXT;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;

-- 2. Create the admins table
CREATE TABLE IF NOT EXISTS admins (
    username TEXT PRIMARY KEY,
    password TEXT NOT NULL,
    telegram_chat_id BIGINT,
    verification_code TEXT,
    code_expires_at TIMESTAMP WITH TIME ZONE
);

-- 3. Pre-populate default admin credentials (username: admin, password: admin123)
-- This allows you to bootstrap the system and log in.
INSERT INTO admins (username, password) 
VALUES ('admin', 'admin123') 
ON CONFLICT (username) DO NOTHING;

-- 4. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_registrations_chat_id ON registrations(chat_id);
CREATE INDEX IF NOT EXISTS idx_registrations_status ON registrations(status);
CREATE INDEX IF NOT EXISTS idx_registrations_referred_by ON registrations(referred_by_chat_id);

-- 5. Disable Row Level Security (RLS) on these tables 
-- This allows our Vercel Python backend to query and insert data using the publishable/anon key.
ALTER TABLE registrations DISABLE ROW LEVEL SECURITY;
ALTER TABLE admins DISABLE ROW LEVEL SECURITY;

-- 6. Create the languages table
CREATE TABLE IF NOT EXISTS languages (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 7. Create the translations table
CREATE TABLE IF NOT EXISTS translations (
    lang_code TEXT NOT NULL REFERENCES languages(code) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (lang_code, key)
);

-- 8. Seed default languages
INSERT INTO languages (code, name) VALUES ('en', 'English') ON CONFLICT (code) DO NOTHING;
INSERT INTO languages (code, name) VALUES ('am', 'አማርኛ') ON CONFLICT (code) DO NOTHING;

-- Disable RLS on the new tables to allow REST API access
ALTER TABLE languages DISABLE ROW LEVEL SECURITY;
ALTER TABLE translations DISABLE ROW LEVEL SECURITY;

