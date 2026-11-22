import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server.ts';
import { getCurrentCairoMonth } from '../src/shared/format.ts';
import type {
  CourseGroup,
  Customer,
  DrinkItem,
  ExpenseCategory,
  MonthlyProfitReport,
  StudentEnrollment,
  WorkspaceSession,
} from '../src/shared/types.ts';

async function apiCall<T>(
  baseUrl: string,
  method: string,
  path: string,
  token?: string,
  body?: unknown
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as T;
  return { status: res.status, data };
}

async function runAcceptanceTest() {
  console.log('=== Stack Space Acceptance Test (Isolated Test Database) ===');

  // Always use an isolated in-memory test database completely separate from production data
  const { app, db } = await createApp({
    sqlitePath: ':memory:',
    forceSqlite: true,
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. Bootstrap Admin & Receptionist accounts
    const boot = await apiCall<{ token: string; user: { id: number; role: string } }>(
      baseUrl,
      'POST',
      '/api/auth/bootstrap',
      undefined,
      {
        username: 'owner',
        displayName: 'صاحب المكان',
        password: 'owner-test-password',
        receptionist: {
          username: 'desk',
          displayName: 'موظف الاستقبال',
          password: 'desk-test-password',
        },
      }
    );
    assert.equal(boot.status, 201, 'Bootstrap should succeed');
    const adminToken = boot.data.token;

    const deskLogin = await apiCall<{ token: string }>(
      baseUrl,
      'POST',
      '/api/auth/login',
      undefined,
      { username: 'desk', password: 'desk-test-password' }
    );
    assert.equal(deskLogin.status, 200, 'Receptionist login should succeed');
    const deskToken = deskLogin.data.token;

    // 2. Verify RBAC in data access layer: Receptionist CANNOT view monthly profit report or update settings
    const forbiddenReport = await apiCall<{ error: string }>(
      baseUrl,
      'GET',
      '/api/reports/monthly',
      deskToken
    );
    assert.equal(
      forbiddenReport.status,
      403,
      'Receptionist must be blocked (403) from monthly profit reports'
    );

    const forbiddenSettings = await apiCall<{ error: string }>(
      baseUrl,
      'PUT',
      '/api/settings',
      deskToken,
      { hourlyRatePiasters: 5000 }
    );
    assert.equal(
      forbiddenSettings.status,
      403,
      'Receptionist must be blocked (403) from editing pricing settings'
    );

    // 3. Configure hourly rate = 30.00 EGP (3000 piasters) and locate Turkish Coffee = 25.00 EGP (2500 piasters)
    const setRes = await apiCall(baseUrl, 'PUT', '/api/settings', adminToken, {
      hourlyRatePiasters: 3000,
    });
    assert.equal(setRes.status, 200);

    const drinksRes = await apiCall<DrinkItem[]>(
      baseUrl,
      'GET',
      '/api/drinks',
      deskToken
    );
    const coffee = drinksRes.data.find((d) => d.name.includes('قهوة'));
    assert(coffee, 'Coffee drink must exist');
    assert.equal(coffee.pricePiasters, 2500, 'Coffee price should be 25.00 EGP');

    // 4. Scenario 1: 1.5h (90 min) session @ 30 EGP/h + 25 EGP coffee -> 70 EGP total (45 session + 25 drinks)
    const now = new Date();
    const startedAt = new Date(now.getTime() - 90 * 60 * 1000).toISOString();
    const endedAt = now.toISOString();

    const openRes = await apiCall<WorkspaceSession>(
      baseUrl,
      'POST',
      '/api/sessions',
      deskToken,
      {
        clientName: 'عميل اختبار القبول',
        customerPhone: '01012345678',
        startedAt,
      }
    );
    assert.equal(openRes.status, 201);
    assert(openRes.data.customerId, 'A first-time customer must be saved');
    assert.equal(openRes.data.customerPhone, '01012345678');
    const sessionId = openRes.data.id;

    const customersRes = await apiCall<Customer[]>(
      baseUrl,
      'GET',
      '/api/customers?search=01012345678',
      deskToken
    );
    assert.equal(customersRes.status, 200);
    assert.equal(customersRes.data.length, 1);
    assert.equal(customersRes.data[0].visitCount, 1);

    // Add 1 coffee (25 EGP)
    const addDrinkRes = await apiCall<WorkspaceSession>(
      baseUrl,
      'POST',
      `/api/sessions/${sessionId}/drinks`,
      deskToken,
      { drinkId: coffee.id, quantity: 1 }
    );
    assert.equal(addDrinkRes.status, 200);
    assert.equal(addDrinkRes.data.drinksTotalPiasters, 2500);

    // Change hourly rate and coffee price AFTER session started & drink added -> must NOT change this session's prices!
    await apiCall(baseUrl, 'PUT', '/api/settings', adminToken, {
      hourlyRatePiasters: 4500,
    });
    await apiCall(baseUrl, 'PATCH', `/api/drinks/${coffee.id}`, adminToken, {
      pricePiasters: 3500,
    });

    // Verify open session is NOT in monthly revenue before checkout!
    const month = getCurrentCairoMonth();
    const reportBeforeCheckout = await apiCall<MonthlyProfitReport>(
      baseUrl,
      'GET',
      `/api/reports/monthly?month=${month}`,
      adminToken
    );
    assert.equal(
      reportBeforeCheckout.data.totalGrossCollectionsPiasters,
      0,
      'Open session must NOT count as revenue before checkout'
    );

    // Checkout session AND test double-click idempotency!
    const checkoutKey = 'acceptance-checkout-key-001';
    const checkout1 = await apiCall<{
      session: WorkspaceSession;
      alreadyProcessed: boolean;
    }>(baseUrl, 'POST', `/api/sessions/${sessionId}/checkout`, deskToken, {
      paymentMethod: 'cash',
      idempotencyKey: checkoutKey,
      endedAt,
    });
    assert.equal(checkout1.status, 200);
    assert.equal(checkout1.data.alreadyProcessed, false);
    assert.equal(checkout1.data.session.sessionCostPiasters, 4500, 'Session cost must be 45.00 EGP');
    assert.equal(checkout1.data.session.drinksTotalPiasters, 2500, 'Drinks cost must be 25.00 EGP');
    assert.equal(checkout1.data.session.totalPiasters, 7000, 'Total checkout must be 70.00 EGP');

    // Simulate double-click on Confirm Payment button with same idempotencyKey
    const checkout2 = await apiCall<{
      session: WorkspaceSession;
      alreadyProcessed: boolean;
    }>(baseUrl, 'POST', `/api/sessions/${sessionId}/checkout`, deskToken, {
      paymentMethod: 'cash',
      idempotencyKey: checkoutKey,
      endedAt,
    });
    assert.equal(checkout2.status, 200);
    assert.equal(
      checkout2.data.alreadyProcessed,
      true,
      'Duplicate click with same idempotencyKey must be deduplicated'
    );

    // 5. Scenario 2: Course 1,500 EGP -> Student enrolls (0 revenue) -> Pays 500 EGP -> Remaining 1,000 EGP
    const groupRes = await apiCall<CourseGroup>(
      baseUrl,
      'POST',
      '/api/course-groups',
      adminToken,
      {
        courseName: 'تطوير الويب Full-Stack',
        groupName: 'مجموعة الاختبار',
        instructorName: 'م. كريم طارق',
        schedule: 'السبت والثلاثاء 6 م',
        pricePiasters: 150000,
      }
    );
    assert.equal(groupRes.status, 201);

    const enrollRes = await apiCall<StudentEnrollment>(
      baseUrl,
      'POST',
      '/api/enrollments',
      deskToken,
      {
        courseGroupId: groupRes.data.id,
        studentName: 'أحمد محمد',
        studentPhone: '01012345678',
        agreedPricePiasters: 150000,
      }
    );
    assert.equal(enrollRes.status, 201);
    assert.equal(enrollRes.data.paidPiasters, 0);
    assert.equal(enrollRes.data.remainingPiasters, 150000);

    // Verify enrollment alone generated 0 course revenue
    const reportAfterEnroll = await apiCall<MonthlyProfitReport>(
      baseUrl,
      'GET',
      `/api/reports/monthly?month=${month}`,
      adminToken
    );
    assert.equal(
      reportAfterEnroll.data.coursePaymentsPiasters,
      0,
      'Enrollment alone must not create revenue'
    );

    // Student pays 500 EGP (50000 piasters)
    const payKey = 'acceptance-course-pay-001';
    const payRes = await apiCall<{ enrollment: StudentEnrollment }>(
      baseUrl,
      'POST',
      `/api/enrollments/${enrollRes.data.id}/payments`,
      deskToken,
      {
        amountPiasters: 50000,
        paymentMethod: 'cash',
        idempotencyKey: payKey,
      }
    );
    assert.equal(payRes.status, 201);
    assert.equal(payRes.data.enrollment.paidPiasters, 50000);
    assert.equal(
      payRes.data.enrollment.remainingPiasters,
      100000,
      'Remaining student balance must be 1,000.00 EGP'
    );

    // Duplicate click on student payment must not double charge
    const payResDup = await apiCall<{ alreadyProcessed: boolean }>(
      baseUrl,
      'POST',
      `/api/enrollments/${enrollRes.data.id}/payments`,
      deskToken,
      {
        amountPiasters: 50000,
        paymentMethod: 'cash',
        idempotencyKey: payKey,
      }
    );
    assert.equal(payResDup.data.alreadyProcessed, true);

    // 6. Scenario 3: Record Internet expense = 200.00 EGP (20000 piasters) in the same month
    const catsRes = await apiCall<ExpenseCategory[]>(
      baseUrl,
      'GET',
      '/api/expense-categories',
      deskToken
    );
    const internetCat = catsRes.data.find((c) => c.name === 'الإنترنت');
    assert(internetCat, 'Internet expense category must exist');

    const expRes = await apiCall(
      baseUrl,
      'POST',
      '/api/ledger/manual',
      deskToken,
      {
        entryType: 'expense',
        amountPiasters: 20000,
        paymentMethod: 'cash',
        categoryId: internetCat.id,
        description: 'فاتورة إنترنت شهرية',
        idempotencyKey: 'acceptance-internet-exp-001',
      }
    );
    assert.equal(expRes.status, 201);

    // 7. Verify Expected Report: Collections = 570, Expenses = 200, Net Profit = 370 (45 sessions + 25 drinks + 500 course)
    const report1 = await apiCall<MonthlyProfitReport>(
      baseUrl,
      'GET',
      `/api/reports/monthly?month=${month}`,
      adminToken
    );
    assert.equal(report1.status, 200);
    assert.equal(report1.data.sessionRevenuePiasters, 4500, 'Sessions revenue = 45.00 EGP');
    assert.equal(report1.data.drinksRevenuePiasters, 2500, 'Drinks revenue = 25.00 EGP');
    assert.equal(report1.data.coursePaymentsPiasters, 50000, 'Course payments = 500.00 EGP');
    assert.equal(report1.data.totalGrossCollectionsPiasters, 57000, 'Total collections = 570.00 EGP');
    assert.equal(report1.data.operatingExpensesPiasters, 20000, 'Operating expenses = 200.00 EGP');
    assert.equal(report1.data.netProfitPiasters, 37000, 'Cash-basis net profit = 370.00 EGP');
    assert.equal(report1.data.studentReceivablesPiasters, 100000, 'Student receivables = 1,000.00 EGP');
    assert.equal(report1.data.cumulativeCashBalancePiasters, 37000, 'Cash drawer = 370.00 EGP');

    // 8. Scenario 4: Owner Deposit of 1,000.00 EGP -> Net Profit MUST remain 370.00 EGP!
    const depositRes = await apiCall(
      baseUrl,
      'POST',
      '/api/ledger/manual',
      adminToken,
      {
        entryType: 'owner_deposit',
        amountPiasters: 100000,
        paymentMethod: 'cash',
        description: 'إيداع نقدي من صاحب المكان',
        idempotencyKey: 'acceptance-owner-deposit-001',
      }
    );
    assert.equal(depositRes.status, 201);

    // Simulate page refresh (fresh API fetch)
    const reportAfterDeposit = await apiCall<MonthlyProfitReport>(
      baseUrl,
      'GET',
      `/api/reports/monthly?month=${month}`,
      adminToken
    );
    assert.equal(
      reportAfterDeposit.data.netProfitPiasters,
      37000,
      'Net profit MUST remain 370.00 EGP after 1,000 EGP owner deposit'
    );
    assert.equal(
      reportAfterDeposit.data.ownerDepositsPiasters,
      100000,
      'Owner deposit must appear separately as 1,000.00 EGP'
    );
    assert.equal(
      reportAfterDeposit.data.cumulativeCashBalancePiasters,
      137000,
      'Cash drawer must reflect actual cash (370 + 1,000 = 1,370.00 EGP)'
    );

    // 9. Verify Refund Guard: cannot refund more than collected!
    const sessionLedgerEntry = reportAfterDeposit.data.lines.find(
      (l) => l.key === 'session_revenue'
    )?.entries[0];
    assert(sessionLedgerEntry, 'Session ledger entry must exist');

    const overRefund = await apiCall<{ error: string }>(
      baseUrl,
      'POST',
      `/api/ledger/${sessionLedgerEntry.id}/refund`,
      adminToken,
      {
        amountPiasters: 5000, // > 4500 collected!
        paymentMethod: 'cash',
        reason: 'اختبار تجاوز حد الاسترداد',
        idempotencyKey: 'acceptance-over-refund-001',
      }
    );
    assert.equal(
      overRefund.status,
      400,
      'Refunding more than collected must be rejected with 400'
    );

    console.log('✅ ALL ACCEPTANCE TESTS PASSED:');
    console.log('   - 1.5h Session (30 EGP/h) + Coffee (25 EGP) = 70.00 EGP (45.00 Sessions + 25.00 Drinks)');
    console.log('   - Double-click checkout idempotency verified (zero duplicate charges)');
    console.log('   - Price snapshot integrity verified after mid-session rate/price changes');
    console.log('   - First-time customer saved and searchable by phone with visit history');
    console.log('   - Course 1,500 EGP: Enrollment = 0 revenue; 500 EGP payment -> 1,000 EGP remaining');
    console.log('   - Internet Expense = 200.00 EGP -> Collections 570.00 | Expenses 200.00 | Net Profit 370.00 EGP');
    console.log('   - Owner Deposit 1,000.00 EGP -> Net Profit unchanged (370.00 EGP), Cash Drawer = 1,370.00 EGP');
    console.log('   - RBAC (403 for receptionist on reports/settings) & Refund cap verified');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
  }
}

runAcceptanceTest().catch((err) => {
  console.error('❌ ACCEPTANCE TEST FAILED:', err);
  process.exit(1);
});
