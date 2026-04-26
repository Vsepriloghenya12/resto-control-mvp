# Resto Control MVP

MVP SaaS-приложения для ресторанов: электронные чек-листы, заявки на продукцию, приемка товара, инвентаризация с выгрузкой Excel, задачи, база знаний/ТТК/сервис-бук, 14 дней пробного периода и супер-админка создателя приложения.

## Быстрый запуск локально

```bash
cp .env.example .env
npm install
npm install --prefix server
npm install --prefix webapp
npm run dev
```

Открой:

- webapp: http://localhost:5173
- backend: http://localhost:8080

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

## Railway

Для MVP сервер может хранить данные в JSON-файле. Для боевого режима лучше подключить PostgreSQL. Схема для Postgres лежит в `docs/schema.sql`.

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
```
