const assert = require('node:assert/strict');
const { test } = require('node:test');

const invoice = require('../lib/invoice');
const pricing = require('../lib/pricing');
const reports = require('../lib/reports');

// Saved order lines carry HSN codes but no explicit GST rate.
const order = {
  id: 1001,
  date: '21/11/2026',
  customer: 'Walk-in',
  status: 'completed',
  coupon: 'SAVE10',
  items: [
    { id: 1, name: 'Rice', hsn: '1006', price: 500, qty: 2 },
    { id: 2, name: 'Ghee', hsn: '0405', price: 1000, qty: 1 }
  ],
  subtotal: 2000,
  discount: 150,
  tax: 157.25,
  total: 2007.25
};

test('checkout caps SAVE10 and applies HSN rates after allocating the discount', () => {
  const { lines, ...totals } = pricing.computeTotals(order.items, order.coupon);

  assert.deepEqual(totals, {
    subtotal: 2000, discount: 150, taxable: 1850, tax: 157.25,
    cgst: 78.63, sgst: 78.62, total: 2007.25
  });
  assert.deepEqual(
    lines.map(({ gstPercent, discount, taxable, tax }) => ({ gstPercent, discount, taxable, tax })),
    [
      { gstPercent: 5, discount: 75, taxable: 925, tax: 46.25 },
      { gstPercent: 12, discount: 75, taxable: 925, tax: 111 }
    ]
  );
});

test('invoice figures match the billed total and discounted HSN breakdown', () => {
  const { rows, ...totals } = invoice.computeInvoiceFigures(order);

  assert.deepEqual(totals, {
    subtotal: 2000, discount: 150, tax: 157.25,
    cgst: 78.63, sgst: 78.62, total: 2007.25
  });
  assert.deepEqual(
    rows.map(({ hsn, gstPercent, lineTax }) => ({ hsn, gstPercent, lineTax })),
    [
      { hsn: '1006', gstPercent: 5, lineTax: 46.25 },
      { hsn: '0405', gstPercent: 12, lineTax: 111 }
    ]
  );
});

test('printable invoice shows the billed GST and total without a ledger warning', () => {
  const html = invoice.render(order);

  assert.match(html, /CGST \+ SGST \(Total GST\)<\/td><td class="r">₹157\.25/);
  assert.match(html, /Invoice Total<\/td><td class="r">₹2007\.25/);
  assert.doesNotMatch(html, /Accountant Reconciliation Notice/);
});

test('GST reconciliation matches the billed order and excludes cancelled orders', () => {
  const result = reports.getGstReconciliation({
    orders: [order, { ...order, id: 1002, status: 'cancelled' }]
  });

  assert.deepEqual(result, {
    totalChecked: 1,
    mismatchCount: 0,
    totalDelta: 0,
    rows: [{
      orderId: 1001, date: '21/11/2026', customer: 'Walk-in', coupon: 'SAVE10',
      ledgerSubtotal: 2000, ledgerDiscount: 150, ledgerTax: 157.25,
      ledgerTotal: 2007.25, invoiceDiscount: 150, invoiceTax: 157.25,
      invoiceTotal: 2007.25, delta: 0, matched: true
    }]
  });
});

test('printable invoice warns when the recorded total differs by one paisa', () => {
  const html = invoice.render({ ...order, total: 2007.24 });

  assert.match(html, /Accountant Reconciliation Notice/);
  assert.match(html, /differs from Order Ledger recorded total \(₹2007\.24\) by \+₹0\.01/);
});

test('CURRENT BEHAVIOUR: a tax-only mismatch is reported but produces no printable warning', () => {
  const sameTotalOrder = { ...order, tax: 157.24 };
  const result = reports.getGstReconciliation({ orders: [sameTotalOrder] });

  assert.equal(result.mismatchCount, 1);
  assert.equal(result.totalDelta, 0);
  assert.equal(result.rows[0].matched, false);
  assert.doesNotMatch(invoice.render(sameTotalOrder), /Accountant Reconciliation Notice/);
});
