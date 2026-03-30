# AI Policy Audit Tool v2

AI-powered commercial insurance policy analysis with database, compliance audit trail, and validation workflow.

**URL:** audit.theaiinsurancegroup.com

---

## What It Does

Upload client insurance policy PDFs and get AI-powered analysis identifying AI-related exclusions, silent gaps, sublimits, and definition changes — with a full compliance trail.

### Key Features

- **Persistent database** — All audits stored in Supabase (PostgreSQL), accessible from any device
- **Validation workflow** — Draft → Validated pipeline; every finding must be Confirmed, Rejected, or Modified by a named validator before the report is finalized
- **Audit trail** — Every action logged with timestamp and actor name (AUDIT_CREATED, POLICY_ANALYZED, FINDING_CONFIRMED, FINDING_REJECTED, etc.)
- **Client consent** — Authorization captured with typed signature, statement, and timestamp before any analysis runs
- **Soft delete** — Audits are archived, never destroyed (compliance retention)
- **Export/backup** — One-click JSON export of all audits, policies, and activity logs
- **Shared access** — Multiple users can log in simultaneously; all see the same data

---

## Deployment Steps

### Step 1: Create Supabase Project (free, 5 minutes)

1. Go to https://supabase.com and create an account
2. Click **New Project**
3. Choose a name (e.g., "ai-audit-tool") and set a database password
4. Wait for the project to provision (~1 minute)
5. Go to **Settings → API** and copy:
   - **Project URL** (looks like `https://xxxxx.supabase.co`)
   - **anon / public key** (starts with `eyJ...`)

### Step 2: Run the Database Schema

1. In Supabase, go to **SQL Editor**
2. Click **New Query**
3. Paste the ENTIRE contents of `supabase-setup.sql` from this project
4. Click **Run**
5. You should see "Success" — three tables created (audits, audit_policies, activity_log)

### Step 3: Get Anthropic API Key (5 minutes)

1. Go to https://console.anthropic.com
2. Create account / sign in
3. Settings → API Keys → Create Key
4. Copy the key (starts with `sk-ant-...`)
5. Add a payment method (pay-as-you-go, ~$0.50-2.00 per policy analyzed)

### Step 4: Create GitHub Repository

1. Go to https://github.com/new
2. Name: `ai-policy-audit-tool` — set to **Private**
3. Upload all files from this project

### Step 5: Deploy on Vercel

1. Go to https://vercel.com/dashboard → **Add New → Project**
2. Import `ai-policy-audit-tool` from GitHub
3. Framework: **Vite**
4. Add THREE environment variables:
   - `ANTHROPIC_API_KEY` = your `sk-ant-...` key
   - `VITE_SUPABASE_URL` = your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` = your Supabase anon key
5. Click **Deploy**

### Step 6: Add Custom Domain

**In Vercel:**
1. Project → Settings → Domains → Add `audit.theaiinsurancegroup.com`

**In GoDaddy:**
1. DNS Management for theaiinsurancegroup.com
2. Add CNAME record:
   - Name: `audit`
   - Value: `cname.vercel-dns.com`
   - TTL: 600

### Step 7: Test

1. Go to audit.theaiinsurancegroup.com
2. Log in with: `AuditTool2026!`
3. Set your validator name when prompted
4. Create a new audit with a test PDF
5. Verify the analysis runs, findings appear, and validation buttons work

---

## Compliance Features

### Audit Trail
Every action is logged to the `activity_log` table with timestamp, actor name, and details. Actions tracked:
- AUDIT_CREATED, CONSENT_RECORDED, POLICY_ANALYZED
- FINDING_CONFIRMED, FINDING_REJECTED, FINDING_MODIFIED
- GAP_CONFIRMED, GAP_REJECTED
- AUDIT_VALIDATED, AUDIT_ARCHIVED, DATA_EXPORTED

### Validation Workflow
1. AI generates draft analysis (status: DRAFT)
2. Validator reviews each finding: Confirm ✓ / Reject ✗ / Modify ✏
3. Validator reviews each coverage gap: Confirm ✓ / Reject ✗
4. When all items reviewed → Finalize button appears
5. Report status changes to VALIDATED with validator name and timestamp
6. Only validated reports can be printed for client delivery

### Client Consent
Before any policy is uploaded, the tool captures:
- Authorizing person's full name (typed signature)
- Company name
- Consent checkbox confirming authorization
- Full consent statement text
- Timestamp

### Data Retention
- Audits are soft-deleted (hidden but never destroyed)
- AI raw output is preserved separately from validated output
- The original AI analysis is NEVER modified — only the validated copy is edited

### Backup
- Click "Export Backup" on the dashboard for a full JSON dump
- Supabase also provides automatic database backups on paid plans

---

## Changing the Password

In `src/App.jsx`, find:
```
const ACCESS_CODE = 'AuditTool2026!';
```
Change it, commit, and Vercel auto-deploys.

---

## Cost

- **Supabase:** Free tier (500MB, more than enough for thousands of audits)
- **Claude API:** ~$0.50-2.00 per policy, ~$5-10 per full 6-policy audit
- **Vercel:** Free tier for hosting

---

## File Structure

```
ai-policy-audit-tool/
├── api/
│   └── analyze.js              ← Serverless function (API key stays server-side)
├── src/
│   ├── main.jsx                ← React entry
│   ├── supabase.js             ← Supabase client init
│   └── App.jsx                 ← Full application
├── supabase-setup.sql          ← Database schema (run once in Supabase SQL Editor)
├── index.html
├── package.json
├── vite.config.js
├── vercel.json
├── .env.example
├── .gitignore
└── README.md
```
