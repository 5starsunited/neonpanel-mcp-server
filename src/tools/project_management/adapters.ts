export type ProjectType = 'inventory_order';

export interface ProjectAdapter {
  listPath(companyUuid: string): string;
  getPath(companyUuid: string, projectId: number): string;
  createPath(companyUuid: string): string;
  updatePath(companyUuid: string, projectId: number): string;
}

export const projectAdapters: Record<ProjectType, ProjectAdapter> = {
  inventory_order: {
    listPath: (companyUuid) => `/api/v1/companies/${encodeURIComponent(companyUuid)}/inventory-orders`,
    getPath: (companyUuid, projectId) => `/api/v1/companies/${encodeURIComponent(companyUuid)}/inventory-orders/${encodeURIComponent(String(projectId))}`,
    createPath: (companyUuid) => `/api/v1/companies/${encodeURIComponent(companyUuid)}/inventory-orders`,
    updatePath: (companyUuid, projectId) => `/api/v1/companies/${encodeURIComponent(companyUuid)}/inventory-orders/${encodeURIComponent(String(projectId))}`,
  },
};