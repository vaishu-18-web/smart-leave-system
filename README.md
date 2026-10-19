# Smart Leave Permission System

Student, Faculty and Admin portals with Google sign-in, email/password accounts, leave applications with document upload, approvals, analytics and reports.

## Run in VS Code

1. Install **Node.js 18+** from https://nodejs.org
2. Unzip the folder and open it in VS Code (File > Open Folder)
3. Open the terminal (Ctrl + `) and run:

```
npm install
copy .env.example .env      (Windows)   |   cp .env.example .env   (Mac/Linux)
npm start
```

4. Open http://localhost:3000

## Logins

| Role | How to get an account |
|------|----------------------|
| Student | Pick the **Student** tab > Create account (choose department) |
| Faculty | Pick the **Faculty** tab > Create account (choose department) |
| Admin | Default: `admin@college.edu` / `Admin@123`. New admins need the `ADMIN_CODE` from `.env` (default `ADMIN2026`) |

Faculty see and approve requests from students in **their own department**. Admin sees everything.

## Features

- **Student**: dashboard (total / pending / approved / rejected), Apply Leave (Sick, Emergency, Casual, Medical, dates, reason, PDF/document upload), Leave History with status, Download Report, Notifications, Profile
- **Faculty**: Total Requests, Pending Review, Approved, Rejected, approve/reject with remark, view uploaded documents
- **Admin**: Students, Faculty, Departments, Total Leaves, Pending; Leave Types bar chart; Status doughnut chart; Recent Requests > View All
- Dark mode, search box, mobile friendly, notifications bell

## Enable "Continue with Google"

1. Go to https://console.cloud.google.com > create a project
2. **APIs & Services > OAuth consent screen**: choose External, fill app name and your email, save
3. **Credentials > Create Credentials > OAuth client ID > Web application**
4. Under **Authorized JavaScript origins** add `http://localhost:3000`
5. Copy the **Client ID** into `.env`:
   ```
   GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
   ```
6. Restart `npm start`

First-time Google users: choose the role tab, select your department (Create account mode), then click the Google button. Admin via Google needs the admin code or an email listed in `ADMIN_EMAILS`.

## Project structure

```
server.js          Express API (auth, Google, leaves, stats, reports)
data/db.json       Saved data (created automatically)
uploads/           Uploaded leave documents
public/index.html  Login / create account
public/app.html    Dashboard shell
public/js/         login.js, app.js
public/css/        style.css
```

To reset all data, stop the server and delete `data/db.json`.
