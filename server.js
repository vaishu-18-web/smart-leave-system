require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const ADMIN_CODE = process.env.ADMIN_CODE || 'ADMIN2026';
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const DEPARTMENTS = ['CSE', 'ECE', 'EEE', 'MECH', 'CIVIL'];
const LEAVE_TYPES = ['Sick Leave', 'Emergency Leave', 'Casual Leave', 'Medical Leave'];
const ROLES = ['student', 'faculty', 'admin'];

const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- tiny JSON database ----------
function load() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { users: [], leaves: [], notifications: [], seq: 1 }; }
}
let db = load();
const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
const nid = () => db.seq++;

if (!db.users.some(u => u.role === 'admin')) {
  db.users.push({
    id: nid(), name: 'System Admin', email: 'admin@college.edu',
    password: bcrypt.hashSync('Admin@123', 10), role: 'admin',
    department: '', phone: '', provider: 'password', createdAt: new Date().toISOString()
  });
  save();
  console.log('Default admin created -> admin@college.edu / Admin@123');
}

// ---------- helpers ----------
const publicUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, department: u.department, phone: u.phone || '', provider: u.provider });
const token = u => jwt.sign({ id: u.id }, JWT_SECRET, { expiresIn: '7d' });
const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function notify(userId, message) {
  db.notifications.push({ id: nid(), userId, message, read: false, createdAt: new Date().toISOString() });
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : req.query.token;
  try {
    const p = jwt.verify(t, JWT_SECRET);
    const u = db.users.find(x => x.id === p.id);
    if (!u) throw new Error('no user');
    req.user = u;
    next();
  } catch { res.status(401).json({ error: 'Please sign in again.' }); }
}
const need = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'You are not allowed to do this.' });

function enrich(l) {
  const s = db.users.find(u => u.id === l.studentId);
  const r = l.reviewedBy && db.users.find(u => u.id === l.reviewedBy);
  return {
    id: l.id, type: l.type, fromDate: l.fromDate, toDate: l.toDate, reason: l.reason,
    status: l.status, remark: l.remark || '', hasDocument: !!l.file, documentName: l.originalName || '',
    department: l.department, createdAt: l.createdAt, reviewedAt: l.reviewedAt || null,
    studentName: s ? s.name : 'Unknown', studentEmail: s ? s.email : '', reviewerName: r ? r.name : ''
  };
}
function scoped(user) {
  let list = db.leaves;
  if (user.role === 'student') list = list.filter(l => l.studentId === user.id);
  else if (user.role === 'faculty') list = list.filter(l => l.department === user.department);
  return list.slice().sort((a, b) => b.id - a.id);
}
const count = (list, s) => list.filter(l => l.status === s).length;

// ---------- app ----------
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) =>
  res.json({ googleClientId: GOOGLE_CLIENT_ID, departments: DEPARTMENTS, leaveTypes: LEAVE_TYPES }));

