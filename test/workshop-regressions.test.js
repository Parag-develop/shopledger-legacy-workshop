const assert = require('node:assert/strict');
const { test } = require('node:test');

const inventory = require('../lib/inventory');
const orders = require('../lib/orders');
const ledger = require('../lib/ledger');

test('inventory rejects quantities that would consume wholesale reservations', () => {
  const products = [{ id: 1, stock: 4, reserved: 3 }];
  assert.equal(inventory.check(products, [{ id: 1, qty: 2 }]).ok, false);
});

test('inventory can sell the exact remaining sellable stock', () => {
  const products = [{ id: 1, stock: 4, reserved: 3 }];
  assert.deepEqual(inventory.check(products, [{ id: 1, qty: 1 }]), { ok: true });
});

test('repeated lines for the same product share its available stock', () => {
  const products = [{ id: 1, stock: 4, reserved: 1 }];
  const items = [{ id: 1, qty: 2 }, { id: '1', qty: 2 }];
  assert.equal(inventory.check(products, items).ok, false);
});

test('cancelling a pending order restores physical stock once and preserves reservations', () => {
  const product = { id: 1, stock: 4, reserved: 3 };
  const items = [{ id: 1, qty: 1 }];
  const db = { products: [product], orders: [], nextOrderId: 1001 };
  inventory.reserve(db.products, items);
  const order = orders.add(db, { items, status: 'pending' });
  assert.equal(product.stock, 3);
  assert.equal(orders.cancel(db, order.id).ok, true);
  assert.equal(order.status, 'cancelled');
  assert.equal(orders.cancel(db, order.id).ok, false);
  assert.deepEqual(product, { id: 1, stock: 4, reserved: 3 });
});

const orderHistory = {
  orders: [
    { id: 1, date: '28/12/2021' },
    { id: 2, date: '01/01/2022' },
    { id: 3, date: '2022-01-31' },
    { id: 4, date: '04/03/2022' }
  ]
};

test('order history sorts newest first across months and years', () => {
  assert.deepEqual(orders.list(orderHistory).map(order => order.id), [4, 3, 2, 1]);
});

test('date filters include both boundaries and accept both date formats', () => {
  const january = orders.list(orderHistory, { from: '2022-01-01', to: '31/01/2022' });
  assert.deepEqual(january.map(order => order.id), [3, 2]);
});

function customerLedger() {
  return {
    customers: [{ id: 1, openingBalance: 450, totalBilled: 1982.01, totalSettled: 1200 }],
    nextSettlementId: 501
  };
}

test('a string amount is recorded as a numeric khata payment', () => {
  const db = customerLedger();
  const result = ledger.recordSettlement(db, 1, '500');
  assert.equal(result.ok, true);
  assert.equal(result.settlement.amount, 500);
  assert.equal(result.customer.totalSettled, 1700);
  assert.equal(result.customer.balance, 732.01);
  assert.equal(ledger.listCustomers(db)[0].balance, 732.01);
});

test('invalid settlement amounts leave the ledger unchanged', () => {
  const db = customerLedger();
  for (const amount of [0, -1, '', 'bad', Infinity, true, [500]]) {
    assert.equal(ledger.recordSettlement(db, 1, amount).ok, false);
  }
  assert.deepEqual(db, customerLedger());
});
