const API_URL = (import.meta as any).env.VITE_API_URL || '/api';

export const fetchApi = async (endpoint: string, options: RequestInit = {}) => {
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
    credentials: 'include',
  });
  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Erro na requisição');
  }
  return response.json();
};
