# Batch Fields Improvement Plan - analyze_fifo_cogs Tool

## Current State

The tool currently:
- Only includes `io_batch_id` in the SELECT and can be used in `group_by`
- Does NOT include batch names, reference numbers, or AO batch fields
- Does NOT provide batch context to explain where costs came from

## Two-Level Batch Tracking Concept

**Understanding the dual batch system:**

### IO Batch (Input/Origin - Source Tracking)
- **Purpose**: Tracks the ORIGINAL source - the Purchase Order where inventory first arrived
- **Always tracked**: NeonPanel ALWAYS maintains io_batch tracking
- **Fields available**:
  - `io_batch_id` - Purchase Order ID (currently in tool)
  - `io_batch_name` - Purchase Order name/reference
  - `io_batch_ref_number` - PO reference number

### AO Batch (Assembly Order - Cost Project Tracking)
- **Purpose**: Tracks the LAST PROJECT where items got additional costs
- **Most common**: FBA inbound shipments (products assembled/shipped to Amazon)
- **Can be NULL**: If no additional assembly/shipping costs applied
- **Fields available**:
  - `ao_batch_id` - Assembly/Project ID
  - `ao_batch_name` - Project/Shipment name
  - `ao_batch_ref_number` - Project reference number

**Key insight**: Products from ONE io_batch (PO) can split into MULTIPLE ao_batches (FBA shipments), each with different handling/shipping costs. This is why tracking both levels is critical for understanding total landed costs.

## Goal: Option 3 - Smart Contextual Inclusion

**Auto-include batch detail fields when user is analyzing by batch dimensions:**

### Behavior Rules

1. **When `group_by` includes `io_batch_id`**:
   - Automatically add `io_batch_name` and `io_batch_ref_number` to output
   - Reason: User is analyzing by source PO, they need to see PO details

2. **When `group_by` includes `ao_batch_id`** (new dimension):
   - Automatically add `ao_batch_name` and `ao_batch_ref_number` to output  
   - Reason: User is analyzing by cost project, they need to see project details

3. **When NO batch dimensions in `group_by`**:
   - Do NOT include batch detail fields (keep results clean)
   - Reason: User analyzing by SKU/market/time doesn't need batch noise

4. **When grouping by BOTH io_batch_id AND ao_batch_id**:
   - Include ALL 6 batch detail fields (full tracking context)
   - Reason: User wants complete cost provenance analysis

### Benefits

- **Clean by default**: No extra columns when analyzing by SKU/brand/time
- **Contextual details**: Batch names appear exactly when needed
- **No user decisions**: Tool automatically provides relevant context
- **Explainable costs**: When drilling into batches, users see full details

## Implementation Tasks

### 1. Add AO Batch Fields to Schema

**File**: `tool.json`

Add to `aggregation.group_by` enum:
```json
"ao_batch_id",
"ao_batch_name",
"ao_batch_ref_number"
```

Add explanations to `aggregation` description:
```
BATCH TRACKING (two-level system):
- io_batch_* fields: Source Purchase Order (where inventory originally came from)
- ao_batch_* fields: Assembly Order/Cost Project (FBA shipments where additional costs applied)
- Products from one PO can split into multiple FBA shipments with different costs
```

### 2. Update SQL Query

**File**: `query.sql`

Add to `base_transactions` SELECT (after line 56):
```sql
ft.io_batch_id,
ft.io_batch_name,
ft.io_batch_ref_number,
ft.ao_batch_id,
ft.ao_batch_name,
ft.ao_batch_ref_number,
```

### 3. Update TypeScript Handler

**File**: `register.ts`

#### Step 3a: Extend dimensionMap (around line 145)

Add after `io_batch_id`:
```typescript
io_batch_id: 'bt.io_batch_id',
io_batch_name: 'bt.io_batch_name',
io_batch_ref_number: 'bt.io_batch_ref_number',
ao_batch_id: 'bt.ao_batch_id',
ao_batch_name: 'bt.ao_batch_name',
ao_batch_ref_number: 'bt.ao_batch_ref_number',
```

#### Step 3b: Add smart batch detail inclusion logic (after dimension loop, around line 177)

