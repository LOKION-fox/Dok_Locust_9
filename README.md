# АвтоМастер

Полноценный учебный full-stack шаблон:
- **frontend**: React + Vite
- **backend**: Node.js + Express + PostgreSQL
- **БД**: AtomasterBD

## Что реализовано
- регистрация и авторизация;
- роли **ADMIN** и **MASTER**;
- работа с клиентами и автомобилями;
- каталог запчастей;
- создание и удаление заказ-нарядов;
- назначение мастера и изменение статусов;
- резервирование/списание запчастей по заказу;
- отчёты по ремонту;
- заказы запчастей.

## 1. База данных
Сначала создай базу `AtomasterBD` и выполни SQL-скрипт, который был подготовлен ранее.

## 2. Backend
Открой папку `server` и создай файл `.env` на основе `.env.example`.

Пример `.env`:

```env
PORT=5000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=AtomasterBD
DB_USER=postgres
DB_PASSWORD=postgres
JWT_SECRET=very_secret_key_change_me
```

Установка и запуск:

```bash
cd server
npm install
npm run dev
```

## 3. Frontend
В корне проекта:

```bash
npm install
npm run dev
```

## 4. Вход в систему
Можно зарегистрировать новых пользователей через экран входа.

## 5. Важно
Браузерное React-приложение **не должно подключаться к PostgreSQL напрямую**.
Подключение выполняется через backend API.
