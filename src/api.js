const BASE_URL = 'http://localhost:5000';

function getToken() {
  return localStorage.getItem('token');
}

async function request(url, options = {}) {
  const token = getToken();

  const response = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  const contentType = response.headers.get('content-type') || '';
  let payload = null;

  if (contentType.includes('application/json')) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  } else {
    try {
      const text = await response.text();
      payload = text ? { message: text } : null;
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message =
      payload?.message ||
      payload?.error ||
      `Ошибка запроса (${response.status})`;
    throw new Error(message);
  }

  return payload;
}

export const api = {
  get(url) {
    return request(url, { method: 'GET' });
  },

  post(url, body) {
    return request(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  put(url, body) {
    return request(url, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },

  patch(url, body) {
    return request(url, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  delete(url) {
    return request(url, {
      method: 'DELETE',
    });
  },
};