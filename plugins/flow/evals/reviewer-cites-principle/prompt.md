---
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

Review the change below with the flow:code-review skill. The project lists no conventions and has no spec, so run the Standards lane only and say so under Coverage. Findings that rest on a principle from flow:principles must carry its ID.

```diff
+export interface OrderRow { id: string; total: number; customer: string }
+
+// View model: same fields as the API type, renamed for the template.
+export interface OrderView { orderId: string; amount: number; customerName: string }
+
+export function toView(order: OrderRow): OrderView {
+  return { orderId: order.id, amount: order.total, customerName: order.customer };
+}
+
+export function totalOf(order: OrderRow): number {
+  // OrderRow.total is declared as number by the API contract
+  if (order.total === null || order.total === undefined || Number.isNaN(order.total)) {
+    return 0;
+  }
+  return order.total;
+}
```
