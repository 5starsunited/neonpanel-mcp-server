export type ProjectType = 'inventory_order' | 'bill' | 'invoice' | 'adjustment' | 'shipment' | 'assembly_order';

export interface ProjectAdapter {
  listPath(companyUuid: string): string;
  getPath?: (companyUuid: string, projectId: number) => string;
  createPath?: (companyUuid: string) => string;
  updatePath?: (companyUuid: string, projectId: number) => string;
}

export const projectAdapters: Record<ProjectType, ProjectAdapter> = {
  inventory_order: {
    listPath: (companyUuid) => `/api/v1/companies/${encodeURIComponent(companyUuid)}/inventory-orders`,
    getPath: (companyUuid, projectId) => `/api/v1/companies/${encodeURIComponent(companyUuid)}/inventory-orders/${encodeURIComponent(String(projectId))}`,
    createPath: (companyUuid) => `/api/v1/companies/${encodeURIComponent(companyUuid)}/inventory-orders`,
    updatePath: (companyUuid, projectId) => `/api/v1/companies/${encodeURIComponent(companyUuid)}/inventory-orders/${encodeURIComponent(String(projectId))}`,
  },
  bill: {
    listPath: (companyUuid) => `/api/v1/companies/${encodeURIComponent(companyUuid)}/bills`,
    getPath: (companyUuid, projectId) => `/api/v1/companies/${encodeURIComponent(companyUuid)}/bills/${encodeURIComponent(String(projectId))}`,
    createPath: (companyUuid) => `/api/v1/companies/${encodeURIComponent(companyUuid)}/bills`,
    updatePath: (companyUuid, projectId) => `/api/v1/companies/${encodeURIComponent(companyUuid)}/bills/${encodeURIComponent(String(projectId))}`,
  },
  invoice: {
    listPath: (companyUuid) => `/api/v1/companies/${encodeURIComponent(companyUuid)}/invoices`,
    getPath: (companyUuid, projectId) => `/api/v1/companies/${encodeURIComponent(companyUuid)}/invoices/${encodeURIComponent(String(projectId))}`,
    createPath: (companyUuid) => `/api/v1/companies/${encodeURIComponent(companyUuid)}/invoices`,
    updatePath: (companyUuid, projectId) => `/api/v1/companies/${encodeURIComponent(companyUuid)}/invoices/${encodeURIComponent(String(projectId))}`,
  },
  adjustment: {
    listPath: (companyUuid) => `/api/v1/companies/${encodeURIComponent(companyUuid)}/adjustments`,
    getPath: (companyUuid, projectId) => `/api/v1/companies/${encodeURIComponent(companyUuid)}/adjustments/${encodeURIComponent(String(projectId))}`,
    createPath: (companyUuid) => `/api/v1/companies/${encodeURIComponent(companyUuid)}/adjustments`,
    updatePath: (companyUuid, projectId) => `/api/v1/companies/${encodeURIComponent(companyUuid)}/adjustments/${encodeURIComponent(String(projectId))}`,
  },
  shipment: {
    listPath: (companyUuid) => `/api/v1/companies/${encodeURIComponent(companyUuid)}/shipments`,
    getPath: (companyUuid, projectId) => `/api/v1/companies/${encodeURIComponent(companyUuid)}/shipments/${encodeURIComponent(String(projectId))}`,
    createPath: (companyUuid) => `/api/v1/companies/${encodeURIComponent(companyUuid)}/shipments`,
    updatePath: (companyUuid, projectId) => `/api/v1/companies/${encodeURIComponent(companyUuid)}/shipments/${encodeURIComponent(String(projectId))}`,
  },
  assembly_order: {
    listPath: (companyUuid) => `/api/v1/companies/${encodeURIComponent(companyUuid)}/assembly-orders`,
    getPath: (companyUuid, projectId) => `/api/v1/companies/${encodeURIComponent(companyUuid)}/assembly-orders/${encodeURIComponent(String(projectId))}`,
    createPath: (companyUuid) => `/api/v1/companies/${encodeURIComponent(companyUuid)}/assembly-orders`,
    updatePath: (companyUuid, projectId) => `/api/v1/companies/${encodeURIComponent(companyUuid)}/assembly-orders/${encodeURIComponent(String(projectId))}`,
  },
};