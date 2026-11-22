import express, { type Router, type Response } from 'express';
import { z } from 'zod';
import type { SqlDatabase } from './db.ts';
import {
  createAuthMiddleware,
  revokeAuthToken,
  type AuthenticatedRequest,
} from './auth.ts';
import { AppError, StackSpaceService } from './service.ts';
import type { LedgerEntryType, PaymentMethod } from '../shared/types.ts';

const paymentMethodSchema = z.enum(['cash', 'instapay', 'e_wallet', 'card']);
const roleSchema = z.enum(['admin', 'receptionist']);

function handleRouteError(res: Response, err: unknown): void {
  if (err instanceof z.ZodError) {
    const first = err.issues[0];
    res.status(400).json({
      error: first?.message || 'البيانات المدخلة غير صحيحة، يرجى المراجعة.',
    });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  const maybeStatus = (err as { statusCode?: number })?.statusCode;
  if (typeof maybeStatus === 'number' && err instanceof Error) {
    res.status(maybeStatus).json({ error: err.message });
    return;
  }
  console.error('Unhandled API error:', err);
  res.status(500).json({
    error:
      'حدث خطأ غير متوقع أثناء الحفظ، لم يتم فقدان بياناتك — يرجى المحاولة مرة أخرى.',
  });
}

function parseId(raw: string): number {
  const num = Number(raw);
  if (!Number.isInteger(num) || num <= 0) {
    throw new AppError('المعرف غير صالح.', 400);
  }
  return num;
}

export function createApiRouter(db: SqlDatabase): Router {
  const router = express.Router();
  const service = new StackSpaceService(db);
  const requireAuth = createAuthMiddleware(db);

  // ==================== PUBLIC AUTH ROUTES ====================

  router.get('/auth/status', async (_req, res) => {
    try {
      res.json(await service.getAuthStatus());
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/auth/bootstrap', async (req, res) => {
    try {
      const body = z
        .object({
          username: z.string().min(2, 'اسم المستخدم قصير جدًا').max(40),
          displayName: z.string().min(2, 'يرجى إدخال اسم المدير').max(80),
          password: z
            .string()
            .min(6, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل')
            .max(128),
          receptionist: z
            .object({
              username: z.string().min(2).max(40),
              displayName: z.string().min(2).max(80),
              password: z.string().min(6).max(128),
            })
            .optional(),
        })
        .parse(req.body);

      const result = await service.bootstrapAdmin(body);
      res.status(201).json(result);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/auth/login', async (req, res) => {
    try {
      const body = z
        .object({
          username: z.string().min(1, 'يرجى إدخال اسم المستخدم').max(60),
          password: z.string().min(1, 'يرجى إدخال كلمة المرور').max(128),
        })
        .parse(req.body);

      const result = await service.login(body.username, body.password);
      res.json(result);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // ==================== PROTECTED ROUTES ====================
  router.use(requireAuth);

  router.get('/auth/me', (req: AuthenticatedRequest, res) => {
    res.json({ user: req.authUser });
  });

  router.post('/auth/logout', async (req: AuthenticatedRequest, res) => {
    try {
      if (req.authToken) {
        await revokeAuthToken(db, req.authToken);
      }
      res.json({ ok: true });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // ---- SETTINGS ----
  router.get('/settings', async (_req, res) => {
    try {
      res.json(await service.getSettings());
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.put('/settings', async (req: AuthenticatedRequest, res) => {
    try {
      const body = z
        .object({
          workspaceName: z.string().min(1).max(100).optional(),
          hourlyRatePiasters: z.number().int().min(0).max(10000000).optional(),
          phone: z.string().max(40).optional(),
          address: z.string().max(200).optional(),
          receiptFooter: z.string().max(300).optional(),
        })
        .parse(req.body);
      res.json(await service.updateSettings(req.authUser!, body));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // ---- USERS (ADMIN ONLY) ----
  router.get('/users', async (req: AuthenticatedRequest, res) => {
    try {
      res.json(await service.listUsers(req.authUser!));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/users', async (req: AuthenticatedRequest, res) => {
    try {
      const body = z
        .object({
          username: z.string().min(2, 'اسم المستخدم قصير جدًا').max(40),
          displayName: z.string().min(2, 'يرجى إدخال الاسم').max(80),
          role: roleSchema,
          password: z
            .string()
            .min(6, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل')
            .max(128),
        })
        .parse(req.body);
      res.status(201).json(await service.createUser(req.authUser!, body));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.patch('/users/:id', async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseId(req.params.id);
      const body = z
        .object({
          displayName: z.string().min(2).max(80).optional(),
          role: roleSchema.optional(),
          isActive: z.boolean().optional(),
          password: z.string().min(6).max(128).optional(),
        })
        .parse(req.body);
      res.json(await service.updateUser(req.authUser!, id, body));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // ---- DRINKS ----
  router.get('/drinks', async (req, res) => {
    try {
      const includeInactive = req.query.includeInactive !== 'false';
      res.json(await service.listDrinks(includeInactive));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/drinks', async (req: AuthenticatedRequest, res) => {
    try {
      const body = z
        .object({
          name: z.string().min(1, 'يرجى إدخال اسم المشروب').max(80),
          pricePiasters: z.number().int().min(0).max(10000000),
        })
        .parse(req.body);
      res.status(201).json(await service.createDrink(req.authUser!, body));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.patch('/drinks/:id', async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseId(req.params.id);
      const body = z
        .object({
          name: z.string().min(1).max(80).optional(),
          pricePiasters: z.number().int().min(0).max(10000000).optional(),
          isActive: z.boolean().optional(),
        })
        .parse(req.body);
      res.json(await service.updateDrink(req.authUser!, id, body));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // ---- EXPENSE CATEGORIES ----
  router.get('/expense-categories', async (req, res) => {
    try {
      const includeInactive = req.query.includeInactive !== 'false';
      res.json(await service.listExpenseCategories(includeInactive));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/expense-categories', async (req: AuthenticatedRequest, res) => {
    try {
      const body = z
        .object({
          name: z.string().min(1, 'يرجى إدخال اسم التصنيف').max(80),
        })
        .parse(req.body);
      res
        .status(201)
        .json(await service.createExpenseCategory(req.authUser!, body.name));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.patch(
    '/expense-categories/:id',
    async (req: AuthenticatedRequest, res) => {
      try {
        const id = parseId(req.params.id);
        const body = z
          .object({
            name: z.string().min(1).max(80).optional(),
            isActive: z.boolean().optional(),
          })
          .parse(req.body);
        res.json(await service.updateExpenseCategory(req.authUser!, id, body));
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  // ---- SESSIONS ----
  router.get('/customers', async (req, res) => {
    try {
      const search = String(req.query.search || '').slice(0, 100);
      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 300);
      res.json(await service.listCustomers(search, limit));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.get('/sessions', async (req, res) => {
    try {
      const statusParam = String(req.query.status || 'open');
      const status =
        statusParam === 'closed' || statusParam === 'all'
          ? statusParam
          : 'open';
      const limit = Number(req.query.limit) || 60;
      res.json(
        await service.listSessions(status, Math.min(Math.max(limit, 1), 200))
      );
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.get('/sessions/:id', async (req, res) => {
    try {
      const id = parseId(req.params.id);
      const session = await service.getSessionById(id);
      if (!session) throw new AppError('الجلسة غير موجودة.', 404);
      res.json(session);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/sessions', async (req: AuthenticatedRequest, res) => {
    try {
      const body = z
        .object({
          customerId: z.number().int().positive().nullable().optional(),
          clientName: z.string().max(100).nullable().optional(),
          customerPhone: z.string().max(40).nullable().optional(),
          notes: z.string().max(300).nullable().optional(),
          startedAt: z.string().optional(),
        })
        .parse(req.body || {});
      res.status(201).json(await service.startSession(req.authUser!, body));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/sessions/:id/drinks', async (req: AuthenticatedRequest, res) => {
    try {
      const sessionId = parseId(req.params.id);
      const body = z
        .object({
          drinkId: z.number().int().positive(),
          quantity: z.number().int().min(1).max(100),
        })
        .parse(req.body);
      res.json(
        await service.addDrinkToSession(req.authUser!, sessionId, body)
      );
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.patch(
    '/sessions/:id/drinks/:itemId',
    async (req: AuthenticatedRequest, res) => {
      try {
        const sessionId = parseId(req.params.id);
        const itemId = parseId(req.params.itemId);
        const body = z
          .object({
            quantity: z.number().int().min(0).max(100),
          })
          .parse(req.body);
        res.json(
          await service.updateSessionDrinkQuantity(
            req.authUser!,
            sessionId,
            itemId,
            body.quantity
          )
        );
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  router.post(
    '/sessions/:id/checkout',
    async (req: AuthenticatedRequest, res) => {
      try {
        const sessionId = parseId(req.params.id);
        const body = z
          .object({
            paymentMethod: paymentMethodSchema,
            idempotencyKey: z.string().min(6).max(120),
            endedAt: z.string().optional(),
            notes: z.string().max(300).nullable().optional(),
          })
          .parse(req.body);
        res.json(
          await service.checkoutSession(req.authUser!, sessionId, body)
        );
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  // ---- DIRECT DRINK SALES ----
  router.get('/direct-sales', async (req, res) => {
    try {
      const limit = Number(req.query.limit) || 40;
      res.json(
        await service.listDirectDrinkSales(Math.min(Math.max(limit, 1), 200))
      );
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/direct-sales', async (req: AuthenticatedRequest, res) => {
    try {
      const body = z
        .object({
          customerName: z.string().max(100).nullable().optional(),
          items: z
            .array(
              z.object({
                drinkId: z.number().int().positive(),
                quantity: z.number().int().min(1).max(100),
              })
            )
            .min(1, 'يرجى اختيار مشروب واحد على الأقل'),
          paymentMethod: paymentMethodSchema,
          idempotencyKey: z.string().min(6).max(120),
          occurredAt: z.string().optional(),
        })
        .parse(req.body);
      res
        .status(201)
        .json(await service.createDirectDrinkSale(req.authUser!, body));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // ---- COURSES & STUDENTS ----
  router.get('/course-groups', async (_req, res) => {
    try {
      res.json(await service.listCourseGroups());
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/course-groups', async (req: AuthenticatedRequest, res) => {
    try {
      const body = z
        .object({
          courseName: z.string().min(1, 'يرجى إدخال اسم الكورس').max(120),
          groupName: z.string().min(1, 'يرجى إدخال اسم المجموعة').max(120),
          instructorName: z.string().min(1, 'يرجى إدخال اسم المدرب').max(100),
          schedule: z.string().min(1, 'يرجى إدخال المواعيد').max(180),
          pricePiasters: z.number().int().min(0).max(100000000),
        })
        .parse(req.body);
      res
        .status(201)
        .json(await service.createCourseGroup(req.authUser!, body));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.patch('/course-groups/:id', async (req: AuthenticatedRequest, res) => {
    try {
      const id = parseId(req.params.id);
      const body = z
        .object({
          courseName: z.string().min(1).max(120).optional(),
          groupName: z.string().min(1).max(120).optional(),
          instructorName: z.string().min(1).max(100).optional(),
          schedule: z.string().min(1).max(180).optional(),
          pricePiasters: z.number().int().min(0).max(100000000).optional(),
          status: z.enum(['active', 'completed', 'archived']).optional(),
        })
        .parse(req.body);
      res.json(await service.updateCourseGroup(req.authUser!, id, body));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.get('/enrollments', async (req, res) => {
    try {
      const groupId = req.query.courseGroupId
        ? parseId(String(req.query.courseGroupId))
        : undefined;
      res.json(await service.listEnrollments(groupId));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/enrollments', async (req: AuthenticatedRequest, res) => {
    try {
      const body = z
        .object({
          courseGroupId: z.number().int().positive(),
          studentName: z.string().min(2, 'يرجى إدخال اسم الطالب').max(120),
          studentPhone: z.string().min(6, 'يرجى إدخال رقم موبايل صحيح').max(30),
          agreedPricePiasters: z
            .number()
            .int()
            .min(0)
            .max(100000000)
            .optional(),
          notes: z.string().max(300).nullable().optional(),
        })
        .parse(req.body);
      res.status(201).json(await service.enrollStudent(req.authUser!, body));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post(
    '/enrollments/:id/payments',
    async (req: AuthenticatedRequest, res) => {
      try {
        const enrollmentId = parseId(req.params.id);
        const body = z
          .object({
            amountPiasters: z
              .number()
              .int()
              .positive('المبلغ يجب أن يكون أكبر من صفر'),
            paymentMethod: paymentMethodSchema,
            paidAt: z.string().optional(),
            notes: z.string().max(300).nullable().optional(),
            idempotencyKey: z.string().min(6).max(120),
          })
          .parse(req.body);
        res
          .status(201)
          .json(
            await service.recordCoursePayment(req.authUser!, enrollmentId, body)
          );
      } catch (err) {
        handleRouteError(res, err);
      }
    }
  );

  // ---- LEDGER ----
  router.get('/ledger', async (req: AuthenticatedRequest, res) => {
    try {
      const entries = await service.listLedgerEntries(req.authUser!, {
        search: req.query.search ? String(req.query.search) : undefined,
        month: req.query.month ? String(req.query.month) : undefined,
        fromDate: req.query.fromDate ? String(req.query.fromDate) : undefined,
        toDate: req.query.toDate ? String(req.query.toDate) : undefined,
        entryType: req.query.entryType
          ? (String(req.query.entryType) as LedgerEntryType | 'all')
          : 'all',
        categoryId: req.query.categoryId
          ? Number(req.query.categoryId)
          : undefined,
        paymentMethod: req.query.paymentMethod
          ? (String(req.query.paymentMethod) as PaymentMethod | 'all')
          : 'all',
        limit: req.query.limit ? Number(req.query.limit) : 250,
      });
      res.json(entries);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/ledger/manual', async (req: AuthenticatedRequest, res) => {
    try {
      const body = z
        .object({
          entryType: z.enum([
            'expense',
            'other_revenue',
            'owner_deposit',
            'owner_withdrawal',
          ]),
          amountPiasters: z
            .number()
            .int()
            .positive('المبلغ يجب أن يكون أكبر من صفر'),
          paymentMethod: paymentMethodSchema,
          categoryId: z.number().int().positive().nullable().optional(),
          description: z.string().min(2, 'يرجى إدخال البيان').max(300),
          occurredAt: z.string().optional(),
          idempotencyKey: z.string().min(6).max(120),
        })
        .parse(req.body);
      res
        .status(201)
        .json(await service.recordManualLedgerEntry(req.authUser!, body));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post('/ledger/:id/refund', async (req: AuthenticatedRequest, res) => {
    try {
      const originalId = parseId(req.params.id);
      const body = z
        .object({
          amountPiasters: z
            .number()
            .int()
            .positive('مبلغ الاسترداد يجب أن يكون أكبر من صفر'),
          paymentMethod: paymentMethodSchema,
          reason: z.string().min(2, 'يرجى كتابة سبب الاسترداد').max(300),
          refundedAt: z.string().optional(),
          idempotencyKey: z.string().min(6).max(120),
        })
        .parse(req.body);
      res
        .status(201)
        .json(await service.createRefund(req.authUser!, originalId, body));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // ---- REPORTS (ADMIN ONLY) ----
  router.get('/reports/monthly', async (req: AuthenticatedRequest, res) => {
    try {
      const month = req.query.month ? String(req.query.month) : undefined;
      res.json(await service.getMonthlyProfitReport(req.authUser!, month));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // ---- AUDIT LOGS (ADMIN ONLY) ----
  router.get('/audit-logs', async (req: AuthenticatedRequest, res) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : 100;
      res.json(await service.listAuditLogs(req.authUser!, limit));
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  return router;
}
