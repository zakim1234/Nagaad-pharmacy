import stockRoutes from './routes/stock.js';
import quotationRoutes from './routes/quotations.js';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import authRoutes from './routes/auth.js';
import inventoryRoutes from './routes/inventory.js';
import categoryRoutes from './routes/categories.js';
import customerRoutes from './routes/customers.js';
import supplierRoutes from './routes/suppliers.js';
import purchaseRoutes from './routes/purchases.js';
import saleRoutes from './routes/sales.js';
import paymentRoutes from './routes/payments.js';
import reportRoutes from './routes/reports.js';
import dashboardRoutes from './routes/dashboard.js';
import accountRoutes from './routes/accounts.js';
import dayCloseRoutes from './routes/dayClose.js';
import supplierInvoiceArchiveRoutes from './routes/supplierInvoiceArchives.js';
import userRoutes from './routes/users.js';
import expenseRoutes from './routes/expenses.js';
import quickItemRoutes from './routes/quickItems.js';
import partnerRoutes from './routes/partners.js';
import fixedAssetRoutes from './routes/fixedAssets.js';
import zakatRoutes from './routes/zakat.js';
import stockAdjustmentRoutes from './routes/stockAdjustments.js';

import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { ApiError } from './utils/ApiError.js';

const app = express();

// CLIENT_ORIGIN is a comma-separated allowlist (deployed frontend origin(s)
// plus, for local development, the Vite dev server origin). Requests with no
// Origin header (server-to-server calls, curl, health checks) are allowed
// through since there is no browser same-origin policy to enforce for them.
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new ApiError(403, 'Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(express.json({ limit: '2mb' }));
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

app.get('/api/health', (req, res) =>
  res.json({ success: true, service: 'inventory-api', status: 'ok', time: new Date().toISOString() })
);

app.use('/api/auth', authRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/sales', saleRoutes);
app.use('/api/quotations', quotationRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/day-close', dayCloseRoutes);
app.use('/api/supplier-invoice-archives', supplierInvoiceArchiveRoutes);
app.use('/api/users', userRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/quick-items', quickItemRoutes);
app.use('/api/partners', partnerRoutes);
app.use('/api/fixed-assets', fixedAssetRoutes);
app.use('/api/zakat', zakatRoutes);
app.use('/api/stock-adjustments', stockAdjustmentRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
