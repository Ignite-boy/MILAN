// MILAN REAL AUTH PATCH
document.addEventListener('DOMContentLoaded', () => {
  const emailInput = document.querySelector('input[type="email"]');
  const passInput = document.querySelector('input[type="password"]');
  const loginBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.toLowerCase().includes('login'));
  const registerForm = document.querySelector('form');

  if(loginBtn && emailInput && passInput) {
    loginBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const email = emailInput.value.trim();
      const password = passInput.value;
      if(!email || !password) return alert('Email / Password daalo');

      loginBtn.textContent = 'Logging in...';
      loginBtn.disabled = true;
      try {
        const data = await milanLogin(email, password);
        alert('Welcome ' + (data.user?.name || '') + ' DID: ' + data.did);
        window.location.href = '/app';
      } catch(err) {
        alert('Login fail: ' + err.message);
      } finally {
        loginBtn.textContent = 'Login →';
        loginBtn.disabled = false;
      }
    });
  }

  // Register ke liye
  const nameInput = document.querySelector('input[placeholder*="Name"], input[name="name"]');
  const createBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.toLowerCase().includes('create') || b.textContent.toLowerCase().includes('register'));
  if(createBtn && nameInput) {
    createBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        const res = await milanRegister(nameInput.value, emailInput.value, passInput.value);
        if(res.success) {
          alert('Registered! DID: ' + res.did + ' - Ab login karo');
        } else {
          alert(res.error);
        }
      } catch(err) { alert(err.message); }
    });
  }
});