// ----- auth -----
app.post('/api/register', (req, res) => {
  let { name, email, password, role, department, adminCode } = req.body || {};
  name = (name || '').trim(); email = (email || '').trim().toLowerCase();
  if (!name) return res.status(400).json({ error: 'Please enter your full name.' });
  if (!emailOk(email)) return res.status(400).json({ error: 'Please enter a valid email.' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Choose a role.' });
  if (role !== 'admin' && !DEPARTMENTS.includes(department)) return res.status(400).json({ error: 'Please select your department.' });
  if (role === 'admin' && adminCode !== ADMIN_CODE) return res.status(403).json({ error: 'Invalid admin code.' });
  if (db.users.some(u => u.email === email)) return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
  const user = {
    id: nid(), name, email, password: bcrypt.hashSync(password, 10), role,
    department: role === 'admin' ? '' : department, phone: '', provider: 'password', createdAt: new Date().toISOString()
  };
  db.users.push(user);
  notify(user.id, 'Welcome to Smart Leave Permission System!');
  save();
  res.json({ token: token(user), user: publicUser(user) });
});

app.post('/api/login', (req, res) => {
  const email = ((req.body || {}).email || '').trim().toLowerCase();
  const { password, role } = req.body || {};
  const user = db.users.find(u => u.email === email);
  if (!user || !user.password || !bcrypt.compareSync(password || '', user.password))
    return res.status(401).json({ error: 'Incorrect email or password.' });
  if (role && user.role !== role)
    return res.status(403).json({ error: `This account is registered as ${user.role}. Switch to the ${user.role} tab to sign in.` });
  res.json({ token: token(user), user: publicUser(user) });
});

const gClient = new OAuth2Client();
app.post('/api/google', async (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(501).json({ error: 'Google sign-in is not set up yet. Add GOOGLE_CLIENT_ID to the .env file.' });
  const { credential, role, department, adminCode } = req.body || {};
  try {
    const ticket = await gClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    const email = (p.email || '').toLowerCase();
    if (!p.email_verified) return res.status(403).json({ error: 'Your Google email is not verified.' });
    let user = db.users.find(u => u.email === email);
    if (user) {
      if (role && user.role !== role)
        return res.status(403).json({ error: `This account is registered as ${user.role}. Switch to the ${user.role} tab.` });
    } else {
      if (!ROLES.includes(role)) return res.status(400).json({ error: 'Choose a role first.' });
      if (role === 'admin' && !(ADMIN_EMAILS.includes(email) || adminCode === ADMIN_CODE))
        return res.status(403).json({ error: 'Admin sign-up needs the admin code.' });
      if (role !== 'admin' && !DEPARTMENTS.includes(department))
        return res.status(400).json({ error: 'Please select your department, then click Google again.' });
      user = {
        id: nid(), name: p.name || email.split('@')[0], email, password: '', role,
        department: role === 'admin' ? '' : department, phone: '', provider: 'google', createdAt: new Date().toISOString()
      };
      db.users.push(user);
      notify(user.id, 'Welcome to Smart Leave Permission System!');
      save();
    }
    res.json({ token: token(user), user: publicUser(user) });
  } catch (e) {
    res.status(401).json({ error: 'Google sign-in failed. Check your GOOGLE_CLIENT_ID and try again.' });
  }
});

// ----- profile -----
app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));
app.put('/api/me', auth, (req, res) => {
  const { name, phone, department, newPassword } = req.body || {};
  if (name && name.trim()) req.user.name = name.trim();
  if (typeof phone === 'string') req.user.phone = phone.trim();
  if (department && req.user.role !== 'admin' && DEPARTMENTS.includes(department)) req.user.department = department;
  if (newPassword) {
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    req.user.password = bcrypt.hashSync(newPassword, 10);
  }
  save();
  res.json({ user: publicUser(req.user) });
});

// ----- leaves -----
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Only PDF, DOC, DOCX, JPG or PNG files are allowed.'), ok);
  }
});

app.post('/api/leaves', auth, need('student'), (req, res) => {
  upload.single('document')(req, res, err => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 5 MB).' : err.message });
    const { type, fromDate, toDate, reason } = req.body;
    const clean = () => req.file && fs.unlink(req.file.path, () => {});
    if (!LEAVE_TYPES.includes(type)) { clean(); return res.status(400).json({ error: 'Choose a leave type.' }); }
    if (!fromDate || !toDate) { clean(); return res.status(400).json({ error: 'Choose From and To dates.' }); }
    if (toDate < fromDate) { clean(); return res.status(400).json({ error: 'To Date cannot be before From Date.' }); }
    if (!reason || reason.trim().length < 5) { clean(); return res.status(400).json({ error: 'Please write a reason for your leave.' }); }
    const leave = {
      id: nid(), studentId: req.user.id, department: req.user.department, type, fromDate, toDate,
      reason: reason.trim(), status: 'Pending', remark: '', file: req.file ? req.file.filename : '',
      originalName: req.file ? req.file.originalname : '', createdAt: new Date().toISOString()
    };
    db.leaves.push(leave);
    db.users.filter(u => u.role === 'faculty' && u.department === leave.department)
      .forEach(f => notify(f.id, `New ${type} request from ${req.user.name} (${fromDate} to ${toDate}).`));
    notify(req.user.id, `Your ${type} request (${fromDate} to ${toDate}) was submitted and is pending review.`);
    save();
    res.json({ leave: enrich(leave) });
  });
});

