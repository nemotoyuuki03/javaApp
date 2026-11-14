const createUserForm = document.getElementById('create-user-form');
const createUserError = document.getElementById('create-user-error');
const newUsernameInput = document.getElementById('new-username');
const newPasswordInput = document.getElementById('new-password');

function setCreateUserError(message = '') {
  createUserError.textContent = message;
}

createUserForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setCreateUserError('');

  const username = newUsernameInput.value.trim();
  const password = newPasswordInput.value;

  if (!username || !password) {
    setCreateUserError('ユーザー名とパスワードを入力してください。');
    return;
  }

  try {
    const response = await fetch('/api/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'ユーザー登録に失敗しました。');
    }

    alert(`ユーザー「${data.user.username}」を作成しました。ログイン画面に戻ります。`);
    window.location.href = '/';
  } catch (error) {
    setCreateUserError(error.message);
  }
});
