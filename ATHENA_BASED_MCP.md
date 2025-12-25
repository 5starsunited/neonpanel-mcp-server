# AI FBA Planning & Shipment Tool Architecture

This document describes the end-to-end architecture, data model, and tool design for AI-assisted Amazon FBA replenishment planning and shipment draft creation. It is intended to be imported into VS Code and used as a living technical design document.

---

## 1. High-Level Goal

Enable AI to:

1. Answer analytical questions like **"What items do I need to ship this week?"** using curated Athena datasets aligned with QuickSight.
2. Guide the user to the next logical step.
3. Create a **draft FBA shipment** in Seller Central using explicit, user-approved inputs.

Key principles:

* Read-only analytics and write actions are strictly separated
* All joins and business logic live in ETL / Athena views, not in the AI
* Access is enforced via NeonPanel access broker and permissions

---

## 2. Data Architecture

### 2.1 ETL → S3 (Daily)

A daily ETL job stores curated data in **S3 as Parquet**, partitioned by date.

Recommended partitions:

* `snapshot_date=YYYY-MM-DD`
* (optional) `company_id`

Each snapshot represents a **complete, point-in-time view** of inventory planning data.

---

### 2.2 Athena / Glue Tables

External tables are created over S3 Parquet data using Glue Data Catalog or Athena DDL.

Raw datasets may include:

* Replenishment recommendations
* FBA inventory balances
* Warehouse availability
* Item master & logistics attributes
* Compliance / prep / hazmat flags
* Historical shipment metadata

---

### 2.3 Curated Athena View (Single Source of Truth)

Create a single curated view aligned with QuickSight, for example:

```
quicksight.inventory_planning.fba_replenishment_weekly_v
```

This view:

* Joins all required datasets
* Encodes business logic and join rules
* Is the **only dataset queried by AI tools**

#### Required canonical fields

* `company_id`
* `snapshot_date` (date when data was calculated)
* `marketplace`
* `sku`
* `asin`
* `due_date` (when product should ship)

#### Example metrics

* `suggested_qty_to_ship`
* `priority`
* `fba_on_hand`
* `fba_inbound`
* `warehouse_available_qty`
* `units_per_case`
* `unit_weight`
* `unit_dimensions`
* `prep_required`
* `hazmat_flag`

---

## 3. Date Semantics (Critical)

Two dates are used intentionally:

* **snapshot_date**

  * Represents the data snapshot date
  * One snapshot per day
  * Used to anchor consistency

* **due_date**

  * Operational date (when item should be shipped)
  * Used to answer questions like "this week"

### Default query behavior

* Always anchor to **latest snapshot_date**
* Filter and order results by **due_date**

---

## 4. Tool 1: fba_replenishment (Read-only)

### Purpose

Answer:

> "What items do I need to ship this week (by marketplace)?"

### Characteristics

* Read-only
* Athena-backed
* Uses curated view
* No joins or table selection by AI

### Access control

* Access broker: NeonPanel
* Required permission: `quicksight.inventory_planning`
* Mandatory company scope enforcement

### Query logic (conceptual)

* Determine latest `snapshot_date`
* Filter by:

  * `company_id IN (allowed_companies)`
  * `due_date BETWEEN week_start AND week_end`
* Order by urgency

### Output

* List of SKUs / ASINs
* Suggested quantities
* Marketplace
* Due dates and priority

### Next-step hint (non-executing)

The tool may include metadata suggesting:

* `create_fba_shipment_draft` as the next action

---

## 5. Tool 2: create_fba_shipment_draft (Action)

### Purpose

Create a **draft shipment in Amazon Seller Central** using user-approved inputs.

This tool does NOT decide *what* to ship — it only executes a shipment draft based on explicit input.

---

### Required Permission

* `sellercentral.shipment_draft.create`

This permission must be **separate** from analytics permissions.

---

### Inputs (explicit, user-confirmed)

* `marketplace`
* `ship_from_warehouse`
* `items` (SKU / ASIN + quantity)
* `ship_by_date`
* `ship_mode` (SPD, LTL, etc.)
* Optional notes

The AI must never guess quantities at this stage.

---

### Behavior

* Calls Seller Central APIs
* Creates a **draft** shipment only
* Does NOT submit or confirm shipment

---

### Outputs

* Draft shipment ID
* Marketplace
* Warehouse
* Item summary
* Warnings (if any)

---

## 6. Tool Interaction Flow

1. User asks: "What do I need to ship this week?"
2. AI calls `fba_replenishment`
3. Results are displayed and reviewed
4. User selects items / quantities
5. User confirms intent to create shipment
6. AI calls `create_fba_shipment_draft`
7. Draft shipment is created in Seller Central

---

## 7. Safety & Design Principles

* **Separation of concerns**

  * Planning ≠ Execution

* **Deny by default**

  * Missing permission → no action

* **Human in the loop**

  * All write actions require explicit user confirmation

* **Athena is authoritative**

  * Same datasets power QuickSight and AI

* **No AI-generated joins or SQL**

  * SQL templates are fixed and guarded

---

## 8. Future Extensions

* Shipment optimization (cost / speed)
* Carrier rate integration
* Multi-warehouse splitting
* Palletization logic
* Automated follow-up tools (labeling, ASN, tracking)

---

## 9. Summary

This architecture provides:

* Consistent analytics
* Safe AI-driven planning
* Controlled operational execution
* Clear audit and permission boundaries

It is intentionally simple at the tool layer and powerful at the data layer.
