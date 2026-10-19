const $ = id => document.getElementById(id);
let role = 'student';
let mode = 'signin'; // or 'signup'
let config = { googleClientId: '', departments: [] };

if (localStorage.getItem('token')) location.href = '/app.html';

function showMsg(text, ok) {
  $('msg').innerHTML = text ? `<div class="msg ${ok ? 'ok' : 'err'}">${text}</div>` : '';
}

function refresh() {
  const signup = mode === 'signup';
  $('title').textContent = signup ? 'Create your account' : 'Welcome back';
  $('subtitle').textContent = signup ? `Register as ${role}` : `Sign in as ${role}`;
  $('submit').textContent = signup ? 'Create account' : 'Sign in';
  $('nameWrap').classList.toggle('hidden', !signup);
  $('deptWrap').classList.toggle('hidden', role === 'admin' || !signup);
  $('codeWrap').classList.toggle('hidden', role !== 'admin' || !signup);
  $('password').autocomplete = signup ? 'new-password' : 'current-password';
  $('switch').innerHTML = signup
    ? 'Already have an account? <a id="toggle">Sign in</a>'
    : 'New here? <a id="toggle">Create account</a>';
  $('toggle').onclick = () => { mode = signup ? 'signin' : 'signup'; showMsg(''); refresh(); };
  $('hint').classList.toggle('hidden', !(role === 'admin' && !signup));
}

document.querySelectorAll('#roles button').forEach(b => b.onclick = () => {
  role = b.dataset.role;
  document.querySelectorAll('#roles button').forEach(x => x.classList.toggle('active', x === b));
  showMsg('');
  refresh();
});

function done(data) {
  localStorage.setItem('token', data.token);
  localStorage.setItem('user', JSON.stringify(data.user));
  location.href = '/app.html';
}

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

$('form').addEventListener('submit', async e => {
  e.preventDefault();
  showMsg('');
  const body = {
    email: $('email').value, password: $('password').value, role,
    name: $('name').value, department: $('dept').value, adminCode: $('adminCode').value
  };
  $('submit').disabled = true;
  try {
    done(await post(mode === 'signup' ? '/api/register' : '/api/login', body));
  } catch (err) { showMsg(err.message); }
  $('submit').disabled = false;
});

async function onGoogle(resp) {
  showMsg('');
  try {
    done(await post('/api/google', {
      credential: resp.credential, role, department: $('dept').value, adminCode: $('adminCode').value
    }));
  } catch (err) {
    showMsg(err.message);
    if (/department/i.test(err.message)) $('deptWrap').classList.remove('hidden');
    if (/admin code/i.test(err.message)) { $('codeWrap').classList.remove('hidden'); }
  }
}

(async function init() {
  config = await (await fetch('/api/config')).json();
  config.departments.forEach(d => $('dept').insertAdjacentHTML('beforeend', `<option>${d}</option>`));
  refresh();

  if (!config.googleClientId) {
    $('gfallback').classList.remove('hidden');
    $('gfallback').onclick = () => showMsg('Google sign-in needs a Client ID. Open the .env file, set GOOGLE_CLIENT_ID (see README.md), then restart the server.');
    return;
  }
  const t = setInterval(() => {
    if (window.google && google.accounts) {
      clearInterval(t);
      google.accounts.id.initialize({ client_id: config.googleClientId, callback: onGoogle });
      google.accounts.id.renderButton($('gbtn'), { theme: 'outline', size: 'large', width: 380, text: 'continue_with' });
    }
  }, 200);
})();
