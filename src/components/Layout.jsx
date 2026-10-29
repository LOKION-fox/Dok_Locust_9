import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <h1 className="logo">АвтоМастер</h1>
          <p className="muted">Веб-приложение администратора</p>
        </div>

        <nav className="nav-links">
          <NavLink to="/">Главная</NavLink>
          <NavLink to="/work-orders">Каталог заказов</NavLink>
          <NavLink to="/clients">Каталог клиентов</NavLink>
          <NavLink to="/vehicles">Каталог автомобилей</NavLink>
          <NavLink to="/parts">Каталог запчастей</NavLink>
          <NavLink to="/purchase-orders">Заказы запчастей</NavLink>
          <NavLink to="/archive">Архив заказов</NavLink>
          <NavLink to="/reports">Отчёты по прибыли</NavLink>
        </nav>

        <div className="sidebar-footer">
          <div className="user-box">
            <strong>{user?.full_name}</strong>
            <span className="muted">{user?.login}</span>
          </div>
          <button className="danger-btn" onClick={logout}>Выйти</button>
        </div>
      </aside>

      <main className="content">
        <header className="page-header">
          <div>
            <h2>Панель администратора</h2>
            <p className="muted">Управление заказами, клиентами, автомобилями и складом</p>
          </div>
        </header>
        <Outlet />
      </main>
    </div>
  );
}