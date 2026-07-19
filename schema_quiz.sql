-- 1. Create the questions table
CREATE TABLE IF NOT EXISTS questions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    day_number INTEGER NOT NULL,
    question_text TEXT NOT NULL,
    options JSONB NOT NULL,
    correct_option_index INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Create the user_quiz_progress table
CREATE TABLE IF NOT EXISTS user_quiz_progress (
    chat_id BIGINT PRIMARY KEY,
    current_day INTEGER DEFAULT 1,
    current_question_index INTEGER DEFAULT 0,
    last_completed_at TIMESTAMP WITH TIME ZONE,
    is_completed BOOLEAN DEFAULT false,
    joined_channel BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Disable RLS
ALTER TABLE questions DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_quiz_progress DISABLE ROW LEVEL SECURITY;
