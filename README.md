# Resto Control MVP

MVP SaaS-приложения для ресторанов: электронные чек-листы, заявки на продукцию, приемка товара, инвентаризация с выгрузкой Excel, задачи, база знаний/ТТК/сервис-бук, 14 дней пробного периода и супер-админка создателя приложения.

## Быстрый запуск локально

```bash
cp .env.example .env
npm install
npm run dev
```

Открой:

- webapp: http://localhost:4173
- backend: http://localhost:8090

## Первичный доступ

- страница владельца приложения открывается после входа под супер-админом;
- супер-админ создаётся из `SUPER_ADMIN_LOGIN` и `SUPER_ADMIN_PASSWORD`;
- владелец ресторана заходит после регистрации ресторана или после создания аккаунта супер-админом.

## Что уже есть

- регистрация ресторана с trial 14 дней;
- супер-админка создателя приложения;
- кабинет владельца/управляющего ресторана;
- сотрудники и роли;
- чек-листы открытия/закрытия смены;
- заявки на продукцию по отделам;
- видимость заявок коллег;
- отметка прихода товара;
- инвентаризация;
- выгрузка инвентаризации в Excel;
- задачи для всех/ролей/конкретных сотрудников;
- база знаний: ТТК, тех меню, сервис-бук, документы;
- подтверждение ознакомления;
- PWA-установка на телефон.

## Хранилище данных

- если `DATABASE_URL` не задан, сервер продолжает работать на локальном `server/data/db.json`;
- если `DATABASE_URL` задан, сервер автоматически поднимает PostgreSQL-схему из `docs/schema.sql` и начинает сохранять данные в Postgres;
- при первом запуске с пустым Postgres сервер подтянет существующие данные из `server/data/db.json`, если они есть.

Пример env для Postgres:

```env
DATABASE_URL=postgresql://user:password@host:5432/resto_control
PGSSL=require
```

## Railway

Команда запуска:

```bash
npm run start
```

Target port: `8080`.

## Деплой на Railway через GitHub

Важно: в репозитории должны лежать файлы проекта прямо в корне: `package.json`, `server/`, `webapp/`, `Dockerfile`, `start.sh`. Если Railway видит только `.gitattributes`, значит файлы приложения не были загружены в GitHub или выбран неправильный Root Directory.

Railway settings:

- Builder: Dockerfile
- Start command: `node server/index.js`
- Target port: `8080`

Env variables:

```env
PORT=8080
JWT_SECRET=replace-with-long-secret
SUPER_ADMIN_LOGIN=admin
SUPER_ADMIN_PASSWORD=admin123
TRIAL_DAYS=14
DATABASE_URL=postgresql://user:password@host:5432/resto_control
PGSSL=require
```
