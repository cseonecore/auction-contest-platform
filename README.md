# Bid2Build – Auction Contest Platform

Web-based App Development Auction Contest platform for team registration, live bidding, submissions, and AI-powered evaluation.

## Overview

Bid2Build is a platform developed for managing an app development auction contest. Teams register, participate in topic auctions, develop applications within the allotted time, and submit their projects for evaluation.

## Tech Stack

| Technology | Purpose |
|---|---|
| Next.js | Web application |
| React | UI development |
| Tailwind CSS | Styling |
| shadcn/ui | UI components |
| Supabase PostgreSQL | Database |
| Supabase Auth | Authentication |
| Supabase Realtime | Live updates |
| Supabase Storage | File storage |
| Vercel | Deployment |
| Python | AI evaluation service |

## Project Structure

```text
auction-contest-platform/
├── app/
│   ├── app/                 # Next.js App Router
│   │   ├── register/         # Registration
│   │   ├── auction/          # Auction
│   │   ├── submit/           # Submission
│   │   ├── profile/          # Profile
│   │   └── admin/            # Admin
│   ├── components/
│   │   ├── ui/               # Shared UI components
│   │   └── shared/            # Reusable components
│   ├── features/
│   │   ├── registration/
│   │   ├── auction/
│   │   ├── submission/
│   │   ├── profile/
│   │   └── admin/
│   ├── lib/
│   │   └── supabase.ts
│   ├── types/
│   └── public/
│
├── supabase/
│   ├── migrations/
│   └── config.toml
│
└── README.md
```

## Module Ownership

| Developer | Module |
|---|---|
| Anush | Auction |
| Abhiram | Registration & Profile |
| Akash N | Submission |
| Darshan R | Admin |

UI designs will be provided through Figma by Anush. Developers will implement their respective modules based on the finalized designs.

## Local Development

### Prerequisites
- Node.js
- npm
- Git

### Setup

```bash
git clone https://github.com/cseonecore/auction-contest-platform.git
cd auction-contest-platform/app
npm install
```

Create an `.env.local` file inside `app/`:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

Run the development server:

```bash
npm run dev
```

Open http://localhost:3000

## Supabase

The project uses Supabase for:
- PostgreSQL database
- Authentication
- Realtime updates
- Storage
- Database functions
- Row Level Security

Database migrations are maintained in `supabase/migrations/`.

## Development Workflow

1. Clone the repository.
2. Create a feature branch.
3. Implement your assigned module.
4. Test locally.
5. Commit and push your branch.
6. Create a Pull Request.
7. Review and merge into `main`.

## Current Development Status

### Completed
- Next.js application initialized.
- Supabase project configured.
- Database schema and migrations applied.
- RLS enabled and baseline policies created.
- Initial `place_bid` database function implemented.
- GitHub repository and Vercel deployment configured.
- Project folder structure organized.
- Developer module ownership established.

### Pending
- Registration and profile implementation.
- Auction interface and integration.
- Submission module.
- Admin dashboard.
- Authentication and authorization integration.
- RLS policy testing and security review.
- Auction function testing.
- AI evaluation service implementation.
- End-to-end integration and testing.

## Repository

GitHub: https://github.com/cseonecore/auction-contest-platform

Live Deployment: https://bid2build-cse.vercel.app/

---

**Project:** Bid2Build  
**Team:** CSEONECORE