app.get('/api/leaves', auth, (req, res) => res.json({ leaves: scoped(req.user).map(enrich) }));

app.patch('/api/leaves/:id', auth, need('faculty', 'admin'), (req, res) => {
  const leave = db.leaves.find(l => l.id === +req.params.id);
  if (!leave) return res.status(404).json({ error: 'Request not found.' });
  if (req.user.role === 'faculty' && leave.department !== req.user.department)
    return res.status(403).json({ error: 'This request belongs to another department.' });
  const { status, remark } = req.body || {};
  if (!['Approved', 'Rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  if (leave.status !== 'Pending') return res.status(409).json({ error: 'This request was already reviewed.' });
  leave.status = status; leave.remark = (remark || '').trim();
  leave.reviewedBy = req.user.id; leave.reviewedAt = new Date().toISOString();
  notify(leave.studentId, `Your ${leave.type} request (${leave.fromDate} to ${leave.toDate}) was ${status.toLowerCase()} by ${req.user.name}.${leave.remark ? ' Remark: ' + leave.remark : ''}`);
  save();
  res.json({ leave: enrich(leave) });
});

app.get('/api/leaves/:id/document', auth, (req, res) => {
  const leave = db.leaves.find(l => l.id === +req.params.id);
  if (!leave || !leave.file) return res.status(404).json({ error: 'No document.' });
  const u = req.user;
  const allowed = u.role === 'admin' || (u.role === 'student' && leave.studentId === u.id) ||
    (u.role === 'faculty' && leave.department === u.department);
  if (!allowed) return res.status(403).json({ error: 'Not allowed.' });
  res.download(path.join(UPLOAD_DIR, leave.file), leave.originalName);
});

// ----- stats / analytics -----
app.get('/api/stats', auth, (req, res) => {
  const list = scoped(req.user);
  const out = { total: list.length, pending: count(list, 'Pending'), approved: count(list, 'Approved'), rejected: count(list, 'Rejected') };
  if (req.user.role === 'admin') {
    out.students = db.users.filter(u => u.role === 'student').length;
    out.faculty = db.users.filter(u => u.role === 'faculty').length;
    out.departments = DEPARTMENTS.length;
    out.byType = {};
    LEAVE_TYPES.forEach(t => out.byType[t] = list.filter(l => l.type === t).length);
  }
  res.json(out);
});

// ----- notifications -----
app.get('/api/notifications', auth, (req, res) => {
  const items = db.notifications.filter(n => n.userId === req.user.id).sort((a, b) => b.id - a.id);
  res.json({ notifications: items, unread: items.filter(n => !n.read).length });
});
app.post('/api/notifications/read', auth, (req, res) => {
  db.notifications.filter(n => n.userId === req.user.id).forEach(n => n.read = true);
  save(); res.json({ ok: true });
});

// ----- report (CSV, opens in Excel) -----
app.get('/api/report', auth, (req, res) => {
  const q = s => `"${String(s == null ? '' : s).replace(/"/g, '""')}"`;
  const rows = [['ID', 'Student', 'Email', 'Department', 'Leave Type', 'From', 'To', 'Reason', 'Status', 'Reviewed By', 'Remark', 'Applied On']];
  scoped(req.user).map(enrich).forEach(l => rows.push([l.id, l.studentName, l.studentEmail, l.department, l.type, l.fromDate, l.toDate, l.reason, l.status, l.reviewerName, l.remark, l.createdAt.slice(0, 10)]));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="leave-report.csv"');
  res.send('\uFEFF' + rows.map(r => r.map(q).join(',')).join('\r\n'));
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.listen(PORT, () => console.log(`Smart Leave Permission System running at http://localhost:${PORT}`));
