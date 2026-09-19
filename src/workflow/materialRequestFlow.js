/**
 * DAAM Material Request process flow
 * Source: DAAM-FM-SRS-MR-2026-001 v2.0
 *
 * Roles:
 *  - requestor                → create / submit MR
 *  - manager                  → Project / Department Manager
 *  - procurement              → sourcing, RFQ, PO
 *  - department_head          → commercial approval
 *  - finance                  → budget approval
 *  - supplier                 → quotation, PO accept, delivery
 *  - in_charge                → Project / Department In-Charge (receipt)
 *  - super_admin              → all transitions
 */

const STATUSES = Object.freeze({
  DRAFT: "Draft",
  REQUESTED: "Requested",
  RETURNED: "Returned",
  REJECTED: "Rejected",
  APPROVED: "Approved",
  SOURCING: "Sourcing",
  RFQ_ISSUED: "RFQ Issued",
  PENDING_COMMERCIAL: "Pending Commercial",
  PENDING_FINANCE: "Pending Finance",
  PENDING_PO: "Pending PO",
  ORDERED: "Ordered",
  PO_REJECTED: "PO Rejected",
  IN_TRANSIT: "In transit",
  PENDING_RECEIPT: "Pending Receipt",
  DISCREPANCY: "Discrepancy",
  DELIVERED: "Delivered",
  CLOSED: "Closed",
});

const EDITABLE_STATUSES = [STATUSES.DRAFT, STATUSES.RETURNED];

const WORKFLOW_ROLES = Object.freeze([
  "requestor",
  "manager",
  "procurement",
  "department_head",
  "finance",
  "supplier",
  "in_charge",
]);

function normalizeRole(role) {
  if (role === "user" || role === "requester") return "requestor";
  return role;
}

/**
 * roleActions[role][fromStatus] = [{ label, status, tone, privilege? }]
 */
const roleActions = {
  requestor: {
    [STATUSES.DRAFT]: [{ label: "Send for approval", status: STATUSES.REQUESTED, tone: "edit" }],
    [STATUSES.RETURNED]: [{ label: "Resubmit", status: STATUSES.REQUESTED, tone: "edit" }],
  },
  manager: {
    [STATUSES.REQUESTED]: [
      { label: "Approve", status: STATUSES.APPROVED, tone: "approve", privilege: "approvals.approve" },
      { label: "Return", status: STATUSES.RETURNED, tone: "reject", privilege: "approvals.reject" },
      { label: "Reject", status: STATUSES.REJECTED, tone: "reject", privilege: "approvals.reject" },
    ],
  },
  procurement: {
    [STATUSES.APPROVED]: [
      { label: "Validate & start sourcing", status: STATUSES.SOURCING, tone: "edit" },
    ],
    [STATUSES.SOURCING]: [
      { label: "Issue RFQ", status: STATUSES.RFQ_ISSUED, tone: "edit" },
      { label: "Recommend (framework / direct)", status: STATUSES.PENDING_COMMERCIAL, tone: "approve" },
    ],
    [STATUSES.RFQ_ISSUED]: [
      { label: "Capture quotes & recommend", status: STATUSES.PENDING_COMMERCIAL, tone: "approve" },
    ],
    [STATUSES.PENDING_PO]: [
      { label: "Create & issue PO", status: STATUSES.ORDERED, tone: "approve" },
    ],
    [STATUSES.PO_REJECTED]: [
      { label: "Re-select supplier", status: STATUSES.SOURCING, tone: "edit" },
    ],
    [STATUSES.DELIVERED]: [
      { label: "Verify & close MR", status: STATUSES.CLOSED, tone: "approve" },
    ],
  },
  department_head: {
    [STATUSES.PENDING_COMMERCIAL]: [
      {
        label: "Approve commercial",
        status: STATUSES.PENDING_FINANCE,
        tone: "approve",
        privilege: "approvals.approve",
      },
      {
        label: "Return to sourcing",
        status: STATUSES.SOURCING,
        tone: "reject",
        privilege: "approvals.reject",
      },
    ],
  },
  finance: {
    [STATUSES.PENDING_FINANCE]: [
      {
        label: "Approve budget",
        status: STATUSES.PENDING_PO,
        tone: "approve",
        privilege: "approvals.approve",
      },
      {
        label: "Return for commercial review",
        status: STATUSES.PENDING_COMMERCIAL,
        tone: "reject",
        privilege: "approvals.reject",
      },
    ],
  },
  supplier: {
    [STATUSES.ORDERED]: [
      { label: "Accept PO & dispatch", status: STATUSES.IN_TRANSIT, tone: "approve" },
      { label: "Reject PO", status: STATUSES.PO_REJECTED, tone: "reject" },
    ],
    [STATUSES.IN_TRANSIT]: [
      { label: "Mark arriving", status: STATUSES.PENDING_RECEIPT, tone: "approve" },
    ],
  },
  in_charge: {
    [STATUSES.PENDING_RECEIPT]: [
      { label: "Accept delivery (GRN)", status: STATUSES.DELIVERED, tone: "approve" },
      { label: "Reject material", status: STATUSES.DISCREPANCY, tone: "reject" },
    ],
    [STATUSES.DISCREPANCY]: [
      { label: "Accept after resolution", status: STATUSES.DELIVERED, tone: "approve" },
    ],
  },
};

