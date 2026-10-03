# Shop Manager — Inventory + POS + Purchases + Seller + Reporting System

A production-quality inventory, point-of-sale, purchasing, and reporting
system built with React + Vite + Tailwind (frontend), Node.js + Express
(backend), and MongoDB + Mongoose.

## Stack

- **Frontend:** React 19, Vite, Tailwind CSS v4, React Router, Recharts, Axios
- **Backend:** Node.js, Express, Mongoose, JWT auth (jsonwebtoken + bcryptjs)
- **Database:** MongoDB

## Getting Started

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env    # edit MONGO_URI / JWT_SECRET if needed
npm run seed             # creates a local dev admin user + sample inventory
npm run dev               # starts the API on http://localhost:5010
```

Seeded login (local dev only, via `npm run seed`): **admin / admin123**

For a real deployment, use `npm run seed:admin` instead (see "Production
deployment" below) -- it never uses a hardcoded password.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev               # starts the app on http://localhost:5173
```

In development the frontend talks to the API directly at the URL in
`frontend/.env.development` (`VITE_API_URL`, defaults to
`http://localhost:5010/api`); the Vite dev server's `/api` proxy (also
pointed at port 5010) is kept as a fallback for tooling that relies on it.

### 3. Production build

```bash
cd frontend
npm run build              # outputs static files to frontend/dist
```

`frontend/.env.production` sets `VITE_API_URL=https://inventory.elivateict.com/api`
at build time -- update it if you deploy to a different domain. Serve
`frontend/dist` as static files behind Nginx (or any reverse proxy) on the
public domain, and proxy `/api/` on that same domain to the backend:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:5010;
}
```

The backend itself listens on `0.0.0.0:5010` (see `PORT` in the backend
`.env`) and is never exposed to the public internet directly -- only via the
reverse proxy on the same public domain. Set `CLIENT_ORIGIN` in the backend
`.env` to a comma-separated list of the origins allowed to call the API
(your deployed frontend origin, plus `http://localhost:5173` for local dev
against a shared backend).

### 4. Production admin account

```bash
cd backend
# set SEED_ADMIN_USERNAME / SEED_ADMIN_NAME / SEED_ADMIN_PASSWORD in .env first
npm run seed:admin
```

This creates exactly one admin user from environment variables (never a
hardcoded password), and safely no-ops if that username already exists.

## Architecture notes

- **Money** is stored as integer cents (`*Cents` fields) throughout the
  database to avoid floating-point accounting bugs. The API converts to/from
  decimal dollars at the boundary.
- **Sale/Purchase atomicity**: `backend/src/utils/transaction.js` wraps the
  sale and purchase creation/void flows in a MongoDB session transaction,
  falling back to sequential (non-transactional) execution if the server is
  a standalone instance without replica-set support. For true atomicity in
  production, deploy MongoDB as a replica set (MongoDB Atlas does this by
  default).
- **Historical cost/profit**: every sale line stores the item's cost price
  *at the time of sale*, so profit reports remain accurate even after an
  item's current cost price changes later.
- **Customer search UX**: the POS never uses a customer dropdown. The seller
  types a name, matching customers appear live (debounced), and if none
  match, a customer can be created inline without leaving the sale.
- **Stock validation** happens server-side on every sale — the frontend
  clamps quantities for UX, but the backend is the source of truth and
  rejects overselling.
- **Voiding** sales/purchases (rather than deleting) preserves the audit
  trail: stock and customer/supplier balances are reversed, and the record
  is marked `voided` with a reason.

## Default credentials

| Username | Password | Role  |
|----------|----------|-------|
| admin    | admin123 | admin |

Change this password (or create additional users via `POST /api/auth/register`
while authenticated as an admin) before using this in a real business.
