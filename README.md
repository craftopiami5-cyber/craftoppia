# Craftopia Bot & Dashboard

This repository contains the backend and frontend for the Craftopia project, including a Telegram bot integrations, registration system, admin dashboard, and database connection.

The application is fully configured for deployment on **Vercel** as a Serverless Python and HTML application.

## Project Structure
- `/api/index.py` - Core Flask API backend.
- `/api/db.py` - Database helper functions connected to Supabase.
- `/api/messages.py` - Messages and telegram message structures.
- `/index.html` - Main landing page.
- `/dashboard.html` - Admin dashboard.
- `vercel.json` - Vercel routing and serverless function rewrite rules.

---

## Deployment Options

### Option 1: GitHub & Vercel Integration (Recommended)
This is the easiest and most automated deployment path.

1. Go to [Vercel](https://vercel.com) and log in.
2. Click **Add New...** -> **Project**.
3. Select your GitHub repository: `kidanewold1/craft`.
4. Leave the Build and Output settings as default (Vercel automatically detects the configuration from `vercel.json`).
5. Expand the **Environment Variables** section and add the keys from your `.env.example`:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHANNEL_ID`
   - `ADMIN_CHAT_ID`
   - `SUPABASE_URL`
   - `SUPABASE_KEY`
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD`
   - `JWT_SECRET`
6. Click **Deploy**. Vercel will build and host your application, and automatically redeploy on every code push to `main`!

### Option 2: Deploy via Vercel CLI (Command Line)
If you prefer to deploy from your terminal:

1. Open your terminal in the project directory.
2. Log in to Vercel:
   ```bash
   npx vercel login
   ```
3. Initialize and deploy:
   ```bash
   npx vercel
   ```
   Follow the prompts to link the project.
4. Set the environment variables in your Vercel project dashboard or via CLI using:
   ```bash
   npx vercel env add [NAME] [VALUE]
   ```
5. Deploy to production:
   ```bash
   npx vercel --prod
   ```

---

## Local Setup
To run or test the project locally:

1. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```
2. Create a `.env` file from the `.env.example` file and populate your tokens and credentials.
3. Run the application:
   ```bash
   python api/index.py
   ```
