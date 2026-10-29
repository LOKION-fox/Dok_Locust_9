import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const registerInitial = {
  full_name: '',
  phone: '',
  email: '',
  login: '',
  password: '',
};

const loginInitial = {
  login: '',
  password: '',
};

export default function LoginPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const [isRegister, setIsRegister] = useState(false);
  const [loginForm, setLoginForm] = useState(loginInitial);
  const [registerForm, setRegisterForm] = useState(registerInitial);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function handleLoginChange(event) {
    setLoginForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  }

  function handleRegisterChange(event) {
    setRegisterForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isRegister) {
        await register(registerForm);
      } else {
        await login(loginForm.login, loginForm.password);
      }
      navigate('/');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>АвтоМастер</h1>
        <p className="muted">Веб-приложение автомастерской</p>

        {error && <div className="error-box">{error}</div>}

        {isRegister ? (
          <>
            <label>
              ФИО
              <input
                name="full_name"
                value={registerForm.full_name}
                onChange={handleRegisterChange}
                maxLength={120}
                required
              />
            </label>
            <label>
              Телефон
              <input
                name="phone"
                value={registerForm.phone}
                onChange={handleRegisterChange}
                pattern="^\+?[0-9\s\-()]{10,20}$"
              />
            </label>
            <label>
              Email
              <input
                name="email"
                type="email"
                value={registerForm.email}
                onChange={handleRegisterChange}
                maxLength={120}
              />
            </label>
            <label>
              Логин
              <input
                name="login"
                value={registerForm.login}
                onChange={handleRegisterChange}
                pattern="^[A-Za-z0-9_][A-Za-z0-9_.-]{2,49}$"
                maxLength={50}
                required
              />
            </label>
            <label>
              Пароль
              <input
                name="password"
                type="password"
                value={registerForm.password}
                onChange={handleRegisterChange}
                minLength={6}
                required
              />
            </label>
          </>
        ) : (
          <>
            <label>
              Логин
              <input
                name="login"
                value={loginForm.login}
                onChange={handleLoginChange}
                pattern="^[A-Za-z0-9_][A-Za-z0-9_.-]{2,49}$"
                maxLength={50}
                required
              />
            </label>
            <label>
              Пароль
              <input
                name="password"
                type="password"
                value={loginForm.password}
                onChange={handleLoginChange}
                minLength={6}
                required
              />
            </label>
          </>
        )}

        <button className="primary-btn" type="submit" disabled={loading}>
          {loading ? 'Подождите...' : isRegister ? 'Зарегистрировать администратора' : 'Войти'}
        </button>

        <button
          type="button"
          className="link-btn"
          onClick={() => {
            setError('');
            setIsRegister((prev) => !prev);
          }}
        >
          {isRegister ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрировать администратора'}
        </button>
      </form>
    </div>
  );
}