```typescript
// SMART BATCH DETAIL AUTO-INCLUSION
// If user groups by batch ID, automatically include batch name/ref for context

const groupBySet = new Set(groupBy);

// Auto-include IO batch details if grouping by io_batch_id
if (groupBySet.has('io_batch_id') && !groupBySet.has('io_batch_name')) {
  groupByFields.push('bt.io_batch_name');
  groupBySelectFields.push('bt.io_batch_name AS io_batch_name');
  selectDimensions.push('ac.io_batch_name');
}
if (groupBySet.has('io_batch_id') && !groupBySet.has('io_batch_ref_number')) {
  groupByFields.push('bt.io_batch_ref_number');
  groupBySelectFields.push('bt.io_batch_ref_number AS io_batch_ref_number');
  selectDimensions.push('ac.io_batch_ref_number');
}

// Auto-include AO batch details if grouping by ao_batch_id
if (groupBySet.has('ao_batch_id') && !groupBySet.has('ao_batch_name')) {
  groupByFields.push('bt.ao_batch_name');
  groupBySelectFields.push('bt.ao_batch_name AS ao_batch_name');
  selectDimensions.push('ac.ao_batch_name');
}
if (groupBySet.has('ao_batch_id') && !groupBySet.has('ao_batch_ref_number')) {
  groupByFields.push('bt.ao_batch_ref_number');
  groupBySelectFields.push('bt.ao_batch_ref_number AS ao_batch_ref_number');
  selectDimensions.push('ac.ao_batch_ref_number');
}
```

### 4. Update Zod Schema

**File**: `register.ts` (top section around line 42)

Add to `group_by` enum array:
```typescript
'ao_batch_id',
'ao_batch_name',
'ao_batch_ref_number',
```

Also add to sort field enum if needed (around line 53):
```typescript
'ao_batch_id',
```

### 5. Testing Scenarios

**Test Case 1: Group by io_batch_id only**
```json
{
  "query": {
    "filters": {"company_id": [106]},
    "aggregation": {"group_by": ["io_batch_id"]}
  }
}
```
Expected: Output includes `io_batch_id`, `io_batch_name`, `io_batch_ref_number` (auto)

**Test Case 2: Group by sku only**
```json
{
  "query": {
    "filters": {"company_id": [106]},
    "aggregation": {"group_by": ["sku"]}
  }
}
```
Expected: NO batch fields in output (clean)

**Test Case 3: Group by both batches**
```json
{
  "query": {
    "filters": {"company_id": [106]},
    "aggregation": {"group_by": ["io_batch_id", "ao_batch_id"]}
  }
}
```
Expected: All 6 batch fields in output (complete provenance)

**Test Case 4: Group by sku and io_batch_id**
```json
{
  "query": {
    "filters": {"company_id": [106]},
    "aggregation": {"group_by": ["sku", "io_batch_id"]}
  }
}
```
Expected: sku + io_batch_id + io_batch_name + io_batch_ref_number (contextual)

## Documentation Updates

Add to tool description (tool.json):

```
BATCH TRACKING EXPLAINED:

This tool provides two-level batch tracking to explain cost provenance:

1. IO_BATCH (Input/Origin - Source Level):
   - Tracks the original Purchase Order where inventory first arrived
   - NeonPanel ALWAYS maintains io_batch tracking (never NULL)
   - Shows WHERE items came from originally
   - Fields: io_batch_id, io_batch_name, io_batch_ref_number

2. AO_BATCH (Assembly Order - Cost Project Level):
   - Tracks the last project where items got additional costs
   - Most commonly: FBA inbound shipments with prep/handling/freight costs
   - Can be NULL if no additional assembly/shipping costs were applied
   - Shows HOW items reached their final destination with added costs
   - Fields: ao_batch_id, ao_batch_name, ao_batch_ref_number

EXAMPLE: You order 1000 units on PO-123 (io_batch). Those units arrive at your warehouse.
Later, you ship them to Amazon in 2 separate FBA shipments:
- 600 units in FBA-SHIP-A (ao_batch) with $500 freight
- 400 units in FBA-SHIP-B (ao_batch) with $300 freight

Result: Items from ONE io_batch split into TWO ao_batches, each with different final costs.

SMART DETAIL INCLUSION:
When you group by io_batch_id, the tool automatically includes io_batch_name and 
io_batch_ref_number so you can identify the batch. Same for ao_batch grouping.
When NOT grouping by batches, these detail fields are omitted for cleaner results.
```

## Migration Notes

- **Backward compatible**: Existing queries work unchanged
- **No breaking changes**: Only ADDS new optional dimensions
- **Smart defaults**: Auto-inclusion means users get context without asking
- **Future-proof**: Can add batch_document_* fields later if needed

## Priority

**Implement AFTER**:
- Fixing current template engine errors (export_unit_costs, list_lost_batches)
- Deploying and testing those fixes
- Confirming analyze_fifo_cogs works correctly with current schema

**Then**:
1. Add ao_batch fields to schema
2. Implement smart inclusion logic
3. Test with real data
4. Deploy to DEV
5. Get user feedback
6. Deploy to PROD
