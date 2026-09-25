const BASE = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api';

async function request(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export const api = {
  // Users
  getUsers: (role) => request(`/users${role ? `?role=${role}` : ''}`),
  getUser: (id) => request(`/users/${id}`),

  // Companies
  getCompanies: () => request('/companies'),
  getCompany: (id) => request(`/companies/${id}`),

  // Products
  getProducts: (companyId) => request(`/products${companyId ? `?company_id=${companyId}` : ''}`),

  // Docks
  getDocks: () => request('/docks'),
  getDock: (id) => request(`/docks/${id}`),

  // Orders
  getOrders: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/orders${qs ? `?${qs}` : ''}`);
  },
  getOrder: (id) => request(`/orders/${id}`),
  updateOrderItem: (orderId, data) => request(`/orders/${orderId}/items`, { method: 'PUT', body: JSON.stringify(data) }),
  completeOrder: (orderId, data) => request(`/orders/${orderId}/complete`, { method: 'POST', body: JSON.stringify(data) }),

  // Issues
  getIssues: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/issues${qs ? `?${qs}` : ''}`);
  },
  getIssue: (id) => request(`/issues/${id}`),
  createIssue: (data) => request('/issues', { method: 'POST', body: JSON.stringify(data) }),
  selfResolve: (id, data) => request(`/issues/${id}/self-resolve`, { method: 'PUT', body: JSON.stringify(data) }),
  escalateIssue: (id) => request(`/issues/${id}/escalate`, { method: 'PUT' }),
  supervisorResolve: (id, data) => request(`/issues/${id}/supervisor-resolve`, { method: 'PUT', body: JSON.stringify(data) }),

  // Inspections
  createInspection: (data) => request('/inspections', { method: 'POST', body: JSON.stringify(data) }),

  // Chat
  sendChat: (data) => request('/chat', { method: 'POST', body: JSON.stringify(data) }),
  getChatHistory: (userId) => request(`/chat/history/${userId}`),

  // Requests
  getRequests: (status) => request(`/requests${status ? `?status=${status}` : ''}`),
  createRequest: (data) => request('/requests', { method: 'POST', body: JSON.stringify(data) }),
  fulfillRequest: (id) => request(`/requests/${id}/fulfill`, { method: 'PUT' }),

  // Broadcasts
  getBroadcasts: () => request('/broadcasts'),
  createBroadcast: (data) => request('/broadcasts', { method: 'POST', body: JSON.stringify(data) }),

  // Shift Handoffs
  getHandoffs: () => request('/shift-handoffs'),
  createHandoff: (data) => request('/shift-handoffs', { method: 'POST', body: JSON.stringify(data) }),

  // Analytics
  getAnalytics: () => request('/analytics/summary'),

  // Carriers
  getCarriers: () => request('/carriers'),
};