function actionsFor(role, status) {
  const key = normalizeRole(role);
  if (key === "super_admin") {
    const seen = new Set();
    return Object.values(roleActions)
      .flatMap((group) => group[status] || [])
      .filter((item) => {
        const id = `${item.label}→${item.status}`;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
  }
  return (roleActions[key] && roleActions[key][status]) || [];
}

function canTransition(role, fromStatus, toStatus) {
  if (role === "super_admin") return true;
  if (fromStatus === toStatus) return true;
  return actionsFor(role, fromStatus).some((action) => action.status === toStatus);
}

function findTransition(role, fromStatus, toStatus) {
  if (role === "super_admin") {
    return { label: "Override", status: toStatus, tone: "edit" };
  }
  return actionsFor(role, fromStatus).find((action) => action.status === toStatus) || null;
}

function isEditableStatus(status) {
  return EDITABLE_STATUSES.includes(status);
}

const stageStatuses = {
  material_requests: null,
  approvals: [
    STATUSES.REQUESTED,
    STATUSES.APPROVED,
    STATUSES.PENDING_COMMERCIAL,
    STATUSES.PENDING_FINANCE,
  ],
  procurement: [
    STATUSES.APPROVED,
    STATUSES.SOURCING,
    STATUSES.RFQ_ISSUED,
    STATUSES.PENDING_COMMERCIAL,
    STATUSES.PENDING_PO,
    STATUSES.PO_REJECTED,
  ],
  purchase_orders: [STATUSES.ORDERED, STATUSES.IN_TRANSIT, STATUSES.PO_REJECTED],
  deliveries: [
    STATUSES.IN_TRANSIT,
    STATUSES.PENDING_RECEIPT,
    STATUSES.DISCREPANCY,
    STATUSES.DELIVERED,
    STATUSES.CLOSED,
  ],
  payments: [
    STATUSES.ORDERED,
    STATUSES.IN_TRANSIT,
    STATUSES.PENDING_RECEIPT,
    STATUSES.DELIVERED,
    STATUSES.CLOSED,
  ],
};

const roleCatalog = [
  { name: "Super Admin", key: "super_admin" },
  { name: "Admin", key: "admin" },
  { name: "Requestor", key: "requestor" },
  { name: "Department Manager", key: "manager" },
  { name: "Procurement", key: "procurement" },
  { name: "Department Head", key: "department_head" },
  { name: "Finance", key: "finance" },
  { name: "Supplier", key: "supplier" },
  { name: "Department Incharge", key: "in_charge" },
];

const rolePrivileges = {
  super_admin: {
    dashboard: ["view"],
    material_requests: ["view", "create", "edit", "delete"],
    approvals: ["view", "approve", "reject"],
    procurement: ["view", "create", "edit"],
    purchase_orders: ["view", "create", "edit"],
    deliveries: ["view", "edit"],
    payments: ["view", "approve"],
    suppliers: ["view", "create", "edit", "delete"],
    users: ["view", "create", "edit", "delete"],
    roles: ["view", "create", "edit", "delete"],
    privileges: ["view", "create", "edit", "delete"],
    departments: ["view", "create", "edit", "delete"],
    delete_requests: ["view", "approve", "reject"],
    reports: ["view", "export"],
    audits: ["view"],
    settings: ["view", "edit"],
  },
  admin: {
    dashboard: ["view"],
    users: ["view", "create", "edit"],
    material_requests: ["view"],
    reports: ["view"],
    settings: ["view", "edit"],
  },
  requestor: {
    dashboard: ["view"],
    material_requests: ["view", "create", "edit"],
    settings: ["view", "edit"],
  },
  manager: {
    dashboard: ["view"],
    material_requests: ["view", "edit"],
    approvals: ["view", "approve", "reject"],
    settings: ["view", "edit"],
  },
  procurement: {
    dashboard: ["view"],
    material_requests: ["view", "edit"],
    procurement: ["view", "create", "edit"],
    purchase_orders: ["view", "create", "edit"],
    suppliers: ["view", "create", "edit"],
    settings: ["view", "edit"],
  },
  department_head: {
    dashboard: ["view"],
    material_requests: ["view", "edit"],
    approvals: ["view", "approve", "reject"],
    reports: ["view"],
    settings: ["view", "edit"],
  },
  finance: {
    dashboard: ["view"],
    material_requests: ["view", "edit"],
    approvals: ["view", "approve", "reject"],
    payments: ["view", "approve"],
    reports: ["view", "export"],
    settings: ["view", "edit"],
  },
  supplier: {
    dashboard: ["view"],
    material_requests: ["view", "edit"],
    purchase_orders: ["view", "edit"],
    deliveries: ["view", "edit"],
    settings: ["view", "edit"],
  },
  in_charge: {
    dashboard: ["view"],
    material_requests: ["view", "edit"],
    deliveries: ["view", "edit"],
    settings: ["view", "edit"],
  },
};

module.exports = {
  STATUSES,
  EDITABLE_STATUSES,
  WORKFLOW_ROLES,
  roleActions,
  roleCatalog,
  rolePrivileges,
  stageStatuses,
  normalizeRole,
  actionsFor,
  canTransition,
  findTransition,
  isEditableStatus,
};
