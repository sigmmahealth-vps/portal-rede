const API_URL = (import.meta as any).env.VITE_API_URL || '/api';

export const fetchApi = async (endpoint: string, options: RequestInit = {}) => {
  const token = localStorage.getItem('token');
  
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  
  // Only set Content-Type to application/json if it's not FormData
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Erro na requisição');
  }

  return response.json();
};